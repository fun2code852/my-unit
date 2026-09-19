const customForm = document.getElementById("custom-form");
const yahooForm = document.getElementById("yahoo-form");
const currencyForm = document.getElementById("currency-form");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const unitKicker = document.getElementById("unit-kicker");
const siteDollar = document.getElementById("site-dollar");
const siteYen = document.getElementById("site-yen");
const siteHost = document.getElementById("site-host");
const pauseBtn = document.getElementById("pause-btn");
const customCurrency = document.getElementById("custom-currency");
const displayCurrency = document.getElementById("display-currency");
const clearUnitBtn = document.getElementById("clear-unit");

const PAGE_ORIGINS = ["http://*/*", "https://*/*"];

let currentHost = "";
let state = null;
let tabSynced = false;

function applyI18n(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = chrome.i18n.getMessage(el.dataset.i18nPlaceholder);
  }
  for (const el of root.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", chrome.i18n.getMessage(el.dataset.i18nAria));
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = chrome.i18n.getMessage(el.dataset.i18nTitle);
  }
}

function describeCurrency(code) {
  const meta = UCE.CURRENCY_META[code];
  if (!meta) return code || "";
  return `${meta.flag} ${code} · ${meta.symbol}`;
}

function fillSelect(select, codes, blank) {
  select.innerHTML = "";
  if (blank) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = blank;
    select.appendChild(opt);
  }
  for (const code of codes || UCE.ISO_CODES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = describeCurrency(code);
    select.appendChild(opt);
  }
}

function autoDollar() {
  return UCE.resolveDollar(currentHost, state?.defaultDollar, {});
}

function autoYen() {
  return UCE.resolveYen(currentHost, state?.defaultYen, {});
}

function paintSymbolSettings() {
  const dollarOverrides = state.overrides || {};
  const yenOverrides = state.yenOverrides || {};
  const dollarOverride = currentHost ? dollarOverrides[currentHost] : "";
  const yenOverride = currentHost ? yenOverrides[currentHost] : "";
  const resolvedDollar = UCE.resolveDollar(currentHost, state.defaultDollar, dollarOverrides);
  const resolvedYen = UCE.resolveYen(currentHost, state.defaultYen, yenOverrides);

  siteHost.textContent = currentHost || chrome.i18n.getMessage("openPageFirst");
  siteDollar.value = resolvedDollar;
  siteYen.value = resolvedYen;
  siteDollar.disabled = !currentHost;
  siteYen.disabled = !currentHost;
  siteDollar.classList.toggle("is-overridden", Boolean(dollarOverride));
  siteYen.classList.toggle("is-overridden", Boolean(yenOverride));
}

function paintUnitFields(unit) {
  const isCustom = unit?.type === "custom";
  const isYahoo = unit?.type === "yahoo";
  const isCurrency = unit?.type === "currency";
  document.getElementById("custom-name").value = isCustom ? unit.name || "" : "";
  document.getElementById("custom-price").value = isCustom ? unit.price ?? "" : "";
  customCurrency.value = isCustom && unit.currency ? unit.currency : "";
  document.getElementById("yahoo-symbol").value = isYahoo ? unit.symbol || "" : "";
  displayCurrency.value = isCurrency && unit.currency ? unit.currency : "";
}

const TABS = [
  ["tab-custom", "custom-form", "custom"],
  ["tab-yahoo", "yahoo-form", "yahoo"],
  ["tab-currency", "currency-form", "currency"],
];

function setTab(name, animate = true) {
  const keys = TABS.map(([, , key]) => key);
  const next = keys.indexOf(name);
  const prev = keys.findIndex((_, i) => document.getElementById(TABS[i][0]).classList.contains("is-on"));
  const dir = next >= prev ? 1 : -1;
  const tabsEl = document.querySelector(".tabs");
  tabsEl.dataset.active = name;
  if (animate) tabsEl.classList.add("is-ready");
  for (const [tabId, panelId, key] of TABS) {
    const on = name === key;
    const btn = document.getElementById(tabId);
    const panel = document.getElementById(panelId);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.tabIndex = on ? 0 : -1;
    panel.classList.toggle("is-on", on);
    panel.setAttribute("aria-hidden", on ? "false" : "true");
    if (on) panel.style.setProperty("--tab-dir", String(dir));
  }
}

function tabForUnit(unit) {
  if (!unit) return "custom";
  if (unit.type === "yahoo") return "yahoo";
  if (unit.type === "currency") return "currency";
  return "custom";
}

function describeUnit(unit) {
  if (!unit) return chrome.i18n.getMessage("statusNoUnit");
  if (unit.type === "currency") {
    const meta = UCE.CURRENCY_META[unit.currency];
    return `${meta?.flag || ""} ${unit.currency} · ${meta?.symbol || ""}`.replace(/^\s+/, "");
  }
  if (unit.type === "yahoo") {
    const hint = UCE.formatQuote(unit.price, unit.priceHint);
    const asOf = UCE.formatAsOf(unit.asOf);
    return `${unit.symbol} · ${unit.shortName || ""} · ${unit.currency} ${hint}${asOf ? ` · ${asOf}` : ""}`.replace(
      / ·  · /g,
      " · ",
    );
  }
  return `${unit.name} · ${unit.currency} ${unit.price}`;
}

function paintStatus(unit, error) {
  if (unit) {
    unitKicker.hidden = false;
    unitKicker.textContent =
      unit.type === "currency" ? chrome.i18n.getMessage("kickerPricesIn") : chrome.i18n.getMessage("kickerActive");
    statusEl.classList.add("has-unit");
    clearUnitBtn.hidden = false;
    if (error) {
      statusTextEl.textContent = error;
      statusTextEl.classList.add("muted");
    } else {
      statusTextEl.textContent = describeUnit(unit);
      statusTextEl.classList.remove("muted");
    }
    return;
  }
  unitKicker.hidden = true;
  statusTextEl.textContent = error || describeUnit(null);
  statusTextEl.classList.add("muted");
  statusEl.classList.remove("has-unit");
  clearUnitBtn.hidden = true;
}

async function activeHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return "";
    return new URL(tab.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function ensurePageAccess() {
  try {
    const have = await chrome.permissions.contains({ origins: PAGE_ORIGINS });
    if (!have) {
      const ok = await chrome.permissions.request({ origins: PAGE_ORIGINS });
      if (!ok) return false;
    }
    await chrome.runtime.sendMessage({ action: "syncInject" });
    return true;
  } catch (err) {
    console.warn("UCE permission", err);
    return false;
  }
}

async function afterSave(res, tab) {
  if (res.error) {
    await refresh();
    paintStatus(state?.unit, res.error);
    return;
  }
  setTab(tab);
  const granted = await ensurePageAccess();
  await refresh();
  if (!granted) paintStatus(state?.unit, chrome.i18n.getMessage("needPageAccess"));
}

async function refresh() {
  const res = await chrome.runtime.sendMessage({ action: "getState" });
  if (res?.error) {
    paintStatus(null, res.error);
    return;
  }
  state = res.state;
  paintStatus(state.unit);
  paintUnitFields(state.unit);
  currentHost = await activeHost();
  paintSymbolSettings();
  const paused = currentHost && UCE.hostPaused(state.pausedHosts, currentHost);
  pauseBtn.checked = Boolean(currentHost) && !paused;
  pauseBtn.disabled = !currentHost;
  if (!tabSynced) {
    if (state.unit) setTab(tabForUnit(state.unit), false);
    tabSynced = true;
  }
}

document.getElementById("tab-custom").addEventListener("click", () => setTab("custom"));
document.getElementById("tab-yahoo").addEventListener("click", () => setTab("yahoo"));
document.getElementById("tab-currency").addEventListener("click", () => setTab("currency"));

customForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const res = await chrome.runtime.sendMessage({
    action: "setCustomUnit",
    name: document.getElementById("custom-name").value,
    price: document.getElementById("custom-price").value,
    currency: customCurrency.value,
  });
  await afterSave(res, "custom");
});

yahooForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  paintStatus(state?.unit, chrome.i18n.getMessage("checkingYahoo"));
  const res = await chrome.runtime.sendMessage({
    action: "validateYahoo",
    symbol: document.getElementById("yahoo-symbol").value,
  });
  await afterSave(res, "yahoo");
});

currencyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const res = await chrome.runtime.sendMessage({
    action: "setCurrencyUnit",
    currency: displayCurrency.value,
  });
  await afterSave(res, "currency");
});

siteDollar.addEventListener("change", async () => {
  if (!currentHost) return;
  const next = siteDollar.value;
  await chrome.runtime.sendMessage({
    action: "setOverride",
    host: currentHost,
    currency: next === autoDollar() ? null : next,
  });
  refresh();
});

siteYen.addEventListener("change", async () => {
  if (!currentHost) return;
  const next = siteYen.value;
  await chrome.runtime.sendMessage({
    action: "setYenOverride",
    host: currentHost,
    currency: next === autoYen() ? null : next,
  });
  refresh();
});

pauseBtn.addEventListener("change", async () => {
  if (!currentHost) return;
  await chrome.runtime.sendMessage({ action: "togglePause", host: currentHost });
  refresh();
});

clearUnitBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action: "clearUnit" });
  refresh();
});

applyI18n();
fillSelect(customCurrency, null, chrome.i18n.getMessage("selectBlank"));
fillSelect(displayCurrency, null, chrome.i18n.getMessage("selectBlank"));
fillSelect(siteDollar, UCE.DOLLAR_CODES);
fillSelect(siteYen, UCE.YEN_CODES);
refresh();
