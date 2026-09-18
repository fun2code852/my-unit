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

let state = null;
let tooltipEl = null;
let observer = null;
let scheduled = false;

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
        ? state.unit.shortName || state.unit.symbol || "units"
        : state.unit.name || state.unit.symbol || "units";
  return `${formatted} ${label}`;
}

function conversionText(amount, currency) {
  const short = conversionShort(amount, currency);
  if (!short) return null;
  if (state.unit.type !== "yahoo") return short;
  const asOf = UCE.formatAsOf(state.unit.asOf);
  return asOf ? `${short} · as of ${asOf}` : short;
}

function ensureTooltip() {
  if (tooltipEl && tooltipEl.isConnected) return tooltipEl;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "uce-tooltip";
  tooltipEl.hidden = true;
  (document.body || document.documentElement).appendChild(tooltipEl);
  return tooltipEl;
}

function showTooltipAtRect(rect, text) {
  const tip = ensureTooltip();
  tip.textContent = text;
  tip.hidden = false;
  const tipHeight = tip.offsetHeight || 28;
  const below = rect.bottom + 8;
  const top = below + tipHeight > window.innerHeight ? rect.top - tipHeight - 8 : below;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - 288);
  tip.style.top = `${Math.round(Math.max(8, top))}px`;
  tip.style.left = `${Math.round(left)}px`;
}

function showTooltip(anchor, text) {
  showTooltipAtRect(anchor.getBoundingClientRect(), text);
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.hidden = true;
}

let pinUntil = 0;
function pinTooltip(ms) {
  pinUntil = Date.now() + ms;
  setTimeout(() => {
    if (Date.now() >= pinUntil) hideTooltip();
  }, ms + 50);
}

function markPrice(el, amount, currency) {
  el.classList.add("uce-price");
  el.dataset.uceAmount = String(amount);
  el.dataset.uceCurrency = currency;
  el.dataset.uceBound = "1";
}

function priceFromPoint(x, y) {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!el || el === tooltipEl) continue;
    if (el.classList?.contains("uce-price")) return el;
    const hit = el.closest?.(".uce-price");
    if (hit) return hit;
  }
  return null;
}

let pointerTracking = false;
let lastHover = null;
function onPointerMove(event) {
  if (Date.now() < pinUntil) return;
  const hit = priceFromPoint(event.clientX, event.clientY);
  if (!hit) {
    lastHover = null;
    hideTooltip();
    return;
  }
  lastHover = hit;
  const text = conversionText(Number(hit.dataset.uceAmount), hit.dataset.uceCurrency);
  if (text) showTooltip(hit, text);
  else hideTooltip();
}

function ensurePointerTracking() {
  if (pointerTracking) return;
  pointerTracking = true;
  document.addEventListener("mousemove", onPointerMove, true);
}

let strikeGen = 0;
const strikeCache = new WeakMap();

function isStruckThrough(el) {
  let node = el;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const chain = [];
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && node !== document.documentElement) {
    const cached = strikeCache.get(node);
    if (cached && cached.gen === strikeGen) {
      for (const item of chain) strikeCache.set(item, { gen: strikeGen, value: cached.value });
      return cached.value;
    }
    chain.push(node);
    const style = getComputedStyle(node);
    const line = `${style.textDecorationLine || ""} ${style.textDecoration || ""}`;
    if (/\bline-through\b/.test(line) || node.tagName === "S" || node.tagName === "DEL") {
      for (const item of chain) strikeCache.set(item, { gen: strikeGen, value: true });
      return true;
    }
    node = node.parentElement;
  }
  for (const item of chain) strikeCache.set(item, { gen: strikeGen, value: false });
  return false;
}

function skipSubtree(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest(".uce-price, .uce-tooltip, .a-price")) return true;
  if (el.closest("[contenteditable='true'], [contenteditable='']")) return true;
  if (isStruckThrough(el)) return true;
  return false;
}

function wrapTextNode(node) {
  const text = node.textContent || "";
  const hits = UCE.findPrices(text, parseCtx());
  if (!hits.length) return;
  const parent = node.parentElement;
  if (!parent || skipSubtree(parent) || isStruckThrough(parent)) return;
  if (parent.closest(".uce-price")) return;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      frag.appendChild(document.createTextNode(text.slice(cursor, hit.start)));
    }
    const span = document.createElement("span");
    span.textContent = text.slice(hit.start, hit.end);
    markPrice(span, hit.amount, hit.currency);
    frag.appendChild(span);
    cursor = hit.end;
  }
  if (cursor < text.length) {
    frag.appendChild(document.createTextNode(text.slice(cursor)));
  }
  parent.replaceChild(frag, node);
}

function walk(root) {
  if (!root || !unitReady() || isPaused()) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skipSubtree(parent)) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || !/[0-9]/.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let current;
  while ((current = walker.nextNode())) nodes.push(current);
  for (const node of nodes) wrapTextNode(node);
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
    return { markEl: candidate.parentElement, amount: candidate.textContent };
  }
  if (candidate.nodeType !== Node.ELEMENT_NODE) return null;
  const direct = directText(candidate);
  if (UCE.isAmountText(direct)) return { markEl: candidate, amount: direct };
  const nested = soleAmountIn(candidate);
  if (!nested) return null;
  return { markEl: nested.parentElement || candidate, amount: nested.textContent };
}

function wrapText(node, className) {
  const span = document.createElement("span");
  span.className = className;
  node.parentNode.insertBefore(span, node);
  span.appendChild(node);
  return span;
}

function nearestHost(a, b) {
  const seen = new Set();
  for (let el = a; el; el = el.parentElement) seen.add(el);
  for (let el = b; el; el = el.parentElement) {
    if (seen.has(el)) return el;
  }
  return a;
}

/**
 * Currency-only text next to an amount: element sibling, nested amount, or
 * following text. No site class names.
 */
function processSplitSiblings() {
  if (!unitReady() || isPaused()) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skipSubtree(parent)) return NodeFilter.FILTER_REJECT;
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
      if (isStruckThrough(found.markEl) || isStruckThrough(currencyEl)) continue;
      const parsed = UCE.parsePriceString(`${node.textContent} ${found.amount}`, parseCtx());
      if (!parsed) continue;
      const host = nearestHost(currencyEl, found.markEl);
      markPrice(host, parsed.amount, parsed.currency);
      host.classList.add("uce-split");
      wrapText(node, "uce-split-mark");
      if (found.markEl !== host) found.markEl.classList.add("uce-split-mark");
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

function amazonWidgets() {
  const hosts = new Set(document.querySelectorAll(".a-price"));
  document.querySelectorAll(".a-price-whole").forEach((whole) => {
    if (whole.closest(".a-price")) return;
    const vis = whole.parentElement;
    const host = vis && vis.parentElement ? vis.parentElement : vis;
    if (host) hosts.add(host);
  });
  return hosts;
}

function processAmazon() {
  if (!unitReady() || isPaused()) return;
  amazonWidgets().forEach((priceEl) => {
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
  strikeGen += 1;
  processAmazon();
  processSplitSiblings();
  walk(root || document.body);
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    scan(document.body);
  });
}

function startObserver() {
  if (observer || !document.body) return;
  observer = new MutationObserver(() => {
    if (!unitReady() || isPaused()) return;
    scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
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
    showTooltipAtRect(rect, "Save a unit in My Unit first");
    pinTooltip(4000);
    return;
  }
  const parsed = UCE.parsePriceString(raw, parseCtx());
  if (!parsed) {
    showTooltipAtRect(rect, "No price in that selection");
    pinTooltip(4000);
    return;
  }
  const text = conversionText(parsed.amount, parsed.currency);
  showTooltipAtRect(rect, text || "Need FX rates for this conversion");
  pinTooltip(4000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== "convertSelection") return;
  handleConvertSelection(message.text)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});

async function boot() {
  if (document.contentType && document.contentType !== "text/html") return;
  const res = await chrome.runtime.sendMessage({ action: "getState" });
  state = res?.state;
  if (!unitReady() || isPaused()) return;
  scan(document.body);
  ensurePointerTracking();
  startObserver();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.pausedHosts ||
    changes.unit ||
    changes.defaultDollar ||
    changes.overrides ||
    changes.defaultYen ||
    changes.yenOverrides
  ) {
    window.location.reload();
    return;
  }
  if (changes.fx) {
    chrome.runtime.sendMessage({ action: "getState" }).then((res) => {
      state = res?.state;
    });
  }
});

boot().catch((err) => console.warn("UCE content", err));
