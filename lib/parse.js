/**
 * Precision price detection: currency signal required, closed symbol/ISO list.
 */
(function (root) {
  const UCE = root.UCE || (root.UCE = {});

  const ISO_GROUP = "USD|HKD|TWD|NTD|CNY|JPY|EUR|GBP|KRW|SGD|AUD|CAD|INR|RMB|CNH";
  const SYMBOL_GROUP = "HK\\$|NT\\$|US\\$|CN¥|A\\$|C\\$|S\\$|€|£|₩|₹|円|¥|\\$";
  const NUMBER =
    "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?";

  const PREFIX_RE = new RegExp(`(${SYMBOL_GROUP}|(?<![A-Za-z])(?:${ISO_GROUP}))\\s*(${NUMBER})`, "gi");
  const SUFFIX_RE = new RegExp(`(${NUMBER})\\s*(${ISO_GROUP})\\b`, "gi");

  function escapeRegex(s) {
    return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  }

  UCE.normalizeNbsp = function normalizeNbsp(text) {
    return String(text || "").replace(/\u00a0|\u202f/g, " ");
  };

  /**
   * Locale-aware numeric parse. Mirrors Opportunity Cost's separator rules.
   */
  UCE.parseNumber = function parseNumber(raw) {
    const v = String(raw || "")
      .replace(/\s/g, "")
      .trim();
    if (!v) return NaN;
    const hasPeriod = v.includes(".");
    const hasComma = v.includes(",");
    let normalized = v;
    if (hasPeriod && hasComma) {
      const lastPeriod = v.lastIndexOf(".");
      const lastComma = v.lastIndexOf(",");
      if (lastComma > lastPeriod) {
        normalized = v.replace(/\./g, "").replace(",", ".");
      } else {
        normalized = v.replace(/,/g, "");
      }
    } else if (hasPeriod && !hasComma) {
      const parts = v.split(".");
      if (parts.length > 2) {
        normalized = v.replace(/\./g, "");
      } else if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[1]) && parts[0].length <= 3) {
        // Ambiguous 1.425 — treat 3-digit fraction after a short integer as thousands (EU).
        // 78.370 would also trip this; prices like 78.37 have 2 fraction digits.
        normalized = v.replace(/\./g, "");
      }
    } else if (hasComma && !hasPeriod) {
      const parts = v.split(",");
      if (parts[parts.length - 1].length !== 3) {
        normalized = v.replace(/,/g, ".");
      } else {
        normalized = v.replace(/,/g, "");
      }
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
  };

  function resolveToken(token, ctx) {
    const t = token.toUpperCase();
    if (UCE.ISO_ALIASES[t]) return UCE.ISO_ALIASES[t];
    if (UCE.ISO_CODES.includes(t)) return t;
    const prefix = UCE.SYMBOL_PREFIXES.find((p) => p.token.toUpperCase() === t || p.token === token);
    if (!prefix) {
      // Case-sensitive symbols that failed upper-case compare (¥, €, …)
      const exact = UCE.SYMBOL_PREFIXES.find((p) => p.token === token);
      if (!exact) return null;
      if (exact.currency) return exact.currency;
      if (exact.token === "$") return UCE.resolveDollar(ctx.hostname, ctx.defaultDollar, ctx.overrides);
      if (exact.token === "¥") return UCE.resolveYen(ctx.hostname, ctx.defaultYen, ctx.yenOverrides);
      return null;
    }
    if (prefix.currency) return prefix.currency;
    if (prefix.token === "$") return UCE.resolveDollar(ctx.hostname, ctx.defaultDollar, ctx.overrides);
    if (prefix.token === "¥") return UCE.resolveYen(ctx.hostname, ctx.defaultYen, ctx.yenOverrides);
    return null;
  }

  function addMatch(out, start, end, raw, amount, currency) {
    if (!Number.isFinite(amount) || amount <= 0 || !currency) return;
    for (const existing of out) {
      if (!(end <= existing.start || start >= existing.end)) return;
    }
    out.push({ start, end, raw, amount, currency });
  }

  /**
   * @param {string} text
   * @param {{ hostname?: string, defaultDollar?: string, overrides?: Record<string,string>, defaultYen?: string, yenOverrides?: Record<string,string> }} ctx
   */
  UCE.findPrices = function findPrices(text, ctx) {
    ctx = ctx || {};
    const source = UCE.normalizeNbsp(text);
    const found = [];

    PREFIX_RE.lastIndex = 0;
    let m;
    while ((m = PREFIX_RE.exec(source))) {
      const currency = resolveToken(m[1], ctx);
      const amount = UCE.parseNumber(m[2]);
      addMatch(found, m.index, m.index + m[0].length, m[0], amount, currency);
    }

    SUFFIX_RE.lastIndex = 0;
    while ((m = SUFFIX_RE.exec(source))) {
      const currency = resolveToken(m[2], ctx);
      const amount = UCE.parseNumber(m[1]);
      addMatch(found, m.index, m.index + m[0].length, m[0], amount, currency);
    }

    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const deduped = [];
    for (const item of found) {
      const overlaps = deduped.some((d) => !(item.end <= d.start || item.start >= d.end));
      if (!overlaps) deduped.push(item);
    }
    return deduped;
  };

  UCE.parsePriceString = function parsePriceString(text, ctx) {
    const hits = UCE.findPrices(text, ctx);
    return hits[0] || null;
  };

  UCE.isCurrencyToken = function isCurrencyToken(text) {
    const t = UCE.normalizeNbsp(text).trim();
    if (!t || /\d/.test(t)) return false;
    if (UCE.SYMBOL_PREFIXES.some((p) => p.token === t)) return true;
    const upper = t.toUpperCase();
    return UCE.ISO_CODES.includes(upper) || Boolean(UCE.ISO_ALIASES[upper]);
  };

  UCE.isAmountText = function isAmountText(text) {
    const t = UCE.normalizeNbsp(text).trim();
    if (!t || /[a-zA-Z\u4e00-\u9fff]/.test(t)) return false;
    if (!/^[\d.,\s]+$/.test(t)) return false;
    const n = UCE.parseNumber(t);
    return Number.isFinite(n) && n > 0;
  };

  UCE.escapeRegex = escapeRegex;
})(typeof globalThis !== "undefined" ? globalThis : this);
