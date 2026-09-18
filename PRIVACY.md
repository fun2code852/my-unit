# Privacy policy

My Unit is a browser extension. It does not have an account system and it does not upload the pages you visit.

## What is read on the page

A content script looks at visible text (and Amazon `.a-price` widgets) to find amounts that already include a currency signal. Matching is done locally. **Page HTML, URLs, and converted values are not sent to us.** We do not operate a backend.

## What is fetched from the network

Only from the extension’s background worker, and only to compute your unit:

- **FX:** `https://api.frankfurter.dev` (ECB daily rates).
- **Live units (optional):** `https://query1.finance.yahoo.com` / `https://query2.finance.yahoo.com` chart API for the ticker you typed. These Yahoo endpoints are unofficial.

No browsing history is included in those requests.

## What is stored on your machine

Your unit (custom name/price/currency or Yahoo ticker and last quote), FX cache, per-site `$` overrides, and paused hostnames, in `chrome.storage.local`.

## Permissions

- **Read and change data on all websites** — so prices can be underlined and a tooltip can be shown. Use the per-site toggle on internet banking or anywhere you do not want it.
- **storage** — settings and cached quotes.
- **alarms** — refresh Yahoo (~15 min) and FX (daily).
- **activeTab** — so the popup can pause or override `$` on the page you have open.
- **contextMenus** — convert selected text from the right-click menu. Selection is parsed locally.

## Contact

Source and issues: [github.com/fun2code852/my-unit](https://github.com/fun2code852/my-unit).
