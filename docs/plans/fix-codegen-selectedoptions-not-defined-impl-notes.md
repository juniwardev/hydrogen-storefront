# Impl Notes: fix-codegen-selectedoptions-not-defined

**Coder:** Claude (Sonnet 4.6)
**Date:** 2026-05-18
**Plan:** `docs/plans/fix-codegen-selectedoptions-not-defined.md` (Revision 2)
**Review:** `docs/reviews/fix-codegen-selectedoptions-not-defined-review.md` (APPROVE)

---

## Files changed

| File                                               | Change                                             | Reason                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/routes/($locale).products.$productHandle.jsx` | Added one line to `PRODUCT_QUERY` operation header | Declares `$selectedOptions: [SelectedOptionInput!]!` so the GraphQL operation signature matches the variable used via the fragment spread at line 482 |
| `storefrontapi.generated.d.ts`                     | Regenerated automatically by `npm run build`       | No hand-edits; codegen ran cleanly and produced a clean build                                                                                         |

### Exact change in `app/routes/($locale).products.$productHandle.jsx`

**Before (lines 499–504):**

```graphql
const PRODUCT_QUERY = `#graphql
  query Product(
    $country: CountryCode
    $language: LanguageCode
    $handle: String!
  ) @inContext(country: $country, language: $language) {
```

**After (lines 499–505):**

```graphql
const PRODUCT_QUERY = `#graphql
  query Product(
    $country: CountryCode
    $language: LanguageCode
    $handle: String!
    $selectedOptions: [SelectedOptionInput!]!
  ) @inContext(country: $country, language: $language) {
```

The insertion is at what was line 504 (the closing `)`) — one new line inserted before it, indented with 4 spaces to match the existing variable lines.

---

## Verification results

### npm run lint

**Result: Pre-existing errors present; no new errors introduced by this change.**

`npm run lint` reported 73 errors across many files, all pre-existing. The changed file (`($locale).products.$productHandle.jsx`) had 29 pre-existing errors (unused vars, import order, prettier formatting) that were present before this fix. None of those errors are at or near the line of the change (line 504). No new lint errors were introduced by the one-line addition.

Note: The pre-existing lint errors in the repo are an out-of-scope observation (see section below).

### npm run build

**Result: PASS — clean exit, no codegen warnings.**

The build completed successfully in approximately 4.6 seconds total (client + SSR bundles). The previous codegen warning:

```
[Codegen] GraphQL Document Validation failed with 1 errors;
Error 0: Variable "$selectedOptions" is not defined by operation "Product".
```

is **absent** from the build output. A targeted grep of the build output for "selectedOptions", "codegen", "GraphQL Document", and "Variable" returned only the build script line itself — no validation error.

`storefrontapi.generated.d.ts` was regenerated automatically as part of the build. The file was not hand-edited. The build exited cleanly, which is the acceptance criterion per the plan.

### npm run dev / smoke test

Per the task instructions, `npm run dev` was not run (the QA agent will do that). Steps 8 and 9 of the plan checklist (dev server startup confirmation, browser smoke test, and Analytics Contract verification) are delegated to QA. The `npm run build` clean exit is the type-validation gate per project conventions.

---

## Bug fix verification approach

QA should follow this procedure to confirm the bug is resolved (references the steps to reproduce from the original bug report):

1. Start the dev server: `npm run dev` from `/Users/juniorwarner/Projects/Shopify/hydrogen-storefront`.
2. Watch terminal output during startup. The warning `Variable "$selectedOptions" is not defined by operation "Product"` must NOT appear. If it does, the fix did not take effect.
3. Navigate to `http://localhost:3000` in a browser. From the homepage or a collection page, find a product link and note its handle (the path segment after `/products/`). Do not assume a handle — discover one from the live dev store.
4. Navigate to `http://localhost:3000/products/<discovered-handle>`. Confirm:
   - HTTP 200 response.
   - Product title, price, and images render.
   - Variant selector appears (if the product has multiple variants) and selecting a variant updates the URL and displayed data.
   - No React hydration warnings in the browser DevTools console.
5. Analytics Contract check: Open React DevTools and confirm `<Analytics.ProductView>` receives a `data` prop where `products[0].variantId` is a non-empty string. If `variantId` is empty or missing, file a new bug report.

---

## Deviations from the plan

None. The fix is exactly as specified: one line inserted into the `PRODUCT_QUERY` operation header in `app/routes/($locale).products.$productHandle.jsx`. No other files were hand-edited.

The plan's step 8 (run `npm run dev`) and step 9 (browser smoke test and Analytics Contract verification) were not performed per the task instructions from the operator ("Do NOT run `npm run dev` — the QA agent will do that").

---

## Base branch / commit

Branch: `main`
Starting commit: `97b9c85` (docs(squad): correct CLAUDE.md to match actual project state)

---

## Out-of-scope observations

1. **Pre-existing lint errors across the codebase.** `npm run lint` reports 73 pre-existing errors (prettier formatting and import ordering) across many files including the modified route file. These are not related to this fix and should be addressed in a separate cleanup task.
2. **`docs/QA-DEBUG-REPORT.md` is stale and contradictory.** As noted in the plan (Section 5), this file recommends removing `$selectedOptions` — the opposite of the correct fix. It should be archived or annotated as superseded in a follow-up cleanup task.
3. **Codegen validation errors are non-fatal.** The original bug shipped because `npm run build` treated the `Variable "$selectedOptions" is not defined` error as a warning rather than a hard failure. A follow-up plan should configure codegen to treat GraphQL document-validation errors as build failures (noted in the plan's Section 8 as a future task).

---

## Round 2 — Duplicate fragment removal (QA-directed fix)

**Date:** 2026-05-18
**QA report:** `docs/qa/fix-codegen-selectedoptions-not-defined-report.md`

### Issue addressed

The QA report (verdict: FAIL) identified a pre-existing bug: `PRODUCT_VARIANT_FRAGMENT` was interpolated twice into the `PRODUCT_QUERY` composed string:

- Line 496 (inside `PRODUCT_FRAGMENT`) — correct, keep
- Line 534 (appended directly to `PRODUCT_QUERY`) — duplicate, remove

The Storefront API rejects query documents with duplicate fragment names (`Fragment name "ProductVariant" must be unique`), causing all product pages to return HTTP 404.

### Exact change

**File:** `app/routes/($locale).products.$productHandle.jsx`

**Before (lines 532–536):**

```js
  ${MEDIA_FRAGMENT}
  ${PRODUCT_FRAGMENT}
  ${PRODUCT_VARIANT_FRAGMENT}

`;
```

**After (lines 532–534):**

```js
  ${MEDIA_FRAGMENT}
  ${PRODUCT_FRAGMENT}
`;
```

One line removed: `  ${PRODUCT_VARIANT_FRAGMENT}` and the blank line that followed it inside the template literal. `PRODUCT_FRAGMENT` already interpolates `PRODUCT_VARIANT_FRAGMENT` at its own line 496, so the fragment definition is still present exactly once in the composed query.

### npm run lint result

73 errors, all pre-existing. No new errors introduced. The modified file (`($locale).products.$productHandle.jsx`) continues to show the same pre-existing prettier/import-order errors it had before — none at or near the changed lines. Lint error count is unchanged from Round 1.

### npm run build result

PASS — clean exit. Both client and SSR bundles built without errors. No GraphQL document validation warnings appear in the build output. Codegen ran as part of the build (`shopify hydrogen build --codegen`) and produced no `Fragment name "ProductVariant" must be unique` error and no `Variable "$selectedOptions" is not defined` error. Build completed in approximately 5 seconds total (2.94s client + 2.21s SSR).

### Codegen warning status

The `$selectedOptions` codegen warning remains absent (fixed in Round 1). The `Fragment name "ProductVariant" must be unique` runtime error is eliminated by this Round 2 removal. No codegen warnings of either type appear in the build output.
