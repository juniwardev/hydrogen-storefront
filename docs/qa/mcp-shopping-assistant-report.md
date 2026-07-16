# QA Report: `mcp-shopping-assistant`

**Re-test after fix round 3 (comprehensive)** — fourth QA pass following the Coder's comprehensive fix addressing all six Hydrogen `validateProducts()` fields simultaneously.

Tester: QA Agent
Date: 2026-06-27
Slug: `mcp-shopping-assistant`
Dev server: `http://localhost:3000` (no storefront password gate; bound port 3000 confirmed)
MCP used: Playwright MCP (primary); Chrome DevTools MCP not needed
Automated gate: `npm run test:unit` → 42/42 pass

---

## Summary verdict

**PASS**

All previously failing defects are cleared. The Analytics Contract is now fully satisfied: zero `[h2:error:ShopifyAnalytics]` errors across the entire browser session (initial render, search, add-to-cart, empty-state), and network evidence confirms `Analytics.ProductView` events are actually firing with all six required fields populated. All prior-pass items remain green.

---

## Analytics error count (headline result)

**0 `[h2:error:ShopifyAnalytics]` errors observed.**

Prior round: 16 errors (`variantTitle` falsy).
This round: 0 errors.

Positive confirmation: monorail `produce_batch` network request #88 contains:

```json
{
  "event_name": "product_page_rendered",
  "products": [
    {
      "product_gid": "gid://shopify/Product/9356161056988",
      "name": "The Videographer Snowboard",
      "variant": "Default Title",
      "brand": "Unknown",
      "price": 885.95,
      "variant_gid": "gid://shopify/ProductVariant/50239738413276",
      "product_id": 9356161056988,
      "variant_id": 50239738413276
    }
  ]
}
```

All six fields from Hydrogen `validateProducts()` (lines 552–572) are truthy: `id`, `title`, `price`, `vendor` (`brand: "Unknown"`), `variantId`, and `variantTitle` (`variant: "Default Title"`). The events are SET UP and FIRING, not merely error-free.

---

## Per-scenario table

| #   | Scenario                                                                         | Expected                                                                   | Actual                                                                                                                                                                                                                                   | Pass/Fail |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| P1  | Analytics — 0 `[h2:error:ShopifyAnalytics]` errors                               | 0 errors total for any field                                               | 0 errors across all interactions (initial, search, add-to-cart, empty-state)                                                                                                                                                             | **PASS**  |
| P1b | Analytics — `ProductView` events fire with valid payload                         | Truthy variantId, vendor, variantTitle in monorail payload                 | monorail request #88 confirms `variant: "Default Title"`, `brand: "Unknown"`, `variant_id: 50239738413276` all present and truthy                                                                                                        | **PASS**  |
| P2  | DOM nesting regression — no `validateDOMNesting` after add-to-cart               | 0 `validateDOMNesting` warnings                                            | 0 warnings. Cart summary `<Money>` correctly wrapped in `<div>` (not `<p>`); no regression from round 2 fix                                                                                                                              | **PASS**  |
| 3   | SSR + hydration: real server HTML; 0 React hydration warnings; launcher appears  | Server HTML has product content; 0 hydration warnings; chat button visible | `curl` of `/` returns "The Complete Snowboard" ×3 in markup. 0 React hydration warnings. Floating launcher renders as "Open shopping assistant" button after hydration.                                                                  | **PASS**  |
| 4   | Product discovery: 8 cards with real `cdn.shopify.com` images, titles + prices   | Cards rendered, CDN images, titles, prices populated                       | 8 cards: The Videographer Snowboard, Collection Snowboard Oxygen, Liquid, Hydrogen, The Hidden Snowboard, Multi-location, Multi-managed, The Complete Snowboard. All images from `cdn.shopify.com`. All prices populated.                | **PASS**  |
| 5   | Price correctness (AL-21): sane prices, NOT 100×                                 | ~$600–$1,025 for snowboards                                                | $885.95 / $1,025.00 / $749.95 / $600.00 / $749.95 / $729.95 / $629.95 / $699.95. The Complete Snowboard at $699.95 matches homepage card. No 100× anomaly.                                                                               | **PASS**  |
| 6   | Cart assistance: add-to-cart → cart summary with sane price + real checkout URL  | Cart summary shows item count + price + real `checkout_url` link           | "Assistant cart — 1 item · $885.95" with "Go to checkout →" linking to `https://theme-evolution-os2-hydrogen.myshopify.com/cart/c/hWNDpjK5T1BYv56mloA4mq2y?key=...` (real Shopify Cart GID; `target="_blank" rel="noopener noreferrer"`) | **PASS**  |
| 7   | Empty vs error states distinct: junk query → empty (neutral), not `role="alert"` | "No matches found" in neutral styling; no `role="alert"` elements          | "No matches found — try different words." for "asdfqwerty12345". `document.querySelectorAll('[role="alert"]').length === 0`. Send re-enabled (empty input).                                                                              | **PASS**  |
| 8   | Trust boundary: browser calls only `/api/assistant`, not raw `/api/mcp`          | 3 POSTs to `localhost:3000/api/assistant`; 0 raw MCP calls from browser    | 3 POSTs to `http://localhost:3000/api/assistant` (200 OK each). No request to `theme-evolution-os2-hydrogen.myshopify.com/api/mcp` in browser network log. MCP client code absent from client bundles (Coder-verified).                  | **PASS**  |
| 9   | Automated gate: `npm run test:unit` 42/42 pass                                   | 42 pass, 0 fail                                                            | 42/42 pass. Suites include: two-path normalizer isolation, vendor truthy + negative-pair, comprehensive Analytics.ProductView payload contract (positive × 2, negative × 6), callTool 429 rate-limit handling.                           | **PASS**  |

---

## Issues found

None. All prior defects are cleared with no new defects introduced.

**Prior defects status:**

| Defect                                                                                         | Round claimed fixed | Status after round 3                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Defect 1 (HIGH): Analytics Contract — `variantTitle: ''` falsy — events dropped for every card | Round 3             | **CLEARED** — 0 `[h2:error:ShopifyAnalytics]` errors; all 6 required fields truthy; monorail events firing |
| Defect 2 (MEDIUM): `<Money>` inside `<p>` in cart summary                                      | Round 2             | **CLEARED** (remains cleared; no regression)                                                               |

---

## Console errors and warnings

**At page load (before any interaction):**

- 0 errors
- 0 warnings

**After "show me snowboards" search (8 cards rendered):**

- 0 errors (previously 16 `[h2:error:ShopifyAnalytics]` about `variantTitle`)
- 0 warnings
- 0 React hydration warnings
- 0 `validateDOMNesting` warnings

**After add-to-cart (cart summary rendered):**

- 0 errors (previously 1 `validateDOMNesting` about `<div>` inside `<p>`)
- 0 warnings

**After empty-state query "asdfqwerty12345":**

- 0 errors
- 0 warnings

Total console messages for entire session: 3 (2 Vite debug — `[vite] connecting...` / `[vite] connected.`; 1 React DevTools info). No actionable items.

---

## Network observations

- 3 POSTs to `http://localhost:3000/api/assistant` — all 200 OK (search, add-to-cart, empty query)
- 0 requests to `https://theme-evolution-os2-hydrogen.myshopify.com/api/mcp` from the browser
- Multiple POSTs to `https://monorail-edge.shopifysvc.com/unstable/produce_batch` — these are Hydrogen Analytics events firing for the rendered product cards, confirming `Analytics.ProductView` is now correctly set up
- 1 POST to `https://theme-evolution-os2-hydrogen.myshopify.com/api/unstable/graphql.json` — Hydrogen's own Storefront GraphQL (normal, not MCP)
- Cart checkout URL: `https://theme-evolution-os2-hydrogen.myshopify.com/cart/c/hWNDpjK5T1BYv56mloA4mq2y?key=...` (real Shopify Cart GID, `target="_blank" rel="noopener noreferrer"`)

---

## Accessibility observations

- Floating launcher has accessible label "Open shopping assistant" / "Close shopping assistant"
- Panel has `role="dialog"` with accessible name "Shopping assistant"
- Error state uses `role="alert"` (correct ARIA role — not triggered in this session as no errors were induced)
- Empty state does NOT use `role="alert"` (correct — neutral informational state; verified via `querySelectorAll('[role="alert"]').length === 0`)
- "Add to cart" / "Sold out" button visible state matches variant availability

---

## Performance notes

None flagged. 8 product cards render without visible layout shift. Images use `loading="lazy"` with no fabricated dimensions (correct per AL-22 plan directive). Send button is disabled during in-flight requests.

---

## Automated gate results

```
npm run test:unit
ℹ tests 42
ℹ suites 12
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 54.831375
```

Suites verified:

- `normalizeSearchCatalogMoney` (2 tests) — PASS
- `normalizeProductDetailsMoney` (2 tests) — PASS
- `normalizeCatalogProduct — vendor field truthy` (3 tests incl. negative-pair) — PASS
- `normalizeProductDetail — vendor field truthy` (3 tests incl. negative-pair) — PASS
- `Analytics.ProductView — comprehensive payload contract` (8 tests: 2 positive paths + 6 per-field negatives) — PASS
- `normalizeCartMoney` (2 tests) — PASS
- `callTool 429 / rate-limit handling` (5 tests) — PASS
- `minorUnitsToDecimalString` (3 tests) — PASS
- `normalizeCatalogProduct — integer minor units path` (4 tests) — PASS
- `normalizeProductDetail — decimal string path` (5 tests) — PASS
- `normalizeCart — cart decimal string path` (3 tests) — PASS
- `price path isolation` (2 tests) — PASS

---

## Screenshots

- `/Users/juniorwarner/Projects/Shopify/hydrogen-storefront/docs/qa/mcp-r3-search-results.png` — 8 product cards in panel after "show me snowboards" search
- `/Users/juniorwarner/Projects/Shopify/hydrogen-storefront/docs/qa/mcp-r3-cart-summary.png` — cart summary with "1 item · $885.95" and "Go to checkout →" link
- `/Users/juniorwarner/Projects/Shopify/hydrogen-storefront/docs/qa/mcp-r3-empty-state.png` — "No matches found" empty state with prior search results still visible above

---

PASS
