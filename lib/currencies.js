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

  /** .jp → JPY, .cn → CNY, otherwise null (use the user default). */
  UCE.yenHintFromHost = function yenHintFromHost(hostname) {
    const host = (hostname || "").toLowerCase();
    if (host.endsWith(".jp") || host.includes(".co.jp")) return "JPY";
    if (host.endsWith(".cn") || host.includes(".com.cn")) return "CNY";
    return null;
  };

  UCE.resolveYen = function resolveYen(hostname, defaultYen, overrides) {
    const host = (hostname || "").toLowerCase();
    const override = overrides && overrides[host];
    if (override && UCE.YEN_CODES.includes(override)) return override;
    const fallback = UCE.YEN_CODES.includes(defaultYen) ? defaultYen : UCE.DEFAULT_YEN_CURRENCY;
    return UCE.yenHintFromHost(host) || fallback;
  };

  UCE.resolveDollar = function resolveDollar(hostname, defaultDollar, overrides) {
    const host = (hostname || "").toLowerCase();
    const override = overrides && overrides[host];
    if (override && UCE.DOLLAR_CODES.includes(override)) return override;
    if (defaultDollar && UCE.DOLLAR_CODES.includes(defaultDollar)) return defaultDollar;
    return UCE.DEFAULT_DOLLAR_CURRENCY;
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
