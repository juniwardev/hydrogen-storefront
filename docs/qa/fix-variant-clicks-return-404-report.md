# QA Report: fix-variant-clicks-return-404

**Slug:** fix-variant-clicks-return-404
**Date:** 2026-05-18
**QA agent:** Claude Sonnet 4.6
**MCP used:** Playwright (headless Chromium via project node_modules), with Bash/curl for supplementary checks
**Dev server port:** 3003 (ports 3000-3002 were occupied by other processes)

---

## Summary verdict

PASS WITH NITS

---

## Bug reproduction lines

**Bug reproduced before fix: not attempted (with reason)** — The fix has already been committed to `main`. Pre-fix state is not accessible without reverting the commit, which is out of QA scope. The bug report describes the mechanism, and static analysis of the before/after diff in `docs/plans/fix-variant-clicks-return-404-impl-notes.md` confirms the two `to={variantUriQuery}` props were changed to `to={{search: variantUriQuery}}`.

**Bug reproduced after fix: no** — Swatch clicks navigate to the correct query-param URL. Zero instances of the path-segment bug pattern (`/products/the-complete-snowboard/Color=Dawn`) were found in any rendered link href.

---

## Dev server startup

- Started `npm run dev` from `/Users/juniorwarner/Projects/Shopify/hydrogen-storefront`
- Server started on `http://localhost:3003` (port 3000-3002 in use)
- Warnings observed at startup:
  - Vite CJS deprecation notice — pre-existing
  - `v3_singleFetch` future flag advisory — pre-existing
  - 19 new Hydrogen versions available (informational) — pre-existing
  - Codegen-level mirror of the same two warnings — pre-existing
- No new or unexpected warnings introduced by this fix.

---

## Check results

### Check A: Variant swatch click — no 404, correct URL shape

**Result: PASS**

- Navigated to `http://localhost:3003/products/the-complete-snowboard`
- All five Color swatch link hrefs confirmed to be query-param style: `/products/the-complete-snowboard?Color=Ice`, `?Color=Dawn`, `?Color=Powder`, `?Color=Electric`, `?Color=Sunset`
- Zero links matching the bug pattern (`/products/the-complete-snowboard/Color=<value>`) found
- Clicked the Dawn swatch: browser URL changed to `http://localhost:3003/products/the-complete-snowboard?Color=Dawn`
- HTTP status for `/products/the-complete-snowboard?Color=Dawn`: **200**
- HTTP status for `/products/the-complete-snowboard/Color=Dawn` (the old bug path): **404** — confirms the path-segment form has no route, and the fix correctly avoids it

Evidence:
```
Dawn link href: /products/the-complete-snowboard?Color=Dawn
Dawn href is query-param style: true
Dawn href is path-segment (BUG) style: no
URL after Dawn click: http://localhost:3003/products/the-complete-snowboard?Color=Dawn
After click - URL has ?Color=Dawn query param: true
After click - URL has path segment (BUG): no
```

MCP used: Playwright

### Check B: Variant data updates after click

**Result: PASS**

- Default variant GID: `gid://shopify/ProductVariant/50239737331932`
- Dawn variant GID: `gid://shopify/ProductVariant/50239737364700`
- Variant IDs differ between default and Dawn pages — confirmed the server returns a different variant on each
- Swatch selection state visually updates: "Dawn" shows `border-primary/50` class (selected underline); non-selected swatches show `border-transparent opacity-50`
- The loader request after click returns HTTP 200 with correct Remix data: `GET 200 /products/the-complete-snowboard?Color=Dawn&_data=routes/($locale).products.$productHandle`

Evidence (swatch classes on Dawn page):
```
Dawn link classes: leading-none py-1 border-b-[1.5px] cursor-pointer transition-all duration-200 border-primary/50
Ice link classes: leading-none py-1 border-b-[1.5px] cursor-pointer transition-all duration-200 border-transparent opacity-50
```

Screenshots: `docs/qa/fix-variant-clicks-default-product.png` (Ice selected), `docs/qa/fix-variant-clicks-dawn-selected.png` (Dawn selected)

MCP used: Playwright

### Check C: Listbox dropdown path

**Result: NOT APPLICABLE**

The product `the-complete-snowboard` has 5 Color values (Ice, Dawn, Powder, Electric, Sunset), which is below the 7-option threshold for the Listbox dropdown path. The swatch grid renders for all options. The Listbox `<Link>` at line 274 received the same `to={{search: value.variantUriQuery}}` fix and was confirmed applied in static analysis.

### Check D: Analytics Contract — variantId

**Result: PASS**

The `selectedVariant.id` differs between the default page and the Dawn variant page:
- Default: `gid://shopify/ProductVariant/50239737331932`
- Dawn: `gid://shopify/ProductVariant/50239737364700`

The `<Analytics.ProductView>` at line 189 receives `selectedVariant` from the loader data, and the loader correctly resolves the variant from `?Color=Dawn` query params. The variant GID in the serialized page source updates on variant switch, confirming the Analytics Contract is satisfied.

MCP used: Playwright + curl (page source inspection)

### Check E: Locale-prefix regression — PASS (critical)

**Result: PASS — no regression**

This was the highest-risk regression area identified in the bug report.

- Navigated to `http://localhost:3003/en-ca/products/the-complete-snowboard`
- Page loaded with HTTP 200, title "The Complete Snowboard | Hydrogen Demo Store"
- All swatch hrefs on the locale-prefixed page include the full locale-prefixed path:
  ```
  /en-ca/products/the-complete-snowboard?Color=Ice
  /en-ca/products/the-complete-snowboard?Color=Dawn
  /en-ca/products/the-complete-snowboard?Color=Powder
  /en-ca/products/the-complete-snowboard?Color=Electric
  /en-ca/products/the-complete-snowboard?Color=Sunset
  ```
- Clicked the Dawn swatch on the locale-prefixed page
- URL became: `http://localhost:3003/en-ca/products/the-complete-snowboard?Color=Dawn`
  - Locale prefix preserved: YES
  - Product handle preserved: YES
  - Query param appended: YES
  - Handle dropped (`/en-ca?Color=Dawn`): NO
  - Path segment regression: NO
- Loader returned HTTP 200 with correct data

The object-form `to={{search: variantUriQuery}}` correctly bypasses `app/components/Link.jsx`'s `typeof to === 'string'` guard (line 30), preventing the locale prefix prepend from mangling the URL.

Screenshots: `docs/qa/fix-variant-clicks-locale-default.png` (Ice selected on /en-ca), `docs/qa/fix-variant-clicks-locale-dawn-click.png` (Dawn selected on /en-ca)

MCP used: Playwright

### Check F: SEO canonical

**Result: PASS WITH NIT (see note)**

- After navigating to `http://localhost:3003/products/the-complete-snowboard?Color=Dawn`, the canonical tag in page source is:
  ```html
  <link rel="canonical" href="http://localhost:3003/products/the-complete-snowboard"/>
  ```
- The `og:url` meta tag similarly points to the base URL without query params.

**Important note on plan requirement vs. actual behavior:** The plan (Section 7, step 4a) says to "Confirm the `href` attribute contains `?Color=Dawn`". However, inspection of the Hydrogen SDK source (`@shopify/hydrogen/dist/development/index.js` line 4777) reveals that `getSeoMeta` **explicitly strips query parameters** from the canonical URL:

```js
const urlWithoutParams = content.split("?")[0];
```

This is intentional Hydrogen framework behavior — canonical tags always point to the base product URL, not the variant-specific URL. This is consistent with standard SEO practice (all variants canonicalize to the same product page). The `seoPayload.product` does receive `url: request.url` (which includes `?Color=Dawn`), but the framework strips the params before rendering the canonical.

This behavior is identical before and after the fix (the fix did not touch SEO logic). The canonical correctly contains the product handle and the fix has not broken canonical output. The plan's expectation that `?Color=Dawn` would appear in canonical is incorrect about Hydrogen's framework behavior.

**Verdict on SEO check:** The canonical is correct per Hydrogen's design. This is a nit on the plan's verification wording, not a bug in the implementation.

MCP used: Playwright + curl (server-side source verification)

### Check G: No regressions — homepage and product page baseline

**Result: PASS WITH PRE-EXISTING NITS**

**Homepage:**
- Navigated to `http://localhost:3003/`
- Title: "Home | Hydrogen Demo Store"
- HTTP 200
- No new errors

**Product page:**
- 11 images loaded
- Price `$949.95` rendered correctly
- All swatch options rendered
- Add to Cart button visible

**Console errors and warnings:**

1. **`preserveControl` React prop warning** (3 occurrences on product page hydration):
   ```
   Warning: React does not recognize the `preserveControl` prop on a DOM element.
   If you intentionally want it to appear in the DOM as a custom attribute, spell it
   as lowercase `preservecontrol` instead.
   ```
   Source: `app/routes/($locale).products.$productHandle.jsx`, via `Link.jsx`

   This is a **pre-existing issue** explicitly documented in the implementation notes (OQ2, Section 6 of the plan) and the impl-notes file. The `preserveControl` prop was not introduced by this fix — it was already on the swatch `<Link>` before. The plan explicitly directs: "do not remove or fix it in this pass — it is recorded as an observation in OQ2 for a separate cleanup ticket." It is not a new regression.

2. **`prefetch /collections/frontpage` warning** (pre-existing):
   ```
   Tried to prefetch /collections/frontpage but no routes matched.
   ```
   This is a pre-existing warning unrelated to this fix.

**No React hydration warnings** observed beyond the pre-existing `preserveControl` prop warning.

**No new network 404 errors** from swatch hover (prefetch now targets correct query-param URLs).

MCP used: Playwright

---

## Network failures

- Zero non-trivial network failures observed.
- `/products/the-complete-snowboard/Color=Dawn` (the old bug URL) correctly returns 404 — this is expected, as the path-segment route does not exist. The fix prevents the browser from ever navigating to it.

---

## Accessibility observations

- Color swatches render as `<a>` elements with descriptive text labels (Ice, Dawn, Powder, Electric, Sunset)
- No ARIA landmarks were checked in depth — outside the scope of this fix's verification

---

## Performance notes

None — this fix is a pure client-side URL-construction change with no server-side impact. No performance concerns.

---

## Screenshots

| File | Description |
|------|-------------|
| `docs/qa/fix-variant-clicks-default-product.png` | Default product page at `/products/the-complete-snowboard` (Ice selected) |
| `docs/qa/fix-variant-clicks-dawn-selected.png` | Product page at `?Color=Dawn` (Dawn selected, visually underlined) |
| `docs/qa/fix-variant-clicks-locale-default.png` | Locale-prefixed page at `/en-ca/products/the-complete-snowboard` (Ice selected) |
| `docs/qa/fix-variant-clicks-locale-dawn-click.png` | Locale-prefixed page after clicking Dawn: `/en-ca/products/the-complete-snowboard?Color=Dawn` |

---

## Issues found

### Issue 1 — Pre-existing `preserveControl` React warning (LOW severity, pre-existing)

**Description:** React logs a DOM prop warning for `preserveControl` on every hydration of the swatch grid.

**Reproduction:** Navigate to `http://localhost:3003/products/the-complete-snowboard`, open browser console.

**Severity:** Low — visual-only warning in DevTools console, no functional impact, no hydration mismatch.

**Status:** Pre-existing. Explicitly acknowledged in the plan (OQ2) and impl-notes as out-of-scope for this fix. A separate `cleanup-` ticket is recommended.

**MCP used:** Playwright

### Issue 2 — Plan's SEO canonical expectation incorrect about Hydrogen behavior (NIT, documentation)

**Description:** Plan Section 7 step 4a directs QA to "Confirm the `href` attribute contains `?Color=Dawn`" in the canonical tag. Hydrogen's `getSeoMeta` explicitly strips query params from canonical URLs (line 4777 of Hydrogen SDK). The canonical never contains variant query params — this is correct framework behavior, not a bug.

**Impact:** No functional or SEO regression. The canonical correctly points to the base product URL (standard SEO practice for product variants).

**Recommendation:** The plan's verification wording for step 4a should be updated to reflect that Hydrogen strips query params from canonicals by design. This is a documentation nit only.

**MCP used:** Playwright + static SDK analysis

---

## Verdict

**PASS WITH NITS**

The bug fix works correctly. Variant swatch clicks now navigate to `/products/the-complete-snowboard?Color=Dawn` (HTTP 200) instead of the path-segment 404 URL. The locale-prefix regression check passed — `/en-ca/products/the-complete-snowboard?Color=Dawn` resolves correctly with both locale prefix and product handle preserved. Analytics Contract is satisfied (variant GID updates on switch). No new errors or hydration warnings introduced.

The two nits are both pre-existing: the `preserveControl` React warning (acknowledged in the plan as out-of-scope) and a minor inaccuracy in the plan's SEO canonical verification expectation.
