/**
 * Closed v1 currency list. Shared by background, content, and popup via importScripts / script tags.
 */
(function (root) {
  const UCE = root.UCE || (root.UCE = {});

  UCE.ISO_CODES = ["USD", "HKD", "TWD", "CNY", "JPY", "EUR", "GBP", "KRW", "SGD", "AUD", "CAD", "INR"];

  UCE.CURRENCY_META = {
    USD: { label: "US dollar", symbol: "$", flag: "🇺🇸" },
    HKD: { label: "Hong Kong dollar", symbol: "HK$", flag: "🇭🇰" },
    TWD: { label: "New Taiwan dollar", symbol: "NT$", flag: "🇹🇼" },
    CNY: { label: "Chinese yuan", symbol: "CN¥", flag: "🇨🇳" },
    JPY: { label: "Japanese yen", symbol: "¥", flag: "🇯🇵" },
    EUR: { label: "Euro", symbol: "€", flag: "🇪🇺" },
    GBP: { label: "Pound sterling", symbol: "£", flag: "🇬🇧" },
    KRW: { label: "South Korean won", symbol: "₩", flag: "🇰🇷" },
    SGD: { label: "Singapore dollar", symbol: "S$", flag: "🇸🇬" },
    AUD: { label: "Australian dollar", symbol: "A$", flag: "🇦🇺" },
    CAD: { label: "Canadian dollar", symbol: "C$", flag: "🇨🇦" },
    INR: { label: "Indian rupee", symbol: "₹", flag: "🇮🇳" },
  };

  /** Longest-first so HK$ wins over $. */
  UCE.SYMBOL_PREFIXES = [
    { token: "HK$", currency: "HKD" },
    { token: "NT$", currency: "TWD" },
    { token: "US$", currency: "USD" },
    { token: "CN¥", currency: "CNY" },
    { token: "A$", currency: "AUD" },
    { token: "C$", currency: "CAD" },
    { token: "S$", currency: "SGD" },
    { token: "€", currency: "EUR" },
    { token: "£", currency: "GBP" },
    { token: "₩", currency: "KRW" },
    { token: "₹", currency: "INR" },
    { token: "円", currency: "JPY" },
    { token: "¥", currency: null },
    { token: "￥", currency: null },
    { token: "$", currency: null },
  ];

  UCE.ISO_ALIASES = { NTD: "TWD", RMB: "CNY", CNH: "CNY" };

  UCE.DEFAULT_DOLLAR_CURRENCY = "HKD";
  UCE.DEFAULT_YEN_CURRENCY = "JPY";
  UCE.DOLLAR_CODES = ["USD", "HKD", "TWD", "SGD", "AUD", "CAD"];
  UCE.YEN_CODES = ["JPY", "CNY"];

  UCE.canonicalHost = function canonicalHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  };

  function validConfigHost(hostname) {
    const host = String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
    if (!host || host.length > 253 || host.includes("..")) return null;
    if (!/^[a-z0-9.-]+$/.test(host)) return null;
    const labels = host.split(".");
    if (labels.length < 2) return null;
    if (labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return null;
    return host;
  }

  /** Validate untrusted remote data before it reaches price parsing. */
  UCE.normalizeSiteConfig = function normalizeSiteConfig(payload, fetchedAt) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Site config payload");
    if (payload.schemaVersion !== 1) throw new Error("Site config schema");
    if (typeof payload.revision !== "string" || !payload.revision.trim() || payload.revision.length > 100) {
      throw new Error("Site config revision");
    }
    if (!payload.sites || typeof payload.sites !== "object" || Array.isArray(payload.sites)) {
      throw new Error("Site config sites");
    }

    const entries = Object.entries(payload.sites);
    if (entries.length > 5000) throw new Error("Site config size");
    const sites = {};
    for (const [rawHost, rawRule] of entries) {
      const host = validConfigHost(rawHost);
      if (!host || !rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) continue;
      const rule = {};
      const dollar = String(rawRule.dollar || "").toUpperCase();
      const yen = String(rawRule.yen || "").toUpperCase();
      if (UCE.DOLLAR_CODES.includes(dollar)) rule.dollar = dollar;
      if (UCE.YEN_CODES.includes(yen)) rule.yen = yen;
      if (rule.dollar || rule.yen) sites[host] = rule;
    }

    return {
      schemaVersion: 1,
      revision: payload.revision.trim(),
      sites,
      fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
    };
  };

  /** Exact or hostname-boundary suffix match; the most specific rule wins. */
  UCE.siteConfigCurrency = function siteConfigCurrency(hostname, sites, family) {
    if (!sites || (family !== "dollar" && family !== "yen")) return null;
    const host = UCE.canonicalHost(hostname).replace(/\.$/, "");
    if (!host) return null;
    const allowed = family === "dollar" ? UCE.DOLLAR_CODES : UCE.YEN_CODES;
    let candidate = host;
    while (candidate.includes(".")) {
      const code = sites[candidate]?.[family];
      if (allowed.includes(code)) return code;
      candidate = candidate.slice(candidate.indexOf(".") + 1);
    }
    return null;
  };

  function hostOverride(map, hostname) {
    if (!map) return undefined;
    const host = String(hostname || "").toLowerCase();
    if (map[host]) return map[host];
    const canon = UCE.canonicalHost(host);
    if (map[canon]) return map[canon];
    const www = `www.${canon}`;
    if (www !== host && map[www]) return map[www];
    return undefined;
  }

  UCE.siteDollarOverride = function siteDollarOverride(hostname, overrides) {
    const override = hostOverride(overrides, hostname);
    return override && UCE.DOLLAR_CODES.includes(override) ? override : null;
  };

  UCE.siteYenOverride = function siteYenOverride(hostname, overrides) {
    const override = hostOverride(overrides, hostname);
    return override && UCE.YEN_CODES.includes(override) ? override : null;
  };

  UCE.hostPaused = function hostPaused(pausedHosts, hostname) {
    const canon = UCE.canonicalHost(hostname);
    if (!canon) return false;
    return (pausedHosts || []).some((h) => UCE.canonicalHost(h) === canon);
  };

  /** Highest count wins; a tie is not a hint. */
  UCE.majorityCode = function majorityCode(counts, allowed) {
    let best = null;
    let bestN = 0;
    let tie = false;
    for (const [code, n] of Object.entries(counts || {})) {
      if (allowed && !allowed.includes(code)) continue;
      if (!Number.isFinite(n) || n <= 0) continue;
      if (n > bestN) {
        best = code;
        bestN = n;
        tie = false;
      } else if (n === bestN && code !== best) {
        tie = true;
      }
    }
    return bestN > 0 && !tie ? best : null;
  };

  /** .jp → JPY, .cn → CNY, otherwise null (use the user default). Suffix only — not substring. */
  UCE.yenHintFromHost = function yenHintFromHost(hostname) {
    const host = (hostname || "").toLowerCase();
    if (host === "jp" || host.endsWith(".jp")) return "JPY";
    if (host === "cn" || host.endsWith(".cn")) return "CNY";
    return null;
  };

  UCE.resolveYenDetail = function resolveYenDetail(hostname, defaultYen, overrides, pageYen, configSites) {
    const host = (hostname || "").toLowerCase();
    const override = hostOverride(overrides, host);
    if (override && UCE.YEN_CODES.includes(override)) return { currency: override, source: "override" };
    if (pageYen && UCE.YEN_CODES.includes(pageYen)) return { currency: pageYen, source: "page" };
    const configured = UCE.siteConfigCurrency(host, configSites, "yen");
    if (configured) return { currency: configured, source: "site" };
    const hinted = UCE.yenHintFromHost(host);
    if (hinted) return { currency: hinted, source: "tld" };
    const fallback = UCE.YEN_CODES.includes(defaultYen) ? defaultYen : UCE.DEFAULT_YEN_CURRENCY;
    return { currency: fallback, source: "default" };
  };

  UCE.resolveYen = function resolveYen(...args) {
    return UCE.resolveYenDetail(...args).currency;
  };

  UCE.resolveDollarDetail = function resolveDollarDetail(hostname, defaultDollar, overrides, pageDollar, configSites) {
    const host = (hostname || "").toLowerCase();
    const override = hostOverride(overrides, host);
    if (override && UCE.DOLLAR_CODES.includes(override)) return { currency: override, source: "override" };
    if (pageDollar && UCE.DOLLAR_CODES.includes(pageDollar)) return { currency: pageDollar, source: "page" };
    const configured = UCE.siteConfigCurrency(host, configSites, "dollar");
    if (configured) return { currency: configured, source: "site" };
    const fallback = UCE.DOLLAR_CODES.includes(defaultDollar) ? defaultDollar : UCE.DEFAULT_DOLLAR_CURRENCY;
    return { currency: fallback, source: "default" };
  };

  UCE.resolveDollar = function resolveDollar(...args) {
    return UCE.resolveDollarDetail(...args).currency;
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
