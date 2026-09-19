# Chrome Web Store listing copy

Paste these into the Developer Dashboard. Upload the PNGs. Site shots are from live pages (Apple HK, Tabelog, 28Hse), not mocks. Those three captures stay local for the dashboard and are gitignored.

## Graphic assets

| File | Size | Dashboard field |
| --- | --- | --- |
| [tile-440x280.png](tile-440x280.png) | 440×280 | Small promotional tile (required) |
| [screenshot-popup-en.png](screenshot-popup-en.png) | 1280×800 | Screenshot — popup, custom unit coffee · HK$50 |
| screenshot-apple.png (local) | 1280×800 | Screenshot — iPhone Duo `HK$17,499` → 350 coffee |
| screenshot-tabelog.png (local) | 1280×800 | Screenshot — Tabelog `￥4,000` → 198.7 HKD |
| screenshot-28hse.png (local) | 1280×800 | Screenshot — 28Hse monthly rent `$20,500` → 0.032 BTC-USD |
| [screenshot-popup-zh.png](screenshot-popup-zh.png) | 1280×800 | Localized screenshot (zh-HK / zh-TW popup) |
| [../icons/icon128.png](../icons/icon128.png) | 128×128 | Store icon (already in the zip) |

Marquee 1400×560 and a YouTube video are optional.

## Privacy policy URL

https://github.com/fun2code852/my-unit/blob/main/PRIVACY.md

Homepage / support: https://github.com/fun2code852/my-unit

## Category

Shopping (or Productivity if the dashboard prefers a tools listing).

## English

### Short description (manifest, ≤132 characters)

Hover webpage prices to see them in one favourite unit — a custom item, a Yahoo Finance symbol, or a currency.

### Detailed description

My Unit shows webpage prices in one unit you choose: a custom item (ramen, coffee, a day’s spending), a Yahoo Finance ticker, or a display currency.

Hover an underlined price to see the conversion. Select a price and right-click Convert for the same tooltip. The original amount stays on the page.

It only matches amounts that already include a currency signal (HK$310.00, $ 43.00, HKD 78.37). Bare numbers are ignored. Amazon list / “was” prices are skipped.

Save a unit to start. Chrome then asks for website access so prices can be underlined. You can pause any site from the popup. Right-click Convert still works on the current tab without that grant.

Live tickers poll Yahoo Finance about every 15 minutes (quotes are unofficial and often delayed). FX uses Frankfurter (ECB daily rates); currencies the ECB omits, such as TWD, fall back to Yahoo. Nothing from the page is uploaded.

Unmarked $ and ¥ follow marked prices on the page when those marks agree; otherwise $ is HKD. A per-site $ or ¥ in the popup wins over that guess.

### Single purpose

Convert detected webpage prices into one user-chosen unit.

## Traditional Chinese (use for both zh-HK and zh-TW listing fields)

### Short description (manifest)

將網頁上的價錢換算成你常用的單位——自訂物品、Yahoo 財經代碼或貨幣。

### Detailed description

My Unit 把網頁上的價錢，換成你選定的一個單位：自訂物品（拉麵、咖啡、一日開支）、Yahoo 財經代碼，或顯示貨幣。

將游標移到加了點線的價錢上即可看到換算。選取價錢後按右鍵換算，也會顯示同一個提示。原價仍留在頁面上。

只辨識已帶貨幣標記的金額（HK$310.00、$ 43.00、HKD 78.37），不會處理沒有貨幣的數字。Amazon 的劃線／原價會略過。

儲存單位後才會開始。Chrome 接著會詢問網站存取權限，以便在價錢下加線。可在彈出視窗暫停任何網站。即使未授權，目前分頁仍可用右鍵換算。

即時代碼約每 15 分鐘向 Yahoo Finance 查價（非官方報價，常有延遲）。匯率使用 Frankfurter（歐洲央行每日匯率）；ECB 沒有的貨幣（例如 TWD）會改用 Yahoo。頁面內容不會上傳。

沒有標記的 $ 與 ¥ 會跟頁面上已標明的價錢走；否則 $ 為港元。可在彈出視窗為個別網站覆寫 $ 與 ¥。

### Single purpose

把網頁上偵測到的價錢，換成使用者選定的一個單位。

## Privacy practices

Answer the dashboard from [PRIVACY.md](../PRIVACY.md):

- Personally identifiable information: no
- Health, financial, authentication, personal communications: no
- Web history / user activity: the content script reads prices and currency marks on pages you allow, locally only. Page HTML, URLs, and converted values are not sent to us.
- Location, webcams, etc.: no
- Remote code: no
- Data sold or used for advertising / creditworthiness: no
- Transfer to third parties: FX requests go to Frankfurter; live units and some FX gaps go to Yahoo Finance chart quotes. No browsing history is included.

## Permission justifications

Use these in the permissions questionnaire and, if asked, the listing.

- **storage** — Save the unit, FX cache, `$`/`¥` defaults and per-site overrides, and paused hostnames on the device.
- **alarms** — Refresh ECB FX about daily, and Yahoo quotes about every 15 minutes only while a live ticker is saved.
- **activeTab** — Pause or override `$`/`¥` on the open tab, and inject so right-click Convert can run after a user gesture.
- **contextMenus** — Convert selected text from the right-click menu. Parsing is local.
- **scripting** — Inject the content script on sites the user has allowed, or on the current tab after a gesture.
- **Host: query1/query2.finance.yahoo.com** — Unofficial chart quotes for a saved ticker and for FX pairs ECB does not publish.
- **Host: api.frankfurter.dev** — ECB daily FX rates.
- **Optional host: http(s)://\*/\*** — Underline prices on pages the user grants after saving a unit. Not required at install. Per-site pause is in the popup.

## Zip for upload

Package the extension root, not this `store/` folder:

- Include `manifest.json`, `background.js`, `content.js`, `content.css`, `popup.*`, `lib/`, `_locales/`, `icons/*.png`
- Exclude `.git`, `test/`, `store/`, `README.md` is optional
