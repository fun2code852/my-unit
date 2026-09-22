const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const yahooCode = background.slice(0, background.indexOf("chrome.runtime.onInstalled.addListener"));

async function yahooError(locale, statuses) {
  const messages = JSON.parse(fs.readFileSync(path.join(root, "_locales", locale, "messages.json"), "utf8"));
  let requests = 0;
  const context = vm.createContext({
    self: { UCE: { DEFAULT_DOLLAR_CURRENCY: "HKD", DEFAULT_YEN_CURRENCY: "JPY" } },
    importScripts() {},
    chrome: {
      i18n: { getMessage: (key) => messages[key]?.message || "" },
    },
    fetch: async () => ({ ok: false, status: statuses[requests++] }),
    encodeURIComponent,
    Date,
    Map,
  });
  vm.runInContext(yahooCode, context, { filename: "background.js" });
  let error;
  try {
    await vm.runInContext('fetchYahoo("INVALID-TICKER")', context);
  } catch (err) {
    error = err;
  }
  assert.equal(requests, 2, "tries both Yahoo hosts");
  assert.ok(error, "rejects a failed quote");
  return error.message;
}

async function main() {
  const expected = [
    [400, "Yahoo could not understand this ticker. Check the symbol and try again."],
    [404, "Ticker not found on Yahoo. Check the symbol and try again."],
    [401, "Yahoo blocked the quote request. Please try again later."],
    [403, "Yahoo blocked the quote request. Please try again later."],
    [408, "Yahoo took too long to respond. Please try again."],
    [429, "Yahoo is receiving too many requests. Please wait a few minutes and try again."],
    [500, "Yahoo is temporarily unavailable. Please try again later."],
    [503, "Yahoo is temporarily unavailable. Please try again later."],
    [504, "Yahoo took too long to respond. Please try again."],
    [418, "Yahoo could not load this quote. Please try again later."],
  ];
  for (const [status, message] of expected) {
    assert.equal(await yahooError("en", [status, status]), message, `English ${status}`);
    for (const locale of ["zh_HK", "zh_TW"]) {
      const translated = await yahooError(locale, [status, status]);
      assert.ok(/[\u3400-\u9fff]/u.test(translated) && !/HTTP|\b\d{3}\b/.test(translated), `${locale} ${status}: ${translated}`);
    }
  }
  assert.equal(await yahooError("zh_HK", [404, 404]), "Yahoo 找不到此代號，請檢查後再試。");
  assert.equal(await yahooError("zh_TW", [404, 404]), "Yahoo 找不到此代號，請檢查後再試。");
  console.log("Yahoo error messages OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
