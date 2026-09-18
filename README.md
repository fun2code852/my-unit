# My Unit

Chrome extension (Manifest V3): hover a detected price and see it in **one** unit — a custom item (ramen + price) or a [Yahoo Finance](https://finance.yahoo.com) ticker (`AAPL`, `0700.HK`, `BTC-USD`).

This is v0, load-unpacked. UI polish is later.

## What it does

- Finds prices that already include a currency signal (`HK$310.00`, `$ 43.00`, `HKD 78.37`). Bare numbers are ignored.
- Amazon uses the `.a-price` widget (same idea as [Opportunity Cost](https://github.com/TFTC-Holdings-Inc/opportunity-cost); reimplemented, not copied). CSS `line-through` and Amazon list-price widgets (`data-a-strike`, `a-text-price`) are skipped.
- Dotted underline, tooltip on hover. Select a price and right-click **Convert to …** for the same tooltip. Original price stays on the page.
- Live units poll Yahoo’s unofficial `v8/chart` endpoint every 15 minutes. The **Currency** tab (and custom/stock crosses) use [Frankfurter](https://frankfurter.dev) (ECB, daily). Nothing from the page is uploaded.
- Inactive until you save a unit in the popup. Per-site pause is a toggle in the popup.

Yahoo quotes are unofficial, often delayed, and can break without notice. Custom units still work if Yahoo dies. Default bare `$` is **HKD**.

## Load unpacked

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this folder
4. Pin **My Unit**, set a custom unit or validate a ticker
5. Open the dogfood pages below

## v0 dogfood

| Page | What should convert |
| --- | --- |
| https://www.petpetfootprint.com/ | `HK$310.00` and other `HK$` product prices |
| https://www.hktvmall.com/hktv/zh/ | `$ 43.00` as HKD |
| https://www.amazon.com/s?k=usb+c+cable | live `HKD 78.37`-style widgets; list / “was” prices skipped |

Known noise: promo banners (`$300` 免運), both ends of a `HK$35 ~ HK$756` range.

## Source

[github.com/fun2code852/my-unit](https://github.com/fun2code852/my-unit)

## Privacy

See [PRIVACY.md](PRIVACY.md). The Chrome Web Store listing should use this file’s URL on `main`.

## License

MIT. Amazon widget approach inspired by Opportunity Cost (MIT).
