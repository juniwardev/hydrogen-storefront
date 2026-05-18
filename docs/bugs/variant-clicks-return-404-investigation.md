# Investigation: Clicking a variant swatch returns 404 instead of switching variants

**Bug slug:** variant-clicks-return-404

**Date:** 2026-05-18

---

## Root cause

The `getProductOptions` helper from the Hydrogen SDK (`@shopify/hydrogen-react`) correctly returns `variantUriQuery` as a query string (e.g., `"Color=Dawn"`), but in `app/routes/($locale).products.$productHandle.jsx` at lines 274 and 299, this value is passed directly to the custom `<Link to={variantUriQuery}>` component without a leading `?`. Remix's Link component treats relative string paths without a leading `/` as relative-path navigation, so `Color=Dawn` gets appended as a path segment, resulting in `/products/the-complete-snowboard/Color=Dawn` instead of `/products/the-complete-snowboard?Color=Dawn`.

---

## Mechanism

The exact chain of cause and effect:

1. `getProductOptions(product)` is called at line 125-128 of `app/routes/($locale).products.$productHandle.jsx`
2. The Hydrogen SDK helper returns an array of option objects, each containing `optionValues` where each value has a `variantUriQuery` field (generated at line 236 of `@shopify/hydrogen-react/dist/node-prod/getProductOptions.mjs`)
3. The `variantUriQuery` is created as `searchParams.toString()` on a `URLSearchParams` object built from the variant's selected options (line 230 of the SDK). This correctly produces a query string like `"Color=Dawn"` with no leading `?`
4. In the route, this string is passed as the `to` prop at line 274 (Listbox option) and line 299 (swatch grid)
5. The custom `Link` component (`app/components/Link.jsx`) prepends the locale prefix if needed, but since the string doesn't start with `/`, it's still treated as a relative path by Remix
6. Remix's router appends `Color=Dawn` as a path segment to the current URL, producing `/products/the-complete-snowboard/Color=Dawn`
7. This path has no matching route in the Remix file-based router, so the loader returns 404

The root issue is that the route code expects `variantUriQuery` to already include the `?` prefix, but the SDK helper intentionally returns only the query string portion (the part after `?`).

---

## Suggested fix approach

There are two viable approaches:

**Option A (Recommended):** Modify the route to prepend `?` to the `variantUriQuery` before passing it to `<Link>`. This can be done either:
  - Inline at the two `<Link>` usage points (lines 274 and 299), passing `to={`?${value.variantUriQuery}`}`
  - By adding a local helper function to wrap the SDK output (e.g., `getVariantLinks()`) that enriches each option value with a properly formatted URL

**Option B:** Create a custom variant link helper in `app/lib/` that takes the raw SDK output and rewrites `variantUriQuery` to include the `?` prefix, then use that throughout the component.

Option A (inline fix at usage sites) is simpler and more straightforward for this specific bug, while Option B would provide a reusable pattern if variant URLs are used elsewhere in the future.

---

## Regression risk areas

The following code paths could be affected by a fix to the variant URL construction:

1. **Other product pages** — any component that renders variant selection UI would need the same fix. The bug report notes that both Listbox and swatch paths are affected, suggesting a shared root cause, but a fix should be applied at both call sites to be safe.

2. **Custom Link component behavior** — the `app/components/Link.jsx` wrapper adds locale prefix handling. If the fix involves passing an object-style `to` prop instead of a string, the Link component's locale-prefix logic would not apply, and manual locale prefix handling would be needed.

3. **Analytics and tracking** — if variant link generation is tied to any analytics event (e.g., variant click tracking), ensure that refactoring variant URL construction doesn't break event payload construction.

4. **URL preview or prefetch** — Remix's `prefetch="intent"` and `preventScrollReset` flags are already set correctly on the variant links. Ensure that a URL construction change doesn't affect prefetch behavior.

5. **SEO and canonical URLs** — the seoPayload function at line 82-86 in the route receives the product and selectedVariant. Ensure that variant URL changes don't affect how the SEO layer constructs og:url or canonical links.

No other calls to `getProductOptions` were found in the codebase at the time of investigation, so the regression scope is limited to this single product route file.
