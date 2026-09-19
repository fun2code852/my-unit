(function (root) {
  const UCE = root.UCE || (root.UCE = {});

  UCE.toUsd = function toUsd(amount, currency, fx) {
    if (!fx || !currency || !Number.isFinite(amount)) return null;
    const code = currency.toUpperCase();
    if (code === fx.base) return amount;
    const rate = fx.rates && fx.rates[code];
    if (!rate) return null;
    return amount / rate;
  };

  /** ISO codes we support that this FX snapshot cannot convert (USD is the base). */
  UCE.missingFxCodes = function missingFxCodes(fx) {
    return UCE.ISO_CODES.filter((code) => {
      if (code === "USD") return false;
      const rate = fx && fx.rates && fx.rates[code];
      return !(Number.isFinite(rate) && rate > 0);
    });
  };

  /** HKDJPY=X → { base: HKD, quote: JPY }. JPY=X is USDJPY. Stocks return null. */
  UCE.parseYahooFx = function parseYahooFx(symbol) {
    const s = String(symbol || "")
      .toUpperCase()
      .trim();
    const pair = s.match(/^([A-Z]{3})([A-Z]{3})=X$/);
    if (pair) return { base: pair[1], quote: pair[2] };
    const vsUsd = s.match(/^([A-Z]{3})=X$/);
    if (vsUsd) return { base: "USD", quote: vsUsd[1] };
    return null;
  };

  function amountInCurrency(amount, from, to, fx) {
    if (from === to) return amount;
    const usd = UCE.toUsd(amount, from, fx);
    if (usd == null) return null;
    if (to === "USD" || (fx && to === fx.base)) return usd;
    const rate = fx && fx.rates && fx.rates[to];
    if (!rate) return null;
    return usd * rate;
  }

  /**
   * Custom / stock: pageAmount / unitPrice (both in USD via Frankfurter).
   * Currency tab: page amount in the chosen ISO code (Frankfurter).
   * Yahoo FX ticker: right side = quote = currency you use.
   */
  UCE.fxOutputCurrency = function fxOutputCurrency(symbol) {
    const pair = UCE.parseYahooFx(symbol);
    return pair ? pair.quote : null;
  };

  UCE.convertToUnit = function convertToUnit(pageAmount, pageCurrency, unit, fx) {
    if (!unit) return null;
    if (!Number.isFinite(pageAmount) || pageAmount <= 0) return null;
    const from = (pageCurrency || "").toUpperCase();
    if (!from) return null;

    if (unit.type === "currency") {
      const to = (unit.currency || "").toUpperCase();
      if (!to) return null;
      return amountInCurrency(pageAmount, from, to, fx);
    }

    if (!Number.isFinite(unit.price) || unit.price <= 0) return null;

    const pair = unit.type === "yahoo" ? UCE.parseYahooFx(unit.symbol) : null;
    if (pair) {
      if (from === pair.quote) return pageAmount;
      if (from === pair.base) return pageAmount * unit.price;
      const inBase = amountInCurrency(pageAmount, from, pair.base, fx);
      if (inBase == null) return null;
      return inBase * unit.price;
    }

    const to = (unit.currency || "").toUpperCase();
    if (!to) return null;
    if (from === to) return pageAmount / unit.price;
    const pageUsd = UCE.toUsd(pageAmount, from, fx);
    const unitUsd = UCE.toUsd(unit.price, to, fx);
    if (pageUsd == null || unitUsd == null || unitUsd === 0) return null;
    return pageUsd / unitUsd;
  };

  UCE.formatCount = function formatCount(count) {
    if (!Number.isFinite(count) || count <= 0) return null;
    if (count >= 1) {
      const decimals = count >= 100 ? 1 : 2;
      return trimFloat(count, decimals);
    }
    if (count >= 0.01) return trimFloat(count, 3);
    const mag = Math.floor(Math.log10(count));
    const decimals = Math.min(8, -mag + 2);
    const formatted = trimFloat(count, decimals);
    if (!formatted || Number(formatted) === 0) return "< 0.00000001";
    return formatted;
  };

  function trimFloat(n, decimals) {
    const s = n.toFixed(decimals);
    return s.replace(/\.?0+$/, "") || "0";
  }

  UCE.formatQuote = function formatQuote(price, priceHint) {
    const hint = Number.isFinite(priceHint) ? Math.min(Math.max(priceHint, 0), 6) : 2;
    return Number(price).toFixed(hint);
  };

  UCE.formatAsOf = function formatAsOf(ms) {
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
