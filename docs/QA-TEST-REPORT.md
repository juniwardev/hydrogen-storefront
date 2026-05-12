# QA Test Report - Hydrogen Storefront

**Date:** Sun May 10 2026
**Environment:** Local Development (http://localhost:3000/)
**Status:** ❌ FAIL

## Summary
The storefront is currently experiencing a critical failure on the Homepage, resulting in a server-side 500 error during SSR. This is caused by a type mismatch in the `Hero` component where the Hydrogen `<MediaFile />` component is being passed an `Image` object from the Storefront API, which it does not support.

---

## 1. Homepage Pass/Fail
**Status:** ❌ **FAIL**

### Findings:
- **Server-Side Error:** ❌ **Fail**. The homepage returns a `500 Internal Server Error` on initial load.
- **Root Cause:** The `Hero` component uses the `<MediaFile />` component to render the collection image. However, the GraphQL query `seoCollectionContent` fetches the `Collection.image` field, which returns an object of type `Image`. The `<MediaFile />` component from `@shopify/hydrogen` expects a member of the `Media` union (e.g., `MediaImage`, `Video`, `ExternalVideo`), and it specifically requires a `__typename` that matches one of these types. When it receives `__typename: "Image"`, it throws a runtime error.
- **Console Errors:** None (the error occurs on the server, and the browser displays the `GenericError` page).
- **Network Tab (GraphQL):**
  - Query: `heroCollectionContent` for handle `frontpage`.
  - Response: Returns a valid `Collection` object with an `image` node.
  - Payload Inspection: `image: { "__typename": "Image", "url": "...", ... }`.
  - Verification: The `__typename` is correctly returned by the API but is unsupported by the client-side component implementation in `Hero.jsx`.

### Stack Trace:
```text
Error: <MediaFile /> requires the '__typename' property to exist on the 'data' prop in order to render the matching sub-component for this type of media.
    at MediaFile (/Users/juniorwarner/Projects/Shopify/hydrogen-storefront/node_modules/@shopify/hydrogen-react/dist/browser-dev/MediaFile.mjs:90:15)
    at Hero (/Users/juniorwarner/Projects/Shopify/hydrogen-storefront/app/components/Hero.jsx:65:5)
    at Homepage (/Users/juniorwarner/Projects/Shopify/hydrogen-storefront/app/routes/($locale)._index.jsx:165:9)
```

---

## 2. Product Detail Page (PDP) Pass/Fail
**Status:** ❌ **FAIL**

### Findings:
- **Product Form:** ❌ **Fail**. Still failing due to missing mandatory GraphQL fields for the `getProductOptions` hook.
- **Console Errors:**
  - `[h2:error:getProductOptions] product.adjacentVariants.product.handle is missing.`

---

## 3. Technical Inspection

### Data Contract Audit
- **Collection Image vs Media:** The `COLLECTION_CONTENT_FRAGMENT` in `app/routes/($locale)._index.jsx` incorrectly assumes that `Collection.image` can be passed directly to `<MediaFile />`. 
- **Type Mismatch:** `Image` (from Storefront API) is a distinct type and not part of the `Media` union. `MediaImage` (which is part of the union) contains an `image` field of type `Image`.

### Network Verification
- All hero-related GraphQL queries are successfully returning data from the Storefront API.
- The failure is strictly in the **React Component Implementation** logic within `Hero.jsx`.

---

## 4. Recommendations
1. **Fix `Hero.jsx` Component:** Update the `SpreadMedia` function in `app/components/Hero.jsx` to handle the `Image` type. Use the Hydrogen `<Image />` component for static images and reserve `<MediaFile />` for video or 3D media types.
2. **Update Index Route Query:** If the intention was to support Video or 3D models in the Hero, the GraphQL query must be updated to fetch media from a metafield that supports the `Media` union, rather than the standard `Collection.image`.
3. **Add missing fields to Product Query:** Add `adjacentVariants { product { handle } }` to the product fragments to resolve the PDP errors.
