importScripts("lib/currencies.js", "lib/parse.js", "lib/convert.js");

const UCE = self.UCE;
const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com/v8/finance/chart/",
  "https://query2.finance.yahoo.com/v8/finance/chart/",
];
const FX_URL = "https://api.frankfurter.dev/v1/latest?from=USD";
const YAHOO_ALARM = "uce-yahoo";
const FX_ALARM = "uce-fx";

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

async function fetchFx() {
  const res = await fetch(FX_URL, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.base !== "USD" || !data.rates) throw new Error("FX payload");
  const fx = {
    base: "USD",
    date: data.date,
    rates: data.rates,
    fetchedAt: Date.now(),
  };
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
  if (state.fx && age < 20 * 60 * 60 * 1000) return state.fx;
  try {
    return await fetchFx();
  } catch (err) {
    console.warn("UCE FX fetch failed", err);
    return state.fx;
  }
}

function ensureAlarms() {
  chrome.alarms.create(YAHOO_ALARM, { periodInMinutes: 15 });
  chrome.alarms.create(FX_ALARM, { periodInMinutes: 60 * 12 });
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
  ensureAlarms();
  ensureFx();
  ensureContextMenu();
});

ensureAlarms();
ensureFx();
ensureContextMenu();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === YAHOO_ALARM) refreshYahooIfNeeded();
  if (alarm.name === FX_ALARM) fetchFx().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.unit) ensureContextMenu();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: "convertSelection",
      text: info.selectionText || "",
    });
  } catch {
    // No content script on this page (chrome://, PDF, …).
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
    await fetchFx().catch(() => {});
    await refreshYahooIfNeeded();
    return { state: await getState() };
  }
  throw new Error("Unknown action");
}
