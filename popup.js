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

let currentHost = "";
let state = null;
let tabSynced = false;

function describeCurrency(code) {
  const meta = UCE.CURRENCY_META[code];
  if (!meta) return code || "";
  return `${meta.flag} ${code} · ${meta.symbol}`;
}

function fillSelect(select, codes) {
  select.innerHTML = "";
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

  siteHost.textContent = currentHost || "Open a normal page first";
  siteDollar.value = resolvedDollar;
  siteYen.value = resolvedYen;
  siteDollar.disabled = !currentHost;
  siteYen.disabled = !currentHost;
  siteDollar.classList.toggle("is-overridden", Boolean(dollarOverride));
  siteYen.classList.toggle("is-overridden", Boolean(yenOverride));
}

function setTab(name) {
  document.getElementById("tab-custom").classList.toggle("is-on", name === "custom");
  document.getElementById("tab-yahoo").classList.toggle("is-on", name === "yahoo");
  document.getElementById("tab-currency").classList.toggle("is-on", name === "currency");
  customForm.hidden = name !== "custom";
  yahooForm.hidden = name !== "yahoo";
  currencyForm.hidden = name !== "currency";
}

function tabForUnit(unit) {
  if (!unit) return "custom";
  if (unit.type === "yahoo") return "yahoo";
  if (unit.type === "currency") return "currency";
  return "custom";
}

function describeUnit(unit) {
  if (!unit) return "No unit yet. Save a custom item, a ticker, or a currency.";
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
  if (error) {
    unitKicker.hidden = true;
    statusTextEl.textContent = error;
    statusTextEl.classList.add("muted");
    statusEl.classList.remove("has-unit");
    clearUnitBtn.hidden = true;
    return;
  }
  if (!unit) {
    unitKicker.hidden = true;
    statusTextEl.textContent = describeUnit(null);
    statusTextEl.classList.add("muted");
    statusEl.classList.remove("has-unit");
    clearUnitBtn.hidden = true;
    return;
  }
  unitKicker.hidden = false;
  unitKicker.textContent = unit.type === "currency" ? "Prices in" : "Active unit";
  statusTextEl.textContent = describeUnit(unit);
  statusTextEl.classList.remove("muted");
  statusEl.classList.add("has-unit");
  clearUnitBtn.hidden = false;
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

async function refresh() {
  const res = await chrome.runtime.sendMessage({ action: "getState" });
  if (res?.error) {
    paintStatus(null, res.error);
    return;
  }
  state = res.state;
  paintStatus(state.unit);
  if (state.unit?.type === "currency") displayCurrency.value = state.unit.currency;
  currentHost = await activeHost();
  paintSymbolSettings();
  const paused = currentHost && state.pausedHosts.includes(currentHost);
  pauseBtn.checked = Boolean(currentHost) && !paused;
  pauseBtn.disabled = !currentHost;
  if (!tabSynced) {
    if (state.unit) setTab(tabForUnit(state.unit));
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
  paintStatus(res.unit, res.error);
  if (!res.error) {
    setTab("custom");
    refresh();
  }
});

yahooForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  paintStatus(null, "Checking Yahoo…");
  const res = await chrome.runtime.sendMessage({
    action: "validateYahoo",
    symbol: document.getElementById("yahoo-symbol").value,
  });
  paintStatus(res.unit, res.error);
  if (!res.error) {
    setTab("yahoo");
    refresh();
  }
});

currencyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const res = await chrome.runtime.sendMessage({
    action: "setCurrencyUnit",
    currency: displayCurrency.value,
  });
  paintStatus(res.unit, res.error);
  if (!res.error) {
    setTab("currency");
    refresh();
  }
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

fillSelect(customCurrency);
fillSelect(displayCurrency);
fillSelect(siteDollar, UCE.DOLLAR_CODES);
fillSelect(siteYen, UCE.YEN_CODES);
customCurrency.value = "HKD";
displayCurrency.value = "JPY";
refresh();
