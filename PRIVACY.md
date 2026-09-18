# Privacy policy

My Unit is a browser extension. It does not have an account system and it does not upload the pages you visit.

## What is read on the page

A content script looks at visible text (and Amazon `.a-price` widgets) to find amounts that already include a currency signal. Matching is done locally. **Page HTML, URLs, and converted values are not sent to us.** We do not operate a backend.

## What is fetched from the network

Only from the extension’s background worker, and only to compute your unit:

- **FX:** `https://api.frankfurter.dev` (ECB daily rates). Currencies the ECB does not publish (for example TWD) fall back to Yahoo Finance `CODE=X` quotes. If both fail, that currency cannot be converted.
- **Live units (optional):** `https://query1.finance.yahoo.com` / `https://query2.finance.yahoo.com` chart API for the ticker you typed. These Yahoo endpoints are unofficial.

No browsing history is included in those requests.

## What is stored on your machine

Your unit (custom name/price/currency or Yahoo ticker and last quote), FX cache, default and per-site `$` / `¥` settings, and paused hostnames, in `chrome.storage.local`.

## Permissions

- **Read and change data on websites you allow** — optional. After you save a unit, you can grant access so prices can be underlined. You can also convert a selection on the current tab from the right-click menu without that grant. Use the per-site toggle on internet banking or anywhere you do not want it.
- **storage** — settings and cached quotes.
- **alarms** — refresh FX (daily) and Yahoo (~15 min) only while a live ticker is saved.
- **scripting** — inject the content script on pages you have allowed (or the current tab after a user gesture).
- **activeTab** — so the popup can pause or override `$` on the page you have open, and so right-click Convert can run on that tab.
- **contextMenus** — convert selected text from the right-click menu. Selection is parsed locally.

## Contact

Source and issues: [github.com/fun2code852/my-unit](https://github.com/fun2code852/my-unit).
