importScripts("lib/currencies.js", "lib/parse.js", "lib/convert.js");

const UCE = self.UCE;
const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com/v8/finance/chart/",
  "https://query2.finance.yahoo.com/v8/finance/chart/",
];
const FX_URL = "https://api.frankfurter.dev/v1/latest?from=USD";
const YAHOO_ALARM = "uce-yahoo";
const FX_ALARM = "uce-fx";
const SCRIPT_ID = "uce";
const PAGE_ORIGINS = ["http://*/*", "https://*/*"];
const CONTENT_JS = ["lib/currencies.js", "lib/parse.js", "lib/convert.js", "content.js"];
const CONTENT_CSS = ["content.css"];

const DEFAULT_STATE = {
  unit: null,
  defaultDollar: UCE.DEFAULT_DOLLAR_CURRENCY,
  defaultYen: UCE.DEFAULT_YEN_CURRENCY,
  overrides: {},
  yenOverrides: {},
  pausedHosts: [],
  fx: null,
};

async function getState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);
  return {
    unit: stored.unit ?? null,
    defaultDollar: stored.defaultDollar || UCE.DEFAULT_DOLLAR_CURRENCY,
    defaultYen: stored.defaultYen || UCE.DEFAULT_YEN_CURRENCY,
    overrides: stored.overrides || {},
    yenOverrides: stored.yenOverrides || {},
    pausedHosts: stored.pausedHosts || [],
    fx: stored.fx || null,
  };
}

async function savePartial(patch) {
  await chrome.storage.local.set(patch);
}

function unitReady(unit) {
  if (!unit || !unit.currency) return false;
  if (unit.type === "currency") return true;
  return Number(unit.price) > 0;
}

async function fetchFrankfurter() {
  const res = await fetch(FX_URL, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.base !== "USD" || !data.rates) throw new Error("FX payload");
  return {
    base: "USD",
    date: data.date,
    rates: { ...data.rates },
    fetchedAt: Date.now(),
    yahooCodes: [],
  };
}

function emptyFx() {
  return { base: "USD", date: null, rates: {}, fetchedAt: Date.now(), yahooCodes: [] };
}

async function fillYahooGaps(fx) {
  const missing = UCE.missingFxCodes(fx);
  if (!missing.length) return fx;
  const rates = { ...(fx.rates || {}) };
  const yahooCodes = [...(fx.yahooCodes || [])];
  await Promise.all(
    missing.map(async (code) => {
      try {
        const quote = await fetchYahoo(`${code}=X`);
        if (!Number.isFinite(quote.price) || quote.price <= 0) return;
        rates[code] = quote.price;
        if (!yahooCodes.includes(code)) yahooCodes.push(code);
      } catch (err) {
        console.warn("UCE Yahoo FX", code, err);
      }
    }),
  );
  return { ...fx, rates, yahooCodes };
}

async function refreshFx() {
  const state = await getState();
  let fx;
  try {
    fx = await fetchFrankfurter();
  } catch (err) {
    console.warn("UCE FX fetch failed", err);
    fx = state.fx ? { ...state.fx, rates: { ...(state.fx.rates || {}) } } : emptyFx();
  }
  fx = await fillYahooGaps(fx);
  await savePartial({ fx });
  return fx;
}

async function fetchYahoo(symbol) {
  const encoded = encodeURIComponent(String(symbol || "").trim());
  if (!encoded) throw new Error("Empty symbol");
  let lastError = "Yahoo unreachable";
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetch(`${host}${encoded}?range=5d&interval=1d`, {
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!res.ok) {
        lastError = `Yahoo HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      const currency = meta?.currency;
      if (!Number.isFinite(price) || price <= 0 || !currency) {
        lastError = "Yahoo had no price";
        continue;
      }
      return {
        type: "yahoo",
        symbol: meta.symbol || String(symbol).toUpperCase(),
        name: meta.symbol || String(symbol).toUpperCase(),
        shortName: meta.shortName || meta.longName || meta.symbol,
        price,
        currency: String(currency).toUpperCase(),
        priceHint: meta.priceHint,
        asOf: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

async function refreshYahooIfNeeded() {
  const state = await getState();
  if (!state.unit || state.unit.type !== "yahoo" || !state.unit.symbol) return;
  try {
    const next = await fetchYahoo(state.unit.symbol);
    await savePartial({ unit: { ...state.unit, ...next } });
  } catch (err) {
    console.warn("UCE Yahoo poll failed", err);
  }
}

async function ensureFx() {
  const state = await getState();
  const age = state.fx?.fetchedAt ? Date.now() - state.fx.fetchedAt : Infinity;
  const missing = UCE.missingFxCodes(state.fx);
  if (state.fx && age < 20 * 60 * 60 * 1000 && !missing.length) return state.fx;
  if (state.fx && age < 20 * 60 * 60 * 1000 && missing.length) {
    const fx = await fillYahooGaps(state.fx);
    await savePartial({ fx });
    return fx;
  }
  return refreshFx();
}

async function syncAlarms() {
  chrome.alarms.create(FX_ALARM, { periodInMinutes: 60 * 12 });
  const state = await getState();
  if (state.unit?.type === "yahoo" && state.unit.symbol) {
    chrome.alarms.create(YAHOO_ALARM, { periodInMinutes: 15 });
  } else {
    await chrome.alarms.clear(YAHOO_ALARM);
  }
}

async function hasPageAccess() {
  return chrome.permissions.contains({ origins: PAGE_ORIGINS });
}

async function registered() {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    return scripts.some((script) => script.id === SCRIPT_ID);
  } catch {
    return false;
  }
}

async function tabHasScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch {
    return false;
  }
}

const injectLocks = new Map();

async function injectTab(tabId) {
  const existing = injectLocks.get(tabId);
  if (existing) return existing;
  const job = (async () => {
    if (await tabHasScript(tabId)) return;
    await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_JS });
  })().finally(() => {
    if (injectLocks.get(tabId) === job) injectLocks.delete(tabId);
  });
  injectLocks.set(tabId, job);
  return job;
}

async function httpTabs() {
  try {
    return await chrome.tabs.query({ url: PAGE_ORIGINS });
  } catch {
    return [];
  }
}

async function injectOpenTabs() {
  const tabs = await httpTabs();
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await injectTab(tab.id);
      } catch (err) {
        console.warn("UCE inject", tab.id, err);
      }
    }),
  );
}

async function teardownOpenTabs() {
  const tabs = await httpTabs();
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { action: "teardown" });
      } catch {
        /* tab has no script */
      }
    }),
  );
}

async function syncContentScripts() {
  const state = await getState();
  const granted = await hasPageAccess();
  const want = unitReady(state.unit) && granted;
  const isRegistered = await registered();

  if (want && !isRegistered) {
    try {
      await chrome.scripting.registerContentScripts([
        {
          id: SCRIPT_ID,
          matches: PAGE_ORIGINS,
          js: CONTENT_JS,
          css: CONTENT_CSS,
          runAt: "document_idle",
          persistAcrossSessions: true,
        },
      ]);
    } catch (err) {
      console.warn("UCE registerContentScripts", err);
    }
  }

  if (want) await injectOpenTabs();

  if (!want && isRegistered) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    } catch (err) {
      console.warn("UCE unregisterContentScripts", err);
    }
    await teardownOpenTabs();
  }
}

const MENU_ID = "uce-convert";

function menuTitle(unit) {
  if (!unit) return "Convert with My Unit";
  if (unit.type === "currency") return `Convert to ${unit.currency}`;
  const name = unit.name || unit.symbol || "My Unit";
  return `Convert to ${name}`;
}

async function ensureContextMenu() {
  const state = await getState();
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: menuTitle(state.unit),
    contexts: ["selection"],
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  if (!state.defaultDollar) await savePartial({ defaultDollar: UCE.DEFAULT_DOLLAR_CURRENCY });
  if (!state.defaultYen) await savePartial({ defaultYen: UCE.DEFAULT_YEN_CURRENCY });
  await syncAlarms();
  ensureFx();
  ensureContextMenu();
  syncContentScripts();
});

syncAlarms();
ensureFx();
ensureContextMenu();
syncContentScripts();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === YAHOO_ALARM) refreshYahooIfNeeded();
  if (alarm.name === FX_ALARM) refreshFx().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.unit) {
    ensureContextMenu();
    syncAlarms();
    syncContentScripts();
  }
});

chrome.permissions.onAdded.addListener(() => {
  syncContentScripts();
});

chrome.permissions.onRemoved.addListener(() => {
  syncContentScripts();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const payload = { action: "convertSelection", text: info.selectionText || "" };
  try {
    await chrome.tabs.sendMessage(tab.id, payload);
    return;
  } catch {
    /* inject then retry — activeTab covers this user gesture */
  }
  try {
    await injectTab(tab.id);
    await chrome.tabs.sendMessage(tab.id, payload);
  } catch {
    // chrome://, PDF, or inject denied
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});

async function handleMessage(message) {
  const action = message?.action;
  if (action === "getState") {
    ensureFx();
    return { state: await getState() };
  }
  if (action === "syncInject") {
    await syncContentScripts();
    return { ok: true };
  }
  if (action === "setCustomUnit") {
    const name = String(message.name || "").trim();
    const price = Number(message.price);
    const currency = String(message.currency || "").toUpperCase();
    if (!name || !Number.isFinite(price) || price <= 0) throw new Error("Need a name and a price > 0");
    if (!UCE.ISO_CODES.includes(currency)) throw new Error("Unsupported currency");
    const unit = { type: "custom", name, price, currency };
    await savePartial({ unit });
    return { unit };
  }
  if (action === "validateYahoo") {
    const unit = await fetchYahoo(message.symbol);
    await savePartial({ unit });
    return { unit };
  }
  if (action === "setCurrencyUnit") {
    const currency = String(message.currency || "").toUpperCase();
    if (!UCE.ISO_CODES.includes(currency)) throw new Error("Unsupported currency");
    const meta = UCE.CURRENCY_META[currency];
    const unit = { type: "currency", currency, name: currency, symbol: meta?.symbol || currency };
    await savePartial({ unit });
    return { unit };
  }
  if (action === "clearUnit") {
    await savePartial({ unit: null });
    return { ok: true };
  }
  if (action === "setDefaultDollar") {
    const code = String(message.currency || "").toUpperCase();
    if (!UCE.DOLLAR_CODES.includes(code)) throw new Error("Unsupported currency");
    await savePartial({ defaultDollar: code });
    return { defaultDollar: code };
  }
  if (action === "setDefaultYen") {
    const code = String(message.currency || "").toUpperCase();
    if (!UCE.YEN_CODES.includes(code)) throw new Error("Unsupported currency");
    await savePartial({ defaultYen: code });
    return { defaultYen: code };
  }
  if (action === "setOverride") {
    const host = String(message.host || "").trim().toLowerCase();
    const state = await getState();
    const overrides = { ...state.overrides };
    if (!message.currency) delete overrides[host];
    else {
      const code = String(message.currency).toUpperCase();
      if (!UCE.DOLLAR_CODES.includes(code)) throw new Error("Unsupported currency");
      overrides[host] = code;
    }
    await savePartial({ overrides });
    return { overrides };
  }
  if (action === "setYenOverride") {
    const host = String(message.host || "").trim().toLowerCase();
    const state = await getState();
    const yenOverrides = { ...state.yenOverrides };
    if (!message.currency) delete yenOverrides[host];
    else {
      const code = String(message.currency).toUpperCase();
      if (!UCE.YEN_CODES.includes(code)) throw new Error("Unsupported currency");
      yenOverrides[host] = code;
    }
    await savePartial({ yenOverrides });
    return { yenOverrides };
  }
  if (action === "togglePause") {
    const host = String(message.host || "").trim().toLowerCase();
    if (!host) throw new Error("No hostname");
    const state = await getState();
    const paused = new Set(state.pausedHosts);
    if (paused.has(host)) paused.delete(host);
    else paused.add(host);
    const pausedHosts = [...paused];
    await savePartial({ pausedHosts });
    return { pausedHosts, paused: paused.has(host) };
  }
  if (action === "refreshNow") {
    await refreshFx().catch(() => {});
    await refreshYahooIfNeeded();
    return { state: await getState() };
  }
  throw new Error("Unknown action");
}
