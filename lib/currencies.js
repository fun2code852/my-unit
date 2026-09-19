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

  UCE.resolveYen = function resolveYen(hostname, defaultYen, overrides, pageYen) {
    const host = (hostname || "").toLowerCase();
    const override = hostOverride(overrides, host);
    if (override && UCE.YEN_CODES.includes(override)) return override;
    if (pageYen && UCE.YEN_CODES.includes(pageYen)) return pageYen;
    const fallback = UCE.YEN_CODES.includes(defaultYen) ? defaultYen : UCE.DEFAULT_YEN_CURRENCY;
    return UCE.yenHintFromHost(host) || fallback;
  };

  UCE.resolveDollar = function resolveDollar(hostname, defaultDollar, overrides, pageDollar) {
    const host = (hostname || "").toLowerCase();
    const override = hostOverride(overrides, host);
    if (override && UCE.DOLLAR_CODES.includes(override)) return override;
    if (pageDollar && UCE.DOLLAR_CODES.includes(pageDollar)) return pageDollar;
    if (defaultDollar && UCE.DOLLAR_CODES.includes(defaultDollar)) return defaultDollar;
    return UCE.DEFAULT_DOLLAR_CURRENCY;
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
