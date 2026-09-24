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
let tooltipHost = null;
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
let pageHints = { dollar: null, yen: null, ready: false };
const HINT_TEXT_RE = /[$¥￥円]|USD|HKD|TWD|NTD|SGD|AUD|CAD|JPY|CNY|RMB|CNH/i;
const pendingRoots = new Set();
const strikeCache = new WeakMap();
const markedEls = new WeakSet();

const TOOLTIP_CSS =
  "#t{all:initial;display:block;box-sizing:border-box;max-width:min(280px,calc(100vw - 16px));padding:6px 10px;border-radius:6px;background:#c54546;color:#fff;font-size:12px;line-height:1.35;font-family:HelveticaNeueCustom,\"Helvetica Neue\",Helvetica,sans-serif;pointer-events:none!important;white-space:pre-line;overflow-wrap:anywhere}";

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
    pageDollar: pageHints.dollar,
    pageYen: pageHints.yen,
    configSites: state?.siteConfig?.sites || {},
  };
}

function skipHarvestEl(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el === tooltipHost) return true;
  if (el.closest("[contenteditable='true'], [contenteditable='']")) return true;
  return false;
}

function addHintCode(code, dollarCounts, yenCounts) {
  const raw = String(code || "")
    .trim()
    .toUpperCase();
  const c = UCE.ISO_ALIASES[raw] || raw;
  if (UCE.DOLLAR_CODES.includes(c)) dollarCounts[c] = (dollarCounts[c] || 0) + 1;
  if (UCE.YEN_CODES.includes(c)) yenCounts[c] = (yenCounts[c] || 0) + 1;
}

function collectJsonLdCurrencies(node, dollarCounts, yenCounts, depth) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdCurrencies(item, dollarCounts, yenCounts, depth + 1);
    return;
  }
  if (typeof node.priceCurrency === "string") addHintCode(node.priceCurrency, dollarCounts, yenCounts);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectJsonLdCurrencies(value, dollarCounts, yenCounts, depth + 1);
  }
}

function tallyMetaCurrencies(dollarCounts, yenCounts) {
  const og = document.querySelector('meta[property="og:price:currency"], meta[itemprop="priceCurrency"]');
  if (og?.content) addHintCode(og.content, dollarCounts, yenCounts);
  let n = 0;
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (n++ > 30) break;
    try {
      collectJsonLdCurrencies(JSON.parse(el.textContent), dollarCounts, yenCounts, 0);
    } catch {
      /* page JSON-LD is often truncated */
    }
  }
}

function harvestPageHints(root) {
  const dollarCounts = {};
  const yenCounts = {};
  const scope = root && root.nodeType === Node.ELEMENT_NODE ? root : document.body;
  if (!scope) {
    pageHints = { dollar: null, yen: null, ready: false };
    return pageHints;
  }
  const ctx = {
    hostname: hostName(),
    defaultDollar: state?.defaultDollar || UCE.DEFAULT_DOLLAR_CURRENCY,
    overrides: {},
    defaultYen: state?.defaultYen || UCE.DEFAULT_YEN_CURRENCY,
    yenOverrides: {},
  };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skipHarvestEl(parent)) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || !HINT_TEXT_RE.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    UCE.tallyExplicitCurrencies(node.textContent, dollarCounts, yenCounts, ctx);
  }
  tallyMetaCurrencies(dollarCounts, yenCounts);
  pageHints = {
    dollar: UCE.majorityCode(dollarCounts, UCE.DOLLAR_CODES),
    yen: UCE.majorityCode(yenCounts, UCE.YEN_CODES),
    ready: true,
  };
  return pageHints;
}

function unitReady() {
  if (!state?.unit || !state.unit.currency) return false;
  if (state.unit.type === "currency") return true;
  return Number(state.unit.price) > 0;
}

function isPaused() {
  return UCE.hostPaused(state?.pausedHosts, hostName());
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

function conversionText(amount, currency, assumed = false) {
  if (!state?.unit) return null;
  const short = conversionShort(amount, currency);
  const lines = [short || chrome.i18n.getMessage("tipFxNeeded")];
  if (assumed) lines.push(chrome.i18n.getMessage("tipAssumedCurrency", currency));
  if (state.unit.type !== "yahoo") return lines.join("\n");
  const asOf = state.unit.asOfSource === "market" ? UCE.formatAsOf(state.unit.asOf) : "";
  if (short && asOf) lines.push(chrome.i18n.getMessage("quoteAsOf", asOf));
  return lines.join("\n");
}

function ensureTooltip() {
  if (tooltipHost && tooltipHost.isConnected && tooltipEl) return tooltipEl;
  if (tooltipHost) tooltipHost.remove();
  tooltipHost = document.createElement("div");
  tooltipHost.setAttribute("aria-hidden", "true");
  tooltipHost.style.cssText =
    "position:fixed;z-index:2147483646;pointer-events:none;width:max-content;max-width:min(280px,calc(100vw - 16px))";
  tooltipHost.style.setProperty("pointer-events", "none", "important");
  tooltipHost.style.setProperty("z-index", "2147483646", "important");
  tooltipHost.hidden = true;
  tooltipHost.style.setProperty("display", "none", "important");
  const shadow = tooltipHost.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = TOOLTIP_CSS;
  tooltipEl = document.createElement("div");
  tooltipEl.id = "t";
  shadow.append(style, tooltipEl);
  (document.body || document.documentElement).appendChild(tooltipHost);
  return tooltipEl;
}

function setTooltipVisible(visible) {
  if (!tooltipHost) return;
  tooltipHost.hidden = !visible;
  // Shadow content does not stop the host matching page rules such as `div:empty { display: none }`.
  tooltipHost.style.setProperty("display", visible ? "block" : "none", "important");
}

function showTooltipAtRect(rect, text) {
  const tip = ensureTooltip();
  if (tip.textContent !== text) tip.textContent = text;
  setTooltipVisible(true);
  const tipHeight = tooltipHost.offsetHeight || 28;
  const tipWidth = Math.min(tooltipHost.offsetWidth || 160, 280);
  const above = rect.top - tipHeight - 8;
  const below = rect.bottom + 8;
  const top = above >= 8 ? above : below;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - tipWidth - 8);
  tooltipHost.style.top = `${Math.round(Math.max(8, top))}px`;
  tooltipHost.style.left = `${Math.round(left)}px`;
}

function hideTooltip() {
  hoverPayload = null;
  lastHover = null;
  setTooltipVisible(false);
}

function pinTooltip(ms) {
  pinUntil = Date.now() + ms;
  setTimeout(() => {
    if (Date.now() >= pinUntil) hideTooltip();
  }, ms + 50);
}

function showPriceTooltip(amount, currency, assumed, getRect, key) {
  lastHover = key;
  hoverPayload = { amount, currency, assumed, getRect };
  showTooltipAtRect(getRect(), conversionText(amount, currency, assumed));
}

function refreshOpenTooltip() {
  if (!tooltipHost || tooltipHost.hidden || !hoverPayload) return;
  const key = lastHover;
  if (key && key.nodeType === Node.ELEMENT_NODE) {
    if (!key.isConnected || !markedEls.has(key)) {
      hideTooltip();
      return;
    }
    showPriceTooltip(Number(key.dataset.uceAmount), key.dataset.uceCurrency, key.dataset.uceAssumed === "1", () => key.getBoundingClientRect(), key);
    return;
  }
  if (key && key.startContainer) {
    const exact = priceRanges.find(
      (item) =>
        item.range.startContainer === key.startContainer &&
        item.range.startOffset === key.startOffset &&
        item.range.endOffset === key.endOffset,
    );
    const item = exact || priceRanges.find((p) => p.range.startContainer === key.startContainer);
    if (!item) {
      hideTooltip();
      return;
    }
    showPriceTooltip(item.amount, item.currency, item.assumed, () => item.range.getBoundingClientRect(), item.range);
    return;
  }
  showTooltipAtRect(hoverPayload.getRect(), conversionText(hoverPayload.amount, hoverPayload.currency, hoverPayload.assumed));
}

const MARK_SEL = ".uce-price, .uce-amazon-mark, .uce-split";

function markPrice(el, amount, currency, assumed = false) {
  markedEls.add(el);
  el.classList.add("uce-price");
  el.dataset.uceAmount = String(amount);
  el.dataset.uceCurrency = currency;
  if (assumed) el.dataset.uceAssumed = "1";
  else delete el.dataset.uceAssumed;
  el.dataset.uceBound = "1";
}

function unmarkOne(el) {
  markedEls.delete(el);
  el.classList.remove("uce-price", "uce-amazon-mark", "uce-split");
  delete el.dataset.uceAmount;
  delete el.dataset.uceCurrency;
  delete el.dataset.uceAssumed;
  delete el.dataset.uceBound;
}

function unmarkElements() {
  document.querySelectorAll(MARK_SEL).forEach(unmarkOne);
}

function unmarkElementsIn(root) {
  if (!root || root === document.body || root === document.documentElement) {
    unmarkElements();
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(MARK_SEL)) unmarkOne(root);
  if (root.querySelectorAll) root.querySelectorAll(MARK_SEL).forEach(unmarkOne);
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

function addPriceRange(node, start, end, amount, currency, assumed = false) {
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
  priceRanges.push({ range, amount, currency, assumed });
  if (!highlightApi()) {
    const parent = node.parentElement;
    if (parent && parent.childNodes.length === 1 && start === 0 && end === (node.textContent || "").length) {
      markPrice(parent, amount, currency, assumed);
    }
  }
}

function elementRoot(root) {
  if (!root) return document.body;
  if (root.nodeType === Node.ELEMENT_NODE) return root;
  if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return root;
  return root.parentElement || document.body;
}

function isSplitScanPiece(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const text = UCE.normalizeNbsp(el.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    UCE.isCurrencyToken(text) ||
    UCE.isAmountText(text) ||
    UCE.isFractionDigits(text) ||
    UCE.isPriceRangeSeparator(text)
  );
}

function hasAdjacentRangeSeparator(el) {
  return (
    UCE.isPriceRangeSeparator(skipEmptySiblings(el, "next")?.textContent || "") ||
    UCE.isPriceRangeSeparator(skipEmptySiblings(el, "prev")?.textContent || "")
  );
}

/** Inner Amazon/split mutations should rebind the host, not a child. */
function expandScanRoot(root) {
  const el = elementRoot(root);
  if (!el || el === document.body || el === document.documentElement) return el;
  const host = el.closest?.(".a-price, .uce-price");
  if (host?.classList.contains("a-price")) return host;
  if (host?.classList.contains("uce-split")) {
    const parent = host.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) return parent;
  }
  if (host && hasAdjacentRangeSeparator(host)) {
    const parent = host.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) return parent;
  }
  if (host) return host;
  if (!isSplitScanPiece(el) && !hasAdjacentRangeSeparator(el)) return el;
  const parent = el.parentElement;
  if (!parent || parent === document.body || parent === document.documentElement) return el;
  return parent;
}

function skipWalkEl(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el === tooltipHost) return true;
  if (el.closest(".uce-price, .a-price")) return true;
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
  for (const hit of hits) addPriceRange(node, hit.start, hit.end, hit.amount, hit.currency, hit.assumed);
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

function markSplitPiece(textNode, markEl, raw, amount, currency, assumed = false) {
  if (markEl && elementIsSolePiece(markEl, raw)) {
    markPrice(markEl, amount, currency, assumed);
    markEl.classList.add("uce-split");
    return;
  }
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    addPriceRange(textNode, 0, (textNode.textContent || "").length, amount, currency, assumed);
  }
}

function fractionFromNextSibling(candidate) {
  const next = skipEmptySiblings(candidate, "next");
  if (!next) return null;
  if (next.nodeType === Node.ELEMENT_NODE && (next.closest(".uce-price") || isStruckThrough(next))) return null;
  if (!UCE.isFractionDigits(next.textContent || "")) return null;
  if (next.nodeType === Node.TEXT_NODE) {
    return { raw: next.textContent, textNode: next, markEl: next.parentElement, candidate: next };
  }
  const textNode = [...next.childNodes].find(
    (node) => node.nodeType === Node.TEXT_NODE && UCE.isFractionDigits(node.textContent),
  );
  return { raw: next.textContent, textNode: textNode || null, markEl: next, candidate: next };
}

function parsedAmountCandidate(candidate, currency, assumed) {
  const found = amountFromCandidate(candidate);
  if (!found || !found.markEl || isStruckThrough(found.markEl)) return null;
  let amountRaw = found.amount;
  let fraction = null;
  if (UCE.isIncompleteWhole(found.amount)) {
    fraction = fractionFromNextSibling(candidate);
    if (!fraction) return null;
    amountRaw = UCE.assembleWholeFraction(found.amount, fraction.raw);
  }
  const parsed = UCE.parsePriceString(`${currency} ${amountRaw}`, parseCtx());
  return parsed ? { found, fraction, parsed: { ...parsed, assumed } } : null;
}

function markParsedAmount(bound) {
  markSplitPiece(bound.found.textNode, bound.found.markEl, bound.found.amount, bound.parsed.amount, bound.parsed.currency, bound.parsed.assumed);
  if (bound.fraction) {
    markSplitPiece(
      bound.fraction.textNode,
      bound.fraction.markEl,
      bound.fraction.raw,
      bound.parsed.amount,
      bound.parsed.currency,
      bound.parsed.assumed,
    );
  }
}

function rangeBoundFromSibling(candidate, direction, currency, assumed) {
  const separator = skipEmptySiblings(candidate, direction);
  if (!separator || !UCE.isPriceRangeSeparator(separator.textContent || "")) return null;
  const separatorEl = separator.nodeType === Node.ELEMENT_NODE ? separator : separator.parentElement;
  if (separatorEl?.closest(".uce-price") || isStruckThrough(separator)) return null;

  const boundCandidate = skipEmptySiblings(separator, direction);
  if (!boundCandidate) return null;
  const boundEl = boundCandidate.nodeType === Node.ELEMENT_NODE ? boundCandidate : boundCandidate.parentElement;
  if (boundEl?.closest(".uce-price") || isStruckThrough(boundCandidate)) return null;
  return parsedAmountCandidate(boundCandidate, currency, assumed);
}

function adjacentRangeAnchor(node, direction) {
  let current = node;
  while (current && current.parentElement && current.parentElement !== document.body) {
    const sibling = skipEmptySiblings(current, direction);
    if (sibling) return UCE.isPriceRangeSeparator(sibling.textContent || "") ? current : null;
    const parent = current.parentElement;
    if (UCE.normalizeNbsp(parent.textContent).trim() !== UCE.normalizeNbsp(node.textContent).trim()) return null;
    current = parent;
  }
  return null;
}

function processInlineRangeSiblings(root) {
  if (!live()) return;
  const scope = elementRoot(root);
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skipWalkEl(parent) || isStruckThrough(parent) || !/\d/.test(node.textContent || "")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let current;
  while ((current = walker.nextNode())) nodes.push(current);
  for (const node of nodes) {
    const text = node.textContent || "";
    for (const hit of UCE.findPrices(text, parseCtx())) {
      if (!text.slice(hit.end).trim()) {
        const anchor = adjacentRangeAnchor(node, "next");
        if (anchor) {
          const bound = rangeBoundFromSibling(anchor, "next", hit.currency, hit.assumed);
          if (bound) markParsedAmount(bound);
        }
      }
      if (!text.slice(0, hit.start).trim()) {
        const anchor = adjacentRangeAnchor(node, "prev");
        if (anchor) {
          const bound = rangeBoundFromSibling(anchor, "prev", hit.currency, hit.assumed);
          if (bound) markParsedAmount(bound);
        }
      }
    }
  }
}

/**
 * Currency-only text next to an amount: element sibling, nested amount, or
 * following text. Trailing-decimal wholes (`89.`) join the next 1–2 digit
 * sibling. A range separator carries the resolved currency to one following
 * amount. No site class names. Never marks a common ancestor.
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
    const parentText = currencyEl.textContent || "";
    if (!UCE.isCurrencyToken(parentText) && UCE.findPrices(parentText, parseCtx()).length) continue;

    const candidates = [
      skipEmptySiblings(currencyEl, "next"),
      skipEmptySiblings(currencyEl, "prev"),
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
      let amountRaw = found.amount;
      let fraction = null;
      if (UCE.isIncompleteWhole(found.amount)) {
        fraction = fractionFromNextSibling(candidate);
        if (!fraction) continue;
        amountRaw = UCE.assembleWholeFraction(found.amount, fraction.raw);
      }
      const parsed = UCE.parsePriceString(`${node.textContent} ${amountRaw}`, parseCtx());
      if (!parsed) continue;
      const rangeUpper = rangeBoundFromSibling(fraction?.candidate || candidate, "next", parsed.currency, parsed.assumed);
      const rangeLower = rangeBoundFromSibling(candidate, "prev", parsed.currency, parsed.assumed);
      markSplitPiece(node, currencyEl, node.textContent, parsed.amount, parsed.currency, parsed.assumed);
      markParsedAmount({ found, fraction, parsed });
      if (rangeUpper) markParsedAmount(rangeUpper);
      if (rangeLower) markParsedAmount(rangeLower);
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
    markPrice(priceEl, parsed.amount, parsed.currency, parsed.assumed);
    if (vis) vis.classList.add("uce-amazon-mark");
  });
}

function scan(root) {
  if (!live()) return;
  const target = expandScanRoot(root);
  if (!target || !target.isConnected) return;
  const full = target === document.body || target === document.documentElement;
  if (full || !pageHints.ready) harvestPageHints(document.body);
  unmarkElementsIn(target);
  pruneRangesIn(target);
  processAmazon(target);
  processSplitSiblings(target);
  processInlineRangeSiblings(target);
  walk(target);
  syncHighlight();
  refreshOpenTooltip();
}

function collapseRoots(roots) {
  const els = [...new Set(roots.map(expandScanRoot).filter(Boolean))];
  return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
}

function isOurNode(node) {
  return !node || node === tooltipHost;
}

function skipObserverTarget(node) {
  if (isOurNode(node)) return true;
  const el = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
  return Boolean(el && SKIP_TAGS.has(el.tagName));
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
      if (skipObserverTarget(rec.target)) continue;
      invalidateStrike(rec.target);
      const targetIsRoot = rec.target === document.body || rec.target === document.documentElement;
      if (!targetIsRoot) pendingRoots.add(rec.target);
      rec.addedNodes.forEach((node) => {
        if (skipObserverTarget(node)) return;
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) pendingRoots.add(node);
      });
    }
    if (pendingRoots.size) scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function priceElFromTarget(target) {
  if (!target || target === tooltipHost) return null;
  if (target.nodeType !== Node.ELEMENT_NODE) target = target.parentElement;
  const hit = target?.closest?.(".uce-price");
  return hit && markedEls.has(hit) ? hit : null;
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
    if (!el || el === tooltipHost) continue;
    if (markedEls.has(el)) return el;
    const hit = el.closest?.(".uce-price");
    if (hit && markedEls.has(hit)) return hit;
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

function hoverUnchanged(key, amount, currency, assumed) {
  return lastHover === key && hoverPayload?.amount === amount && hoverPayload?.currency === currency && hoverPayload?.assumed === assumed;
}

function updateHover(x, y, target) {
  if (Date.now() < pinUntil) return;
  const el = priceElFromTarget(target) || priceElFromPoint(x, y);
  if (el) {
    const amount = Number(el.dataset.uceAmount);
    const currency = el.dataset.uceCurrency;
    const assumed = el.dataset.uceAssumed === "1";
    if (hoverUnchanged(el, amount, currency, assumed)) return;
    showPriceTooltip(amount, currency, assumed, () => el.getBoundingClientRect(), el);
    return;
  }
  const item = rangeHitFromPoint(x, y);
  if (item) {
    if (hoverUnchanged(item.range, item.amount, item.currency, item.assumed)) return;
    showPriceTooltip(item.amount, item.currency, item.assumed, () => item.range.getBoundingClientRect(), item.range);
    return;
  }
  hideTooltip();
}

function onPointerOver(event) {
  if (Date.now() < pinUntil) return;
  const el = priceElFromTarget(event.target);
  if (!el || lastHover === el) return;
  showPriceTooltip(Number(el.dataset.uceAmount), el.dataset.uceCurrency, el.dataset.uceAssumed === "1", () => el.getBoundingClientRect(), el);
}

function onPointerOut(event) {
  if (Date.now() < pinUntil) return;
  const leaving = priceElFromTarget(event.target);
  if (!leaving) return;
  const next = priceElFromTarget(event.relatedTarget);
  if (next) return;
  lastHover = null;
  hoverPayload = null;
  setTooltipVisible(false);
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
  showPriceTooltip(Number(el.dataset.uceAmount), el.dataset.uceCurrency, el.dataset.uceAssumed === "1", () => el.getBoundingClientRect(), el);
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
  if (tooltipHost) tooltipHost.remove();
  tooltipHost = null;
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

function runtimeAlive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function isDisconnectError(err) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /Receiving end does not exist|message channel closed|Extension context invalidated/i.test(msg);
}

async function requestState() {
  if (!runtimeAlive()) return null;
  try {
    const res = await chrome.runtime.sendMessage({ action: "getState" });
    if (res?.state) return res;
  } catch (err) {
    if (!isDisconnectError(err)) throw err;
  }
  try {
    const stored = await chrome.storage.local.get({
      unit: null,
      defaultDollar: UCE.DEFAULT_DOLLAR_CURRENCY,
      defaultYen: UCE.DEFAULT_YEN_CURRENCY,
      overrides: {},
      yenOverrides: {},
      pausedHosts: [],
      fx: null,
      siteConfig: null,
    });
    return {
      state: {
        unit: stored.unit ?? null,
        defaultDollar: stored.defaultDollar || UCE.DEFAULT_DOLLAR_CURRENCY,
        defaultYen: stored.defaultYen || UCE.DEFAULT_YEN_CURRENCY,
        overrides: stored.overrides || {},
        yenOverrides: stored.yenOverrides || {},
        pausedHosts: stored.pausedHosts || [],
        fx: stored.fx || null,
        siteConfig: stored.siteConfig || null,
      },
    };
  } catch {
    return null;
  }
}

async function handleConvertSelection(raw) {
  if (!state) {
    const res = await requestState();
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
  const text = conversionText(parsed.amount, parsed.currency, parsed.assumed);
  showTooltipAtRect(rect, text || chrome.i18n.getMessage("tipFxNeeded"));
  pinTooltip(4000);
}

async function refreshState() {
  const res = await requestState();
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

  if (changes.defaultDollar || changes.overrides || changes.defaultYen || changes.yenOverrides || changes.siteConfig) {
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
  if (message?.action === "getPageHints") {
    sendResponse(harvestPageHints(document.body));
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
  if (tooltipHost) tooltipHost.remove();
  tooltipHost = null;
  tooltipEl = null;
  try {
    if (highlightApi()) CSS.highlights.delete(HIGHLIGHT_NAME);
  } catch {
    /* previous isolated world may have left a dead highlight */
  }
  document.querySelectorAll(MARK_SEL).forEach(unmarkOne);
  priceRanges = [];

  let res = await requestState();
  for (let i = 0; !res?.state && i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    res = await requestState();
  }
  if (!res?.state) return;
  state = res.state;
  applyLiveState();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!runtimeAlive()) return;
  handleStorageChange(changes).catch((err) => {
    if (!isDisconnectError(err)) console.warn("UCE storage", err);
  });
});

document.addEventListener("visibilitychange", onVisibilityChange);

boot().catch((err) => {
  if (!isDisconnectError(err)) console.warn("UCE content", err);
});
})();
