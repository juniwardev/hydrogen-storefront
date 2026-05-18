# Bug: Codegen GraphQL Document Validation fails on $selectedOptions

**Slug:** codegen-selectedoptions-not-defined
**Reported:** 2026-05-18
**Reported by:** Junior Warner (internal observation during npm run dev)
**Severity:** High (codegen produces a validation error on every dev server start; product page route likely broken at runtime)
**Affected scope:** `app/routes/($locale).products.$productHandle.jsx` — Product query operation

## Steps to reproduce

1. `cd ~/Projects/Shopify/hydrogen-storefront`
2. `npm run dev`
3. Observe codegen warning output in terminal

## Expected behavior

Codegen runs cleanly. No GraphQL Document Validation errors. Generated types in `storefrontapi.generated.d.ts` match the queries in the routes.

## Actual behavior

The dev server starts but codegen emits this warning:

    [Codegen] GraphQL Document Validation failed with 1 errors;

    Error 0: Variable "$selectedOptions" is not defined by operation "Product".
    at app/routes/($locale).products.$productHandle.jsx:27:64
    at app/routes/($locale).products.$productHandle.jsx:2:3

## Hypothesis

The `Product` GraphQL operation in the route file references `$selectedOptions` in its body (probably in the `selectedOptions(selectedOptions: $selectedOptions)` field call required by the Hydrogen SEO utility) but doesn't declare `$selectedOptions: [SelectedOptionInput!]!` in the operation's variables list.

The generated types at `storefrontapi.generated.d.ts` (committed as `chore: regenerate storefront API types via codegen`) DO include `selectedOptions` as a required field on `ProductQueryVariables`, so the types are correct — the GraphQL string is missing the variable declaration.

## Suspected files

- `app/routes/($locale).products.$productHandle.jsx` (line 2-3 and line 27 per the codegen error)
- Possibly the `PRODUCT_FRAGMENT` or `PRODUCT_QUERY` constant exported from that file

## Regression risk areas

(To be filled in by the Architect during planning)
