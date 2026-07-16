# Bug: Clicking a variant swatch returns 404 instead of switching variants

**Slug:** variant-clicks-return-404
**Reported:** 2026-05-18
**Reported by:** Junior Warner (surfaced during QA of fix-codegen-selectedoptions-not-defined)
**Severity:** High — blocks the core variant-selection UX; users cannot switch variants via the UI
**Affected scope:** All product pages that render variant option swatches or a Listbox dropdown (e.g. Color, Size). Affects both the swatch grid and the `<Listbox>` dropdown paths in the product route.

## Steps to reproduce

1. `cd ~/Projects/Shopify/hydrogen-storefront && npm run dev`
2. Open `http://localhost:3000/products/the-complete-snowboard` in a browser
3. Observe the Color variant swatches (Ice, Dawn, Powder, Electric, Sunset)
4. Click any swatch that is not the currently selected variant (e.g. "Dawn")
5. Observe the URL the browser navigates to and the HTTP response

## Expected behavior

Clicking the "Dawn" swatch navigates to:

```
/products/the-complete-snowboard?Color=Dawn
```

The page reloads with the Dawn variant selected (different price, images, and `variantId`).

## Actual behavior

Clicking the "Dawn" swatch navigates to:

```
/products/the-complete-snowboard/Color=Dawn
```

The Remix router has no route matching this path-segment pattern, so the page returns HTTP 404. The variant never switches.

Confirmed in dev server log during QA Round 2:

```
GET 404 loader /products/the-complete-snowboard/Color=Dawn
```

Direct navigation via query param DOES work — `http://localhost:3000/products/the-complete-snowboard?Color=Dawn` returns HTTP 200 and resolves the correct variant GID (`gid://shopify/ProductVariant/50239737364700`). The GraphQL layer and server-side variant resolution are correct; the issue is purely in the client-side URL construction.

## Hypothesis

Both the swatch `<Link to={variantUriQuery}>` (line 299) and the Listbox `<Link to={value.variantUriQuery}>` (line 274) in `app/routes/($locale).products.$productHandle.jsx` get their `to` value from the `variantUriQuery` field returned by `getProductOptions` (`@shopify/hydrogen`).

The `getProductOptions` helper constructs `variantUriQuery` from the current URL and the option name/value pair. If it is receiving a path-based URL (e.g. the `request.url` on the server) or producing a relative path segment rather than a query string, the output would be `/products/<handle>/Color=Dawn` instead of `/products/<handle>?Color=Dawn`.

Possible causes (to be confirmed by investigation):

1. `getProductOptions` is being called with incorrect arguments — e.g. missing the `request` or `searchParams` needed to generate query-param-style URLs
2. A version mismatch between the Hydrogen SDK's `getProductOptions` output format and what the route expects
3. The `variantUriQuery` value coming from the GraphQL response itself (via the `optionValues { variantUriQuery }` field) is pre-rendered by the Storefront API in path-segment format rather than query-param format

## Suspected files

- `app/routes/($locale).products.$productHandle.jsx` — lines 125–130 (where `getProductOptions` is called), lines 274 and 299 (where `variantUriQuery` is used as the `to` prop)
- `app/lib/variants.js` or equivalent — if there is a local `getVariantUrl` / `variantUriQuery` helper
- Possibly the GraphQL fragment at lines 460–480 — if `variantUriQuery` is fetched directly from the Storefront API rather than computed client-side

## Regression risk areas

Identified during planning (`docs/plans/fix-variant-clicks-return-404.md`, Section 6). Mirrored from the investigation (`docs/bugs/variant-clicks-return-404-investigation.md`, "Regression risk areas") with planning-stage clarifications:

1. **Locale-prefix handling in `app/components/Link.jsx`.** The wrapper prepends `selectedLocale.pathPrefix` to string `to` values that do not already start with the prefix. After the fix, `to` becomes `?Color=Dawn`. On the default locale (`pathPrefix = ''`) the prepend branch is skipped — verified safe. On a non-default locale (e.g. `/en-ca`), the wrapper would produce `/en-ca?Color=Dawn`, which Remix resolves against the current pathname for the query string but replaces the path with `/en-ca`, dropping `/products/<handle>`. **QA must regression-check the locale-prefixed product page.** See plan Section 7, verification step 6. If this regresses, file follow-up `fix-variant-clicks-locale-prefix-drops-handle` — do not absorb into this plan's scope.

2. **Analytics variant-click events.** `<Analytics.ProductView>` at line 189 of the product route receives `selectedVariant.id`. Variant switching must re-render with a new `selectedVariant` so `variantId` updates downstream. QA verifies the `variantId` payload changes on swatch click.

3. **URL prefetch (`prefetch="intent"`).** Both `<Link>` sites use `prefetch="intent"`. Pre-fix, hover prefetch was hitting the 404 path; post-fix, prefetch should target the correct query-string URL. Watch the dev server log on hover — 404 prefetch noise should disappear.

4. **SEO canonicals (`seoPayload.product` at line 82 of the product route).** Constructed server-side from `request.url`; not structurally affected by client-side `<Link>` `to` formatting. Post-fix, when a user lands on `?Color=Dawn`, the `og:url` / canonical should reflect the query-string URL. Smoke-check view-source for canonical tags after variant click.

5. **Other call sites of `getProductOptions`.** Investigation confirmed none exist elsewhere in the codebase at the time of writing. Any future call site will inherit the same `?`-prefix requirement.

Scope boundary: no other files share the `<Link to={variantUriQuery}>` pattern. The two call sites in `app/routes/($locale).products.$productHandle.jsx` (lines 274 and 299) are the complete change surface.
