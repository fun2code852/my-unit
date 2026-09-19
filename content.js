(() => {
  if (globalThis.__uceContentLoaded) return;
  globalThis.__uceContentLoaded = true;

  const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "SVG",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "PICTURE",
  "CODE",
  "PRE",
  "MATH",
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

const HIGHLIGHT_NAME = "uce-price";
const MAX_SCAN_ROOTS = 20;

let state = null;
let tooltipEl = null;
let observer = null;
let scheduled = false;
let dirtyWhileHidden = false;
let pointerTracking = false;
let lastHover = null;
let hoverPayload = null;
let pinUntil = 0;
let moveRaf = 0;
let priceRanges = [];
const pendingRoots = new Set();
const strikeCache = new WeakMap();

function hostName() {
  try {
    return location.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function parseCtx() {
  return {
    hostname: hostName(),
    defaultDollar: state?.defaultDollar || UCE.DEFAULT_DOLLAR_CURRENCY,
    overrides: state?.overrides || {},
    defaultYen: state?.defaultYen || UCE.DEFAULT_YEN_CURRENCY,
    yenOverrides: state?.yenOverrides || {},
  };
}

function unitReady() {
  if (!state?.unit || !state.unit.currency) return false;
  if (state.unit.type === "currency") return true;
  return Number(state.unit.price) > 0;
}

function isPaused() {
  return (state?.pausedHosts || []).includes(hostName());
}

function live() {
  return unitReady() && !isPaused();
}

function conversionShort(amount, currency) {
  const count = UCE.convertToUnit(amount, currency, state.unit, state.fx);
  const formatted = UCE.formatCount(count);
  if (!formatted) return null;
  const pair = state.unit.type === "yahoo" ? UCE.parseYahooFx(state.unit.symbol) : null;
  const label = pair
    ? pair.quote
    : state.unit.type === "currency"
      ? state.unit.currency
      : state.unit.type === "yahoo"
        ? state.unit.shortName || state.unit.symbol || chrome.i18n.getMessage("unitsFallback")
        : state.unit.name || state.unit.symbol || chrome.i18n.getMessage("unitsFallback");
  return `${formatted} ${label}`;
}

function conversionText(amount, currency) {
  if (!state?.unit) return null;
  const short = conversionShort(amount, currency);
  if (!short) return chrome.i18n.getMessage("tipFxNeeded");
  if (state.unit.type !== "yahoo") return short;
  const asOf = UCE.formatAsOf(state.unit.asOf);
  return asOf ? `${short} · ${asOf}` : short;
}

function removeStrayTooltips(keep) {
  document.querySelectorAll(".uce-tooltip").forEach((el) => {
    if (el !== keep) el.remove();
  });
}

function ensureTooltip() {
  if (tooltipEl && tooltipEl.isConnected) {
    removeStrayTooltips(tooltipEl);
    return tooltipEl;
  }
  const existing = document.querySelector(".uce-tooltip");
  if (existing) {
    tooltipEl = existing;
    removeStrayTooltips(tooltipEl);
    return tooltipEl;
  }
  tooltipEl = document.createElement("div");
  tooltipEl.className = "uce-tooltip";
  tooltipEl.id = "uce-tooltip";
  tooltipEl.hidden = true;
  (document.body || document.documentElement).appendChild(tooltipEl);
  return tooltipEl;
}

function showTooltipAtRect(rect, text) {
  const tip = ensureTooltip();
  tip.textContent = text;
  tip.hidden = false;
  const tipHeight = tip.offsetHeight || 28;
  const tipWidth = Math.min(tip.offsetWidth || 160, 280);
  const above = rect.top - tipHeight - 8;
  const below = rect.bottom + 8;
  const top = above >= 8 ? above : below;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - tipWidth - 8);
  tip.style.top = `${Math.round(Math.max(8, top))}px`;
  tip.style.left = `${Math.round(left)}px`;
}

function hideTooltip() {
  hoverPayload = null;
  lastHover = null;
  document.querySelectorAll(".uce-tooltip").forEach((el) => {
    el.hidden = true;
  });
}

function pinTooltip(ms) {
  pinUntil = Date.now() + ms;
  setTimeout(() => {
    if (Date.now() >= pinUntil) hideTooltip();
  }, ms + 50);
}

function showPriceTooltip(amount, currency, getRect, key) {
  lastHover = key;
  hoverPayload = { amount, currency, getRect };
  showTooltipAtRect(getRect(), conversionText(amount, currency));
}

function refreshOpenTooltip() {
  if (!tooltipEl || tooltipEl.hidden || !hoverPayload) return;
  showTooltipAtRect(hoverPayload.getRect(), conversionText(hoverPayload.amount, hoverPayload.currency));
}

function markPrice(el, amount, currency) {
  el.classList.add("uce-price");
  el.dataset.uceAmount = String(amount);
  el.dataset.uceCurrency = currency;
  el.dataset.uceBound = "1";
}

function unmarkElements() {
  document.querySelectorAll(".uce-price, .uce-amazon-mark, .uce-split-mark, .uce-split").forEach((el) => {
    el.classList.remove("uce-price", "uce-amazon-mark", "uce-split-mark", "uce-split");
    delete el.dataset.uceAmount;
    delete el.dataset.uceCurrency;
    delete el.dataset.uceBound;
  });
}

function highlightApi() {
  return typeof CSS !== "undefined" && CSS.highlights;
}

function rangeAlive(item) {
  try {
    const node = item.range.startContainer;
    return Boolean(item.range && !item.range.collapsed && node && node.isConnected);
  } catch {
    return false;
  }
}

function syncHighlight() {
  priceRanges = priceRanges.filter(rangeAlive);
  if (!highlightApi()) return;
  const highlight = new Highlight();
  for (const item of priceRanges) highlight.add(item.range);
  CSS.highlights.set(HIGHLIGHT_NAME, highlight);
}

function clearHighlights() {
  priceRanges = [];
  if (highlightApi()) CSS.highlights.delete(HIGHLIGHT_NAME);
}

function pruneRangesIn(root) {
  if (!root || root === document.body || root === document.documentElement) {
    priceRanges = [];
    return;
  }
  priceRanges = priceRanges.filter((item) => {
    if (!rangeAlive(item)) return false;
    try {
      const node = item.range.startContainer;
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (!el) return false;
      return !(root === el || root.contains(el));
    } catch {
      return false;
    }
  });
}

function addPriceRange(node, start, end, amount, currency) {
  if (!node || start >= end) return;
  for (const existing of priceRanges) {
    if (
      existing.range.startContainer === node &&
      existing.range.startOffset === start &&
      existing.range.endOffset === end
    ) {
      return;
    }
  }
  const range = document.createRange();
  try {
    range.setStart(node, start);
    range.setEnd(node, end);
  } catch {
    return;
  }
  priceRanges.push({ range, amount, currency });
  if (!highlightApi()) {
    const parent = node.parentElement;
    if (parent && parent.childNodes.length === 1 && start === 0 && end === (node.textContent || "").length) {
      markPrice(parent, amount, currency);
    }
  }
}

function elementRoot(root) {
  if (!root) return document.body;
  if (root.nodeType === Node.ELEMENT_NODE) return root;
  if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return root;
  return root.parentElement || document.body;
}

function skipWalkEl(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.classList.contains("uce-tooltip") || el === tooltipEl) return true;
  if (el.closest(".uce-price, .uce-tooltip, .a-price")) return true;
  if (el.closest("[contenteditable='true'], [contenteditable='']")) return true;
  return false;
}

function isStruckThrough(el) {
  let node = el;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const chain = [];
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && node !== document.documentElement) {
    const cached = strikeCache.get(node);
    if (cached != null) {
      for (const item of chain) strikeCache.set(item, cached);
      return cached;
    }
    chain.push(node);
    const style = getComputedStyle(node);
    const line = `${style.textDecorationLine || ""} ${style.textDecoration || ""}`;
    if (/\bline-through\b/.test(line) || node.tagName === "S" || node.tagName === "DEL") {
      for (const item of chain) strikeCache.set(item, true);
      return true;
    }
    node = node.parentElement;
  }
  for (const item of chain) strikeCache.set(item, false);
  return false;
}

function invalidateStrike(from) {
  let node = from;
  if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    strikeCache.delete(node);
    node = node.parentElement;
  }
}

function collectTextHits(node) {
  const parent = node.parentElement;
  if (!parent || skipWalkEl(parent) || isStruckThrough(parent)) return;
  const text = node.textContent || "";
  const hits = UCE.findPrices(text, parseCtx());
  for (const hit of hits) addPriceRange(node, hit.start, hit.end, hit.amount, hit.currency);
}

function walk(root) {
  if (!root || !live()) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skipWalkEl(parent)) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || !/[0-9]/.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let current;
  while ((current = walker.nextNode())) nodes.push(current);
  for (const node of nodes) collectTextHits(node);
}

function directText(el) {
  return [...el.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function skipEmptySiblings(node, dir) {
  let current = dir === "next" ? node.nextSibling : node.previousSibling;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) return current;
    if (current.nodeType === Node.TEXT_NODE && current.textContent.trim()) return current;
    current = dir === "next" ? current.nextSibling : current.previousSibling;
  }
  return null;
}

/** Exactly one amount-only text node under el (nested spans OK; two numbers = a range, skip). */
function soleAmountIn(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const hits = [];
  let node;
  while ((node = walker.nextNode())) {
    if (UCE.isAmountText(node.textContent)) hits.push(node);
  }
  return hits.length === 1 ? hits[0] : null;
}

function amountFromCandidate(candidate) {
  if (!candidate) return null;
  if (candidate.nodeType === Node.TEXT_NODE && UCE.isAmountText(candidate.textContent)) {
    return { markEl: candidate.parentElement, amount: candidate.textContent, textNode: candidate };
  }
  if (candidate.nodeType !== Node.ELEMENT_NODE) return null;
  const direct = directText(candidate);
  if (UCE.isAmountText(direct)) {
    const textNode = [...candidate.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && UCE.isAmountText(node.textContent),
    );
    return { markEl: candidate, amount: direct, textNode: textNode || null };
  }
  const nested = soleAmountIn(candidate);
  if (!nested) return null;
  return { markEl: nested.parentElement || candidate, amount: nested.textContent, textNode: nested };
}

function elementIsSolePiece(el, raw) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const expected = UCE.normalizeNbsp(raw).replace(/\s+/g, " ").trim();
  if (!expected) return false;
  if (el.closest(".uce-price")) return true;
  const own = UCE.normalizeNbsp(el.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  return own === expected;
}

function markSplitPiece(textNode, markEl, raw, amount, currency) {
  if (markEl && elementIsSolePiece(markEl, raw)) {
    markPrice(markEl, amount, currency);
    markEl.classList.add("uce-split");
    return;
  }
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    addPriceRange(textNode, 0, (textNode.textContent || "").length, amount, currency);
  }
}

/**
 * Currency-only text next to an amount: element sibling, nested amount, or
 * following text. No site class names. Never marks a common ancestor.
 */
function processSplitSiblings(root) {
  if (!live()) return;
  const scope = elementRoot(root);
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skipWalkEl(parent)) return NodeFilter.FILTER_REJECT;
      if (!UCE.isCurrencyToken(node.textContent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const tokens = [];
  let current;
  while ((current = walker.nextNode())) tokens.push(current);

  for (const node of tokens) {
    if (!node.isConnected) continue;
    const currencyEl = node.parentElement;
    if (!currencyEl || currencyEl.closest(".uce-price")) continue;
    if (isStruckThrough(currencyEl)) continue;

    const candidates = [
      skipEmptySiblings(node, "next"),
      skipEmptySiblings(node, "prev"),
      currencyEl.nextElementSibling,
      currencyEl.previousElementSibling,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate.nodeType === Node.ELEMENT_NODE && candidate.closest(".uce-price")) continue;
      if (candidate.nodeType === Node.ELEMENT_NODE && isStruckThrough(candidate)) continue;
      const found = amountFromCandidate(candidate);
      if (!found || !found.markEl) continue;
      if (isStruckThrough(found.markEl)) continue;
      const parsed = UCE.parsePriceString(`${node.textContent} ${found.amount}`, parseCtx());
      if (!parsed) continue;
      markSplitPiece(node, currencyEl, node.textContent, parsed.amount, parsed.currency);
      markSplitPiece(found.textNode, found.markEl, found.amount, parsed.amount, parsed.currency);
      break;
    }
  }
}

function isAmazonListPrice(priceEl) {
  return (
    priceEl.getAttribute("data-a-strike") === "true" ||
    priceEl.classList.contains("a-text-price")
  );
}

function amazonVisibleSpan(priceEl) {
  const whole = priceEl.querySelector(".a-price-whole");
  if (whole && whole.parentElement) return whole.parentElement;
  for (const span of priceEl.querySelectorAll('span[aria-hidden="true"]')) {
    if (!span.classList.contains("a-offscreen")) return span;
  }
  return null;
}

/** HKD + 1,176 + 71 → "HKD 1,176.71". vis.textContent glues to HKD1,17671. */
function amazonAssembled(priceEl) {
  const symbol = priceEl.querySelector(".a-price-symbol");
  const whole = priceEl.querySelector(".a-price-whole");
  if (!symbol || !whole) return "";
  const wholeNum = [...whole.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join("")
    .replace(/[^\d.,]/g, "")
    .trim();
  if (!wholeNum) return "";
  const fraction = (priceEl.querySelector(".a-price-fraction")?.textContent || "").replace(/[^\d]/g, "");
  const token = symbol.textContent.replace(/\s+/g, " ").trim();
  return fraction ? `${token} ${wholeNum}.${fraction}` : `${token} ${wholeNum}`;
}

function amazonWidgets(root) {
  const scope = elementRoot(root);
  const hosts = new Set();
  if (scope.nodeType === Node.ELEMENT_NODE && scope.matches?.(".a-price")) hosts.add(scope);
  if (scope.querySelectorAll) {
    scope.querySelectorAll(".a-price").forEach((el) => hosts.add(el));
    scope.querySelectorAll(".a-price-whole").forEach((whole) => {
      if (whole.closest(".a-price")) return;
      const vis = whole.parentElement;
      const host = vis && vis.parentElement ? vis.parentElement : vis;
      if (host) hosts.add(host);
    });
  }
  return hosts;
}

function processAmazon(root) {
  if (!live()) return;
  amazonWidgets(root).forEach((priceEl) => {
    if (priceEl.dataset.uceBound === "1") return;
    if (isStruckThrough(priceEl) || isAmazonListPrice(priceEl)) return;
    const offscreen = (priceEl.querySelector(".a-offscreen")?.textContent || "").trim();
    const vis = amazonVisibleSpan(priceEl);
    const raw = amazonAssembled(priceEl) || offscreen || (vis && vis.textContent) || "";
    const parsed = UCE.parsePriceString(raw, parseCtx());
    if (!parsed) return;
    markPrice(priceEl, parsed.amount, parsed.currency);
    if (vis) vis.classList.add("uce-amazon-mark");
  });
}

function scan(root) {
  if (!live()) return;
  const target = elementRoot(root);
  if (!target || !target.isConnected) return;
  pruneRangesIn(target);
  processAmazon(target);
  processSplitSiblings(target);
  walk(target);
  syncHighlight();
}

function collapseRoots(roots) {
  const els = [...new Set(roots.map(elementRoot).filter(Boolean))];
  return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
}

function isOurNode(node) {
  if (!node) return true;
  if (node === tooltipEl) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  if (node.classList.contains("uce-tooltip")) return true;
  return false;
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (!live()) {
      pendingRoots.clear();
      return;
    }
    const roots = [...pendingRoots];
    pendingRoots.clear();
    if (!roots.length) return;
    const full =
      roots.length > MAX_SCAN_ROOTS ||
      roots.some((root) => root === document.body || root === document.documentElement);
    if (full) {
      scan(document.body);
      return;
    }
    for (const root of collapseRoots(roots)) {
      if (root && root.isConnected) scan(root);
    }
  });
}

function stopObserver() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
}

function startObserver() {
  if (observer || !document.body) return;
  observer = new MutationObserver((records) => {
    if (!live()) return;
    if (document.hidden) {
      dirtyWhileHidden = true;
      return;
    }
    for (const rec of records) {
      if (isOurNode(rec.target)) continue;
      invalidateStrike(rec.target);
      const targetIsRoot = rec.target === document.body || rec.target === document.documentElement;
      if (!targetIsRoot) pendingRoots.add(rec.target);
      rec.addedNodes.forEach((node) => {
        if (isOurNode(node)) return;
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) pendingRoots.add(node);
      });
    }
    if (pendingRoots.size) scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function priceElFromTarget(target) {
  if (!target || target === tooltipEl) return null;
  if (target.nodeType !== Node.ELEMENT_NODE) target = target.parentElement;
  return target?.closest?.(".uce-price") || null;
}

function pointInRect(x, y, rect, pad) {
  return (
    x >= rect.left - pad &&
    x <= rect.right + pad &&
    y >= rect.top - pad &&
    y <= rect.bottom + pad
  );
}

function priceElFromPoint(x, y) {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!el || el === tooltipEl) continue;
    if (el.classList?.contains("uce-price")) return el;
    const hit = el.closest?.(".uce-price");
    if (hit) return hit;
  }
  return null;
}

function rangeHitFromPoint(x, y) {
  for (const item of priceRanges) {
    if (!rangeAlive(item)) continue;
    let rects;
    try {
      rects = item.range.getClientRects();
    } catch {
      continue;
    }
    for (const rect of rects) {
      if (rect.width && rect.height && pointInRect(x, y, rect, 3)) return item;
    }
  }
  return null;
}

function updateHover(x, y, target) {
  if (Date.now() < pinUntil) return;
  const el = priceElFromTarget(target) || priceElFromPoint(x, y);
  if (el) {
    if (lastHover === el) return;
    showPriceTooltip(Number(el.dataset.uceAmount), el.dataset.uceCurrency, () => el.getBoundingClientRect(), el);
    return;
  }
  const item = rangeHitFromPoint(x, y);
  if (item) {
    if (lastHover === item.range) return;
    showPriceTooltip(item.amount, item.currency, () => item.range.getBoundingClientRect(), item.range);
    return;
  }
  hideTooltip();
}

function onPointerOver(event) {
  if (Date.now() < pinUntil) return;
  const el = priceElFromTarget(event.target);
  if (!el || lastHover === el) return;
  showPriceTooltip(Number(el.dataset.uceAmount), el.dataset.uceCurrency, () => el.getBoundingClientRect(), el);
}

function onPointerOut(event) {
  if (Date.now() < pinUntil) return;
  const leaving = priceElFromTarget(event.target);
  if (!leaving) return;
  const next = priceElFromTarget(event.relatedTarget);
  if (next) return;
  lastHover = null;
  hoverPayload = null;
  if (tooltipEl) tooltipEl.hidden = true;
}

function onPointerMove(event) {
  if (Date.now() < pinUntil) return;
  if (moveRaf) return;
  const { clientX, clientY, target } = event;
  moveRaf = requestAnimationFrame(() => {
    moveRaf = 0;
    updateHover(clientX, clientY, target);
  });
}

function onFocusIn(event) {
  const el = priceElFromTarget(event.target);
  if (!el) return;
  showPriceTooltip(Number(el.dataset.uceAmount), el.dataset.uceCurrency, () => el.getBoundingClientRect(), el);
}

function onFocusOut(event) {
  if (Date.now() < pinUntil) return;
  if (priceElFromTarget(event.relatedTarget)) return;
  if (priceElFromTarget(event.target)) hideTooltip();
}

function onScrollHide() {
  if (Date.now() < pinUntil) return;
  hideTooltip();
}

function ensurePointerTracking() {
  if (pointerTracking) return;
  pointerTracking = true;
  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("pointerout", onPointerOut, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  window.addEventListener("scroll", onScrollHide, true);
  window.addEventListener("resize", onScrollHide);
}

function stopPointerTracking() {
  if (!pointerTracking) return;
  pointerTracking = false;
  document.removeEventListener("pointerover", onPointerOver, true);
  document.removeEventListener("pointerout", onPointerOut, true);
  document.removeEventListener("pointermove", onPointerMove, true);
  document.removeEventListener("focusin", onFocusIn, true);
  document.removeEventListener("focusout", onFocusOut, true);
  window.removeEventListener("scroll", onScrollHide, true);
  window.removeEventListener("resize", onScrollHide);
  if (moveRaf) {
    cancelAnimationFrame(moveRaf);
    moveRaf = 0;
  }
}

function teardown() {
  stopObserver();
  pendingRoots.clear();
  scheduled = false;
  dirtyWhileHidden = false;
  stopPointerTracking();
  hideTooltip();
  removeStrayTooltips(null);
  tooltipEl = null;
  clearHighlights();
  unmarkElements();
}

function applyLiveState() {
  if (!live()) {
    teardown();
    return;
  }
  scan(document.body);
  ensurePointerTracking();
  startObserver();
}

function onVisibilityChange() {
  if (document.hidden) return;
  if (!live()) return;
  if (dirtyWhileHidden) {
    dirtyWhileHidden = false;
    scan(document.body);
  }
}

function selectionRect() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect && (rect.width || rect.height || rect.top || rect.left)) return rect;
  }
  return { top: 16, bottom: 44, left: 16, right: 16 };
}

async function handleConvertSelection(raw) {
  if (!state) {
    const res = await chrome.runtime.sendMessage({ action: "getState" });
    state = res?.state;
  }
  const rect = selectionRect();
  if (!unitReady()) {
    showTooltipAtRect(rect, chrome.i18n.getMessage("tipSaveUnitFirst"));
    pinTooltip(4000);
    return;
  }
  const parsed = UCE.parsePriceString(raw, parseCtx());
  if (!parsed) {
    showTooltipAtRect(rect, chrome.i18n.getMessage("tipNoPrice"));
    pinTooltip(4000);
    return;
  }
  const text = conversionText(parsed.amount, parsed.currency);
  showTooltipAtRect(rect, text || chrome.i18n.getMessage("tipFxNeeded"));
  pinTooltip(4000);
}

async function refreshState() {
  const res = await chrome.runtime.sendMessage({ action: "getState" });
  if (res?.state) state = res.state;
}

async function handleStorageChange(changes) {
  const wasPaused = isPaused();
  const wasReady = unitReady();
  await refreshState();

  if (changes.pausedHosts && wasPaused !== isPaused()) {
    applyLiveState();
    return;
  }

  if (changes.defaultDollar || changes.overrides || changes.defaultYen || changes.yenOverrides) {
    stopObserver();
    clearHighlights();
    unmarkElements();
    applyLiveState();
    return;
  }

  if (changes.unit || changes.fx) {
    if (wasReady !== unitReady() || (changes.unit && isPaused())) {
      applyLiveState();
      return;
    }
    if (!live()) {
      teardown();
      return;
    }
    ensurePointerTracking();
    startObserver();
    refreshOpenTooltip();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "ping") {
    sendResponse({ ok: true });
    return;
  }
  if (message?.action === "teardown") {
    teardown();
    sendResponse({ ok: true });
    return;
  }
  if (message?.action !== "convertSelection") return;
  handleConvertSelection(message.text)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});

async function boot() {
  if (document.contentType && document.contentType !== "text/html") return;
  removeStrayTooltips(null);
  tooltipEl = null;
  const res = await chrome.runtime.sendMessage({ action: "getState" });
  state = res?.state;
  applyLiveState();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  handleStorageChange(changes).catch((err) => console.warn("UCE storage", err));
});

document.addEventListener("visibilitychange", onVisibilityChange);

boot().catch((err) => console.warn("UCE content", err));
})();
