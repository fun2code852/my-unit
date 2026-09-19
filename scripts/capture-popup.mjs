#!/usr/bin/env node
/**
 * Capture the live extension popup (chrome-extension://) at 1280×800.
 *
 * Branded Chrome 137+ ignores --load-extension. Load via CDP
 * Extensions.loadUnpacked over --remote-debugging-pipe instead.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(ROOT, "store");
const SITE_HOST = "www.hktvmall.com";

const STAGE_JS = `
  const html = document.documentElement;
  html.style.background = "#ebe6e0";
  html.style.colorScheme = "light";
  html.style.height = "800px";
  html.style.overflow = "hidden";
  html.style.display = "flex";
  html.style.alignItems = "center";
  html.style.justifyContent = "center";
  document.body.style.colorScheme = "light";
  document.body.style.margin = "0";
  document.body.style.boxShadow = "0 18px 50px rgba(28,27,26,.18)";
  document.body.style.borderRadius = "12px";
`;

const SKIP_TOP = new Set([".git", "store", "test", "scripts", "node_modules"]);

class PipeCDP {
  constructor(outgoing, incoming) {
    this.outgoing = outgoing;
    this.incoming = incoming;
    this.n = 0;
    this.pending = new Map();
    this.buffer = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk) => {
      this.buffer += chunk;
      let z;
      while ((z = this.buffer.indexOf("\0")) !== -1) {
        const raw = this.buffer.slice(0, z);
        this.buffer = this.buffer.slice(z + 1);
        if (!raw) continue;
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          continue;
        }
        const fut = this.pending.get(msg.id);
        if (fut) {
          this.pending.delete(msg.id);
          fut.resolve(msg);
        }
      }
    });
  }

  send(method, params, sessionId, timeout = 20000) {
    const id = ++this.n;
    const payload = { id, method };
    if (params !== undefined) payload.params = params;
    if (sessionId) payload.sessionId = sessionId;
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
    this.outgoing.write(JSON.stringify(payload) + "\0");
    return p.then((msg) => {
      if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
      return msg.result || {};
    });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function packExtension(locales, defaultLocale) {
  const dest = `/tmp/uce-ext-${defaultLocale}`;
  await rm(dest, { recursive: true, force: true });
  await cp(ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(ROOT, src);
      if (!rel || rel === ".") return true;
      const parts = rel.split(path.sep);
      if (SKIP_TOP.has(parts[0])) return false;
      if (parts[0] === "_locales" && parts[1] && !locales.includes(parts[1])) return false;
      return true;
    },
  });
  const manifestPath = path.join(dest, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.default_locale = defaultLocale;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return dest;
}

function startChrome(profile, lang) {
  const args = [
    `--user-data-dir=${profile}`,
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-component-update",
    "--disable-features=Translate,MediaRouter",
    "--hide-scrollbars",
    `--lang=${lang}`,
    `--accept-lang=${lang}`,
    "--window-size=1280,800",
    "--window-position=80,60",
    "--force-device-scale-factor=1",
    "about:blank",
  ];
  const env = {
    ...process.env,
    LANG: `${lang.replace("-", "_")}.UTF-8`,
    LANGUAGE: lang.replace("-", "_"),
    LC_ALL: `${lang.replace("-", "_")}.UTF-8`,
  };
  const log = createWriteStream(`/tmp/uce-chrome-${lang.replace("/", "-")}.log`);
  const proc = spawn(CHROME, args, {
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    env,
  });
  proc.stderr.pipe(log);
  if (!proc.stdio[3] || !proc.stdio[4]) {
    throw new Error("Chrome did not expose debugging pipes");
  }
  return { proc, cdp: new PipeCDP(proc.stdio[3], proc.stdio[4]) };
}

async function evalJs(cdp, sid, expression, awaitPromise = false) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise, returnByValue: true },
    sid,
  );
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}

async function waitBrowser(cdp) {
  let last;
  for (let i = 0; i < 40; i++) {
    try {
      return await cdp.send("Browser.getVersion", undefined, undefined, 2000);
    } catch (err) {
      last = err;
      await sleep(250);
    }
  }
  throw last || new Error("Chrome pipe CDP did not come up");
}

async function findTarget(cdp, pred, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const hit = (targetInfos || []).find(pred);
    if (hit) return hit;
    await sleep(200);
  }
  return null;
}

async function attachPage(cdp, targetId) {
  const attached = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const sid = attached.sessionId;
  await cdp.send("Page.enable", undefined, sid);
  await cdp.send("Runtime.enable", undefined, sid);
  try {
    await cdp.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-color-scheme", value: "light" }] },
      sid,
    );
  } catch {
    /* popup targets sometimes reject emulation */
  }
  try {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
      sid,
    );
  } catch {
    /* same */
  }
  return sid;
}

async function openPopup(cdp, ext, unitName) {
  const sw = await findTarget(
    cdp,
    (t) => t.type === "service_worker" && t.url.includes(ext),
    6000,
  );
  if (sw) {
    const attached = await cdp.send("Target.attachToTarget", {
      targetId: sw.targetId,
      flatten: true,
    });
    await cdp.send("Runtime.enable", undefined, attached.sessionId);
    try {
      await evalJs(
        cdp,
        attached.sessionId,
        `chrome.storage.local.set({
          unit: { type: "custom", name: ${JSON.stringify(unitName)}, price: 50, currency: "HKD" }
        })`,
        true,
      );
    } catch (err) {
      console.log("pre-set unit failed:", String(err));
    }
  }
  const created = await cdp.send("Target.createTarget", {
    url: `chrome-extension://${ext}/popup.html`,
  });
  return created.targetId;
}

async function capture(lang, dest, unitName, locale) {
  const packed = await packExtension(
    locale === "en" ? ["en"] : ["zh_HK", "zh_TW"],
    locale === "en" ? "en" : "zh_TW",
  );
  const profile = `/tmp/uce-popup-shot-${lang.replace("/", "-")}`;
  await rm(profile, { recursive: true, force: true });
  await mkdir(profile, { recursive: true });
  const { proc, cdp } = startChrome(profile, lang);
  try {
    await waitBrowser(cdp);
    const loaded = await cdp.send("Extensions.loadUnpacked", { path: packed });
    const ext = loaded.id;
    if (!ext) throw new Error(`loadUnpacked returned ${JSON.stringify(loaded)}`);
    console.log(lang, "extension", ext, "locale", locale);

    await cdp.send("Target.setDiscoverTargets", { discover: true });
    const tid = await openPopup(cdp, ext, unitName);
    const sid = await attachPage(cdp, tid);

    let status = null;
    let lastErr;
    for (let i = 0; i < 12; i++) {
      try {
        status = await evalJs(
          cdp,
          sid,
          `
          (async () => {
            ${STAGE_JS}
            await chrome.runtime.sendMessage({
              action: "setCustomUnit",
              name: ${JSON.stringify(unitName)},
              price: 50,
              currency: "HKD"
            });
            if (typeof refresh === "function") await refresh();
            if (typeof paintSymbolSettings === "function") {
              currentHost = ${JSON.stringify(SITE_HOST)};
              paintSymbolSettings();
              pauseBtn.disabled = false;
              pauseBtn.checked = true;
            }
            return {
              href: location.href,
              ui: chrome.i18n.getUILanguage(),
              status: document.getElementById("status-text")?.textContent || "",
              lede: document.querySelector(".lede")?.textContent || "",
              tab: document.getElementById("tab-custom")?.textContent || "",
              host: document.getElementById("site-host")?.textContent || ""
            };
          })()
          `,
          true,
        );
        const text = `${status?.status || ""} ${status?.lede || ""}`;
        if (status && (text.includes(unitName) || /hkd/i.test(text))) break;
      } catch (err) {
        lastErr = err;
        await sleep(400);
      }
    }
    if (!status) throw new Error(`popup did not initialize: ${lastErr}`);
    console.log(lang, status);

    await sleep(400);
    const shot = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", fromSurface: true, captureBeyondViewport: false },
      sid,
      30000,
    );
    await writeFile(dest, Buffer.from(shot.data, "base64"));
    console.log("wrote", dest);
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => {
        proc.kill("SIGKILL");
        r();
      }, 5000);
      proc.once("exit", () => {
        clearTimeout(t);
        r();
      });
    });
  }
}

await mkdir(OUT, { recursive: true });
await capture("en-US", path.join(OUT, "screenshot-popup-en.png"), "coffee", "en");
await capture("zh-HK", path.join(OUT, "screenshot-popup-zh.png"), "咖啡", "zh");
