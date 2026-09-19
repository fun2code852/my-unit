const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, "..", "lib", file), "utf8");
  vm.runInThisContext(code, { filename: file });
}

load("currencies.js");
load("parse.js");
load("convert.js");

const { findPrices, parsePriceString, parseNumber, convertToUnit, formatCount } = globalThis.UCE;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const hkCtx = { hostname: "www.petpetfootprint.com", defaultDollar: "HKD", overrides: {} };
const mallCtx = { hostname: "www.hktvmall.com", defaultDollar: "HKD", overrides: {} };
const amazonCtx = { hostname: "www.amazon.com", defaultDollar: "HKD", overrides: {} };

{
  const hit = parsePriceString("HK$310.00", hkCtx);
  assert(hit && hit.amount === 310 && hit.currency === "HKD", "PetPet HK$310.00");
}

{
  const hit = parsePriceString("HK$1,199.00", hkCtx);
  assert(hit && hit.amount === 1199 && hit.currency === "HKD", "PetPet thousands comma");
}

{
  const hit = parsePriceString("HK$ 4,480", hkCtx);
  assert(hit && hit.amount === 4480 && hit.currency === "HKD", "split widget HK$ + 4,480");
  assert(UCE.isCurrencyToken("HK$"), "HK$ is currency-only");
  assert(UCE.isAmountText(" 4,480 "), "4,480 is amount-only");
  assert(!UCE.isAmountText(" 4,480 Up"), "labelled amount is not amount-only");
  assert(!UCE.isCurrencyToken("HK$310"), "HK$310 is not currency-only");
  assert(UCE.isCurrencyToken(" HK$ "), "padded HK$ is currency-only");
  assert(UCE.isAmountText(" 3599 "), "nested 3599 is amount-only");
  const nested = parsePriceString("HK$ 3599", hkCtx);
  assert(nested && nested.amount === 3599 && nested.currency === "HKD", "HK$ + nested 3599");
}

{
  const hit = parsePriceString("$ 43.00", mallCtx);
  assert(hit && hit.amount === 43 && hit.currency === "HKD", "HKTVmall $ 43.00 as HKD");
}

{
  const hit = parsePriceString("HKD 78.37", amazonCtx);
  assert(hit && Math.abs(hit.amount - 78.37) < 1e-9 && hit.currency === "HKD", "Amazon ISO HKD 78.37");
}

{
  const hit = parsePriceString("HKD\u00a078.37", amazonCtx);
  assert(hit && Math.abs(hit.amount - 78.37) < 1e-9 && hit.currency === "HKD", "Amazon nbsp HKD");
}

{
  const hit = parsePriceString("HKD6.51", amazonCtx);
  assert(hit && Math.abs(hit.amount - 6.51) < 1e-9 && hit.currency === "HKD", "Amazon flat widget HKD6.51");
}

{
  const hit = parsePriceString("HKD 1,176.71", amazonCtx);
  assert(hit && Math.abs(hit.amount - 1176.71) < 1e-9 && hit.currency === "HKD", "Amazon whole+fraction HKD 1,176.71");
  const glued = parsePriceString("HKD1,17671", amazonCtx);
  assert(glued && glued.amount === 1176, "glued HKD1,17671 must not eat cents as 117671");
}

{
  const hits = findPrices("version 2.0 released", hkCtx);
  assertEq(hits.length, 0, "no bare numbers");
}

{
  const usdCtx = { hostname: "www.hktvmall.com", defaultDollar: "USD", overrides: { "www.hktvmall.com": "HKD" } };
  const hit = parsePriceString("$ 43.00", usdCtx);
  assert(hit && hit.currency === "HKD", "per-domain $ override");
}

{
  assertEq(UCE.resolveYen("www.amazon.co.jp"), "JPY", "¥ on .co.jp is JPY");
  assertEq(UCE.resolveYen("item.jd.com.cn"), "CNY", "¥ on .com.cn is CNY");
  assertEq(UCE.resolveYen("www.example.com", "CNY"), "CNY", "¥ on .com uses default");
  assertEq(UCE.parsePriceString("¥1200", { hostname: "www.amazon.co.jp" }).currency, "JPY", "parse ¥ on .jp");
  assertEq(UCE.parsePriceString("¥1200", { hostname: "www.taobao.com", defaultYen: "CNY" }).currency, "CNY", "parse ¥ default CNY");
  const yenOverride = parsePriceString("¥1200", {
    hostname: "www.example.com",
    defaultYen: "JPY",
    yenOverrides: { "www.example.com": "CNY" },
  });
  assert(yenOverride && yenOverride.currency === "CNY", "per-domain ¥ override");
  assertEq(parsePriceString("CN¥88", { hostname: "www.example.com" }).currency, "CNY", "CN¥ is always CNY");
  assertEq(parsePriceString("円1200", { hostname: "www.example.com", defaultYen: "CNY" }).currency, "JPY", "円 is always JPY");
}

{
  assertEq(UCE.yenHintFromHost("amazon.co.jp.evil.com"), null, "substring .co.jp is not a JP host");
  assertEq(UCE.yenHintFromHost("jd.com.cn.evil.com"), null, "substring .com.cn is not a CN host");
  assertEq(UCE.yenHintFromHost("www.amazon.co.jp"), "JPY", "real .co.jp still hints JPY");
  assertEq(UCE.canonicalHost("www.amazon.com"), "amazon.com", "strip www");
  assertEq(UCE.canonicalHost("amazon.com"), "amazon.com", "apex unchanged");
  assertEq(UCE.resolveDollar("www.hktvmall.com", "USD", { "hktvmall.com": "HKD" }), "HKD", "www hits apex $ override");
  assertEq(UCE.resolveDollar("hktvmall.com", "USD", { "www.hktvmall.com": "HKD" }), "HKD", "apex hits www $ override");
  assertEq(UCE.resolveYen("www.example.com", "JPY", { "example.com": "CNY" }), "CNY", "www hits apex ¥ override");
  assert(UCE.hostPaused(["amazon.com"], "www.amazon.com"), "pause apex covers www");
  assert(UCE.hostPaused(["www.amazon.com"], "amazon.com"), "pause www covers apex");
  assert(!UCE.hostPaused(["amazon.com"], "smile.amazon.com"), "pause does not cover other subdomains");
}

{
  assertEq(findPrices("FOOUSD 10", amazonCtx).length, 0, "ISO needs a leading boundary");
  const iso = parsePriceString("USD 10", amazonCtx);
  assert(iso && iso.amount === 10 && iso.currency === "USD", "USD 10 still matches");
  const gluedIso = parsePriceString("USD10", amazonCtx);
  assert(gluedIso && gluedIso.amount === 10 && gluedIso.currency === "USD", "USD10 still matches");
}

{
  assert(!UCE.DOLLAR_CODES.includes("EUR"), "$ list has no euro");
  assert(!UCE.DOLLAR_CODES.includes("JPY"), "$ list has no yen");
  const euro = parsePriceString("$20", {
    hostname: "www.example.com",
    defaultDollar: "HKD",
    overrides: { "www.example.com": "EUR" },
  });
  assert(euro && euro.currency === "HKD", "EUR is not a valid $ override");
}

{
  const unit = { price: 50, currency: "HKD" };
  const count = convertToUnit(150, "HKD", unit, { base: "USD", rates: { HKD: 7.8 } });
  assertEq(count, 3, "same-currency ramen");
}

{
  const unit = { price: 332.41, currency: "USD" };
  const fx = { base: "USD", rates: { HKD: 7.8449 } };
  const count = convertToUnit(78.37, "HKD", unit, fx);
  const expected = 78.37 / 7.8449 / 332.41;
  assert(Math.abs(count - expected) < 1e-9, "HKD page vs USD unit via FX");
}

{
  assertEq(UCE.parseYahooFx("HKDJPY=X").quote, "JPY", "HKDJPY=X quote");
  assertEq(UCE.parseYahooFx("HKDJPY=X").base, "HKD", "HKDJPY=X base");
  assertEq(UCE.parseYahooFx("JPY=X").base, "USD", "JPY=X is USDJPY");
  assertEq(UCE.parseYahooFx("AAPL"), null, "stock is not FX");
  const unit = { type: "yahoo", symbol: "HKDJPY=X", price: 18.94, currency: "JPY" };
  const yen = convertToUnit(4599, "HKD", unit, { base: "USD", rates: { HKD: 7.8, JPY: 147 } });
  assert(Math.abs(yen - 4599 * 18.94) < 1e-6, "HKD page × HKDJPY rate");
  const fromUsd = convertToUnit(100, "USD", unit, { base: "USD", rates: { HKD: 7.8, JPY: 147 } });
  assert(Math.abs(fromUsd - 100 * 7.8 * 18.94) < 1e-6, "USD page → HKD → JPY via pair");
  assertEq(UCE.fxOutputCurrency("HKDJPY=X"), "JPY", "HKDJPY out is JPY");
  const inverse = { type: "yahoo", symbol: "JPYHKD=X", price: 1 / 18.94, currency: "HKD" };
  const hkdFromInv = convertToUnit(4599, "HKD", inverse, { base: "USD", rates: { HKD: 7.8, JPY: 147 } });
  assertEq(hkdFromInv, 4599, "JPYHKD on HKD page stays HKD");
  assertEq(UCE.fxOutputCurrency("JPYHKD=X"), "HKD", "JPYHKD out is HKD");
  const yenPage = convertToUnit(18940, "JPY", inverse, { base: "USD", rates: { HKD: 7.8, JPY: 147 } });
  assert(Math.abs(yenPage - 18940 / 18.94) < 1e-6, "JPY page × JPYHKD rate → HKD");
}

{
  const unit = { type: "currency", currency: "JPY" };
  const fx = { base: "USD", rates: { HKD: 7.8, JPY: 147 } };
  const yen = convertToUnit(4599, "HKD", unit, fx);
  assert(Math.abs(yen - (4599 / 7.8) * 147) < 1e-6, "currency tab HKD → JPY");
  assertEq(convertToUnit(100, "JPY", unit, fx), 100, "currency tab same currency");
  assertEq(convertToUnit(310, "TWD", unit, fx), null, "TWD without a rate is no FX");
  const withTwd = { base: "USD", rates: { HKD: 7.8, JPY: 147, TWD: 32 } };
  const twdToYen = convertToUnit(320, "TWD", unit, withTwd);
  assert(Math.abs(twdToYen - (320 / 32) * 147) < 1e-6, "TWD via Yahoo-filled rate → JPY");
}

{
  assertEq(UCE.missingFxCodes({ base: "USD", rates: { HKD: 7.8, JPY: 147 } }).includes("TWD"), true, "TWD missing from ECB snapshot");
  assertEq(UCE.missingFxCodes({ base: "USD", rates: { TWD: 32 } }).includes("TWD"), false, "TWD present after Yahoo fill");
  assertEq(UCE.missingFxCodes({ base: "USD", rates: { TWD: 32 } }).includes("USD"), false, "USD is the base");
}

{
  assertEq(formatCount(3), "3", "format 3");
  assertEq(formatCount(3.04), "3.04", "format 3.04");
  assert(formatCount(0.15) === "0.15", "format 0.15");
  assertEq(formatCount(0.0012), "0.0012", "small count keeps digits");
  assertEq(formatCount(0.00024), "0.00024", "BTC-scale count");
  assertEq(formatCount(0.01), "0.01", "format 0.01");
}

console.log("ok", parseNumber("1,199.00"));
