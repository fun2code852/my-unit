/**
 * Precision price detection: currency signal required, closed symbol/ISO list.
 */
(function (root) {
  const UCE = root.UCE || (root.UCE = {});

  const ISO_GROUP = "USD|HKD|TWD|NTD|CNY|JPY|EUR|GBP|KRW|SGD|AUD|CAD|INR|RMB|CNH";
  const SYMBOL_GROUP = "HK\\$|NT\\$|US\\$|CN¥|A\\$|C\\$|S\\$|€|£|₩|₹|円|¥|￥|\\$";
  const NUMBER =
    "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?";
  const RANGE_SEPARATOR_GROUP = "-|–|—|−|~|～|to|至|到";

  const PREFIX_RE = new RegExp(`(${SYMBOL_GROUP}|(?<![A-Za-z])(?:${ISO_GROUP}))\\s*(${NUMBER})`, "gi");
  const SUFFIX_RE = new RegExp(`(${NUMBER})\\s*(${ISO_GROUP})\\b`, "gi");
  const RANGE_SEPARATOR_RE = new RegExp(`^(?:${RANGE_SEPARATOR_GROUP})$`, "i");
  const RANGE_TAIL_RE = new RegExp(`^\\s*(${RANGE_SEPARATOR_GROUP})\\s*(${NUMBER})`, "i");
  const RANGE_HEAD_RE = new RegExp(`(${NUMBER})\\s*(${RANGE_SEPARATOR_GROUP})\\s*$`, "i");

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

  function resolveSymbolPrefix(prefix, ctx) {
    const dollarFamily = prefix.token === "$" || (prefix.currency && UCE.DOLLAR_CODES.includes(prefix.currency));
    if (dollarFamily) {
      const forced = UCE.siteDollarOverride(ctx.hostname, ctx.overrides);
      if (forced) return { currency: forced, assumed: false };
      if (prefix.currency) return { currency: prefix.currency, assumed: false };
      const resolved = UCE.resolveDollarDetail(ctx.hostname, ctx.defaultDollar, ctx.overrides, ctx.pageDollar, ctx.configSites);
      return { currency: resolved.currency, assumed: resolved.source === "default" };
    }
    const yenFamily =
      prefix.token === "¥" || prefix.token === "￥" || (prefix.currency && UCE.YEN_CODES.includes(prefix.currency));
    if (yenFamily) {
      const forced = UCE.siteYenOverride(ctx.hostname, ctx.yenOverrides);
      if (forced) return { currency: forced, assumed: false };
      if (prefix.currency) return { currency: prefix.currency, assumed: false };
      const resolved = UCE.resolveYenDetail(ctx.hostname, ctx.defaultYen, ctx.yenOverrides, ctx.pageYen, ctx.configSites);
      return { currency: resolved.currency, assumed: resolved.source === "tld" || resolved.source === "default" };
    }
    return prefix.currency ? { currency: prefix.currency, assumed: false } : null;
  }

  function resolveToken(token, ctx) {
    const t = token.toUpperCase();
    if (UCE.ISO_ALIASES[t]) return { currency: UCE.ISO_ALIASES[t], assumed: false };
    if (UCE.ISO_CODES.includes(t)) return { currency: t, assumed: false };
    const prefix = UCE.SYMBOL_PREFIXES.find((p) => p.token.toUpperCase() === t || p.token === token);
    if (prefix) return resolveSymbolPrefix(prefix, ctx);
    const exact = UCE.SYMBOL_PREFIXES.find((p) => p.token === token);
    if (!exact) return null;
    return resolveSymbolPrefix(exact, ctx);
  }

  /** US$, HK$, ISO codes — not a bare $ / ¥. */
  UCE.explicitPrefixCurrency = function explicitPrefixCurrency(raw) {
    const source = UCE.normalizeNbsp(raw);
    for (const prefix of UCE.SYMBOL_PREFIXES) {
      if (prefix.currency && source.includes(prefix.token)) return prefix.currency;
    }
    const iso = source.toUpperCase().match(new RegExp(`(?:${ISO_GROUP})`));
    if (!iso) return null;
    return UCE.ISO_ALIASES[iso[0]] || iso[0];
  };

  UCE.tallyExplicitCurrencies = function tallyExplicitCurrencies(text, dollarCounts, yenCounts, ctx) {
    const hits = UCE.findPrices(text, ctx || {});
    for (const hit of hits) {
      if (!UCE.explicitPrefixCurrency(hit.raw)) continue;
      const code = hit.currency;
      if (UCE.DOLLAR_CODES.includes(code)) dollarCounts[code] = (dollarCounts[code] || 0) + 1;
      if (UCE.YEN_CODES.includes(code)) yenCounts[code] = (yenCounts[code] || 0) + 1;
    }
  };

  UCE.pageCurrencyHints = function pageCurrencyHints(text, ctx) {
    const dollar = {};
    const yen = {};
    UCE.tallyExplicitCurrencies(text, dollar, yen, ctx);
    return {
      dollar: UCE.majorityCode(dollar, UCE.DOLLAR_CODES),
      yen: UCE.majorityCode(yen, UCE.YEN_CODES),
    };
  };

  function addMatch(out, start, end, raw, amount, resolution) {
    if (!Number.isFinite(amount) || amount <= 0 || !resolution?.currency) return;
    for (const existing of out) {
      if (!(end <= existing.start || start >= existing.end)) return;
    }
    out.push({ start, end, raw, amount, currency: resolution.currency, assumed: resolution.assumed });
  }

  function addRangeTail(out, source, start, resolution) {
    const match = RANGE_TAIL_RE.exec(source.slice(start));
    if (!match) return;
    const numberStart = start + match[0].length - match[2].length;
    addMatch(out, numberStart, numberStart + match[2].length, match[2], UCE.parseNumber(match[2]), resolution);
  }

  function addRangeHead(out, source, end, resolution) {
    const match = RANGE_HEAD_RE.exec(source.slice(0, end));
    if (!match) return;
    const numberStart = end - match[0].length + match[0].indexOf(match[1]);
    addMatch(out, numberStart, numberStart + match[1].length, match[1], UCE.parseNumber(match[1]), resolution);
  }

  /**
   * @param {string} text
   * @param {{ hostname?: string, defaultDollar?: string, overrides?: Record<string,string>, defaultYen?: string, yenOverrides?: Record<string,string>, pageDollar?: string, pageYen?: string, configSites?: Record<string,{dollar?:string,yen?:string}> }} ctx
   */
  UCE.findPrices = function findPrices(text, ctx) {
    ctx = ctx || {};
    const source = UCE.normalizeNbsp(text);
    const found = [];

    PREFIX_RE.lastIndex = 0;
    let m;
    while ((m = PREFIX_RE.exec(source))) {
      const resolution = resolveToken(m[1], ctx);
      const amount = UCE.parseNumber(m[2]);
      addMatch(found, m.index, m.index + m[0].length, m[0], amount, resolution);
      addRangeTail(found, source, m.index + m[0].length, resolution);
    }

    SUFFIX_RE.lastIndex = 0;
    while ((m = SUFFIX_RE.exec(source))) {
      const resolution = resolveToken(m[2], ctx);
      const amount = UCE.parseNumber(m[1]);
      addMatch(found, m.index, m.index + m[0].length, m[0], amount, resolution);
      addRangeHead(found, source, m.index, resolution);
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

  UCE.isPriceRangeSeparator = function isPriceRangeSeparator(text) {
    const t = UCE.normalizeNbsp(text).trim();
    return RANGE_SEPARATOR_RE.test(t);
  };

  /** Whole piece that still needs a 1–2 digit fraction sibling (`89.` / `89,`). */
  UCE.isIncompleteWhole = function isIncompleteWhole(text) {
    const t = UCE.normalizeNbsp(text).trim();
    if (!t || !/[.,]$/.test(t)) return false;
    return UCE.isAmountText(t);
  };

  UCE.isFractionDigits = function isFractionDigits(text) {
    return /^\d{1,2}$/.test(UCE.normalizeNbsp(text).trim());
  };

  UCE.assembleWholeFraction = function assembleWholeFraction(whole, fraction) {
    return `${UCE.normalizeNbsp(whole).trim()}${UCE.normalizeNbsp(fraction).trim()}`;
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
