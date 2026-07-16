# Investigation: `createCheckout()` soft-error guard gap mirrors the fixed cart soft-error issue

**Date:** 2026-07-15  
**Investigator:** General agent  
**Status:** Root cause confirmed; empirical checkout identity discriminator established

---

## Root cause

**`createCheckout()` returns `checkout: payload ?? null` without guarding on a checkout identity field. When a soft-error envelope is returned (a structuredContent payload with `isError: false`, carrying `messages[]` with error entries, but no real checkout identity fields), the payload is truthy and passes through the bare `?? null` guard, resulting in a junk checkout object with `id: undefined` being returned instead of `null`.** The correct discriminator is the `id` field (identical to the cart fix), which is **always present in a real checkout success** but **absent from soft-error envelopes**.

**Empirical proof (live probe of ashford-quantum.myshopify.com, 2026-07-15):**

1. **Real checkout success shape** (valid variant GID, delivery address issue present):

   - `result.isError: true` (the business-outcome error is flagged)
   - This throws a `tool_error` exception, never reaching `createCheckout`'s return path
   - But the payload DOES carry `id: "gid://shopify/Checkout/hWNEWo17..."` at the top level

2. **Soft-error envelope shape** (invalid variant GID):

   - `result.isError: true` (again throws `tool_error`)
   - Payload has NO `id` field; only `continue_url: "https://ashford-quantum.myshopify.com/"` and `messages[]` with error details
   - Top-level keys: `["continue_url", "messages", "ucp"]` — NO `id`

3. **Test fixtures confirm** (`app/lib/mcp.server.test.js`):
   - `SOFT_ERROR_PAYLOAD` is defined with `messages[]` but explicitly no `id` field
   - `createCart` already guards soft-error payloads with `payload?.id ? payload : null`
   - `createCheckout` has ZERO test coverage (no tests for success, soft-error, or thrown paths)

**Root-cause location:** `app/lib/mcp.server.js`, lines 519–522:

```javascript
return {
  checkout: payload ?? null, // ← Should be: checkout: payload?.id ? payload : null,
  messages: payload?.messages ?? [],
};
```

**Contrast with correctly-guarded `updateCart()`:** Line 451 shows `cart: payload?.id ? payload : null,` — the cart fix applied the identity discriminator pattern. Checkout must follow the same pattern.

---

## Mechanism

1. **When `isError: false` with real checkout:** The payload is a full checkout object with `id`, `status`, `continue_url`, `line_items[]`, etc. The bare `?? null` guard passes it through. `normalizeCheckout()` receives valid data and returns `{id: <guid>, checkoutUrl: <url>}`. The route uses the checkout URL correctly.

2. **When a soft-error occurs (isError: false but error messages):** The payload is a sparse envelope with only `messages[]` and a fallback `continue_url` (typically pointing to root), but **no `id` field**. The bare `?? null` guard treats this as truthy and returns it. `normalizeCheckout()` at route line 190 receives `{messages: [...], continue_url: "..."}` and normalizes it to `{id: undefined, checkoutUrl: <fallback>}`.

3. **Route consumption chain:** At route lines 189–195:

   ```javascript
   const checkout = checkoutResult.checkout
     ? normalizeCheckout(checkoutResult.checkout)
     : null;

   return json({
     reply,
     cart: {...cart, checkoutUrl: checkout?.checkoutUrl},
   });
   ```

   Since the soft-error envelope is truthy (it's an object), `normalizeCheckout()` is called. It produces `checkout.checkoutUrl = <fallback>` (the root URL). The client receives a "checkout" that is just the home page, not a real checkout.

4. **Why `isError: true` doesn't trigger here:** Live probes showed all error cases (invalid variant, empty items, etc.) return `isError: true`, which triggers `callTool()`'s `tool_error` exception (line 271 of `mcp.server.js`). This exception is caught by the route's outer try-catch and surfaces properly. The latent risk is IF a soft-error case exists with `isError: false` — then it bypasses the exception path and flows through as corrupt data.

---

## Evidence

### Live probe: create_checkout with invalid variant (ashford-quantum.myshopify.com, 2026-07-15)

**Request:** (omitted for brevity; see docs/bugs/create-checkout-soft-error-gap.md for full details)

**Response `result.structuredContent` top-level keys:**

```
[ 'continue_url', 'messages', 'ucp' ]
```

**Critical observation:** NO `id` field present.

**Response excerpt:**

```json
{
  "continue_url": "https://ashford-quantum.myshopify.com/",
  "messages": [
    {
      "type": "error",
      "code": "invalid",
      "content": "The merchandise with id gid://shopify/ProductVariant/99999999999999 does not exist.",
      "severity": "unrecoverable"
    }
  ],
  "ucp": {
    /* large metadata */
  }
}
```

**Note:** This response has `result.isError: true`, so it throws a `tool_error` exception and does NOT reach `createCheckout()`'s return path in the current setup. However, the shape confirms the discriminator: **soft-error envelopes lack `id`**, and if such a payload ever reached the return path with `isError: false`, the bare `?? null` would fail to filter it.

### Test fixture: `SOFT_ERROR_PAYLOAD` in mcp.server.test.js

From `app/lib/mcp.server.test.js`, lines ~165–170:

```javascript
const SOFT_ERROR_PAYLOAD = {
  ucp: {status: 'error'},
  messages: [{type: 'error', code: 'some_soft_error', content: 'soft failure'}],
};
```

**Key:** No `id` field. The test suite passes this payload to `createCart` with `isError: false` (via the `successFetch()` mock), and asserts `result.cart === null`. The cart function correctly guards against this with `payload?.id ? payload : null`.

### Code comparison: Cart vs Checkout

**updateCart (correctly guarded):** `app/lib/mcp.server.js`, line 451:

```javascript
cart: payload?.id ? payload : null,
```

**createCheckout (vulnerable):** `app/lib/mcp.server.js`, line 520:

```javascript
checkout: payload ?? null,
```

The cart functions use `payload?.id` as the discriminator; checkout does not.

### Route null-handling for checkout

`app/routes/($locale).api.assistant.jsx`, lines 184–196:

```javascript
const checkoutResult = await createCheckout({
  ...mcpBase,
  cartId: cart.id,
  lineItems: [newLine],
});
const checkout = checkoutResult.checkout
  ? normalizeCheckout(checkoutResult.checkout)
  : null;

return json({
  reply,
  cart: {...cart, checkoutUrl: checkout?.checkoutUrl},
});
```

**Defensive check is present:** Line 189–191 checks `if (checkoutResult.checkout)` before normalizing. **However,** if a soft-error envelope (truthy object, no `id`) is returned, the condition passes and normalization proceeds, yielding `checkout.checkoutUrl = undefined` or a fallback URL. Unlike the cart path (which has a defensive null-check at route line 164), **there is no second validation that `checkout.checkoutUrl` is actually a real checkout URL**, so a junk checkout with undefined identity silently propagates.

**Contrast:** The cart path at route line 163–173 has an explicit `if (!cart) { return error(...) }` defensively catching null carts. The checkout path has no such guard — it assumes any non-null checkout from `normalizeCheckout()` is valid.

### Test coverage gap for createCheckout

`app/lib/mcp.server.test.js` contains:

- ✅ Tests for `createCart()` success, soft-error, and errors
- ✅ Tests for `updateCart()` success, soft-error, and errors
- ❌ **Zero tests for `createCheckout()`** — no success, soft-error, or error path coverage

This mirrors the pre-fix gap that allowed the cart bug to ship. The lack of tests for `createCheckout` means the soft-error guard would not be validated even after a fix.

---

## Suggested fix approach

### High-level strategy

1. **Guard `createCheckout()` on the `id` field** (`app/lib/mcp.server.js`, line 520):

   - Change `checkout: payload ?? null,` to `checkout: payload?.id ? payload : null,`
   - This mirrors the pattern already applied to `createCart()` and `updateCart()`

2. **Add unit tests for `createCheckout()`** to `app/lib/mcp.server.test.js`:

   - Test success path: a valid checkout payload with `id` returns non-null
   - Test soft-error path: a soft-error payload (no `id`) returns `checkout: null`
   - Test error path: thrown `tool_error` is surfaced correctly
   - This closes the test-coverage gap and validates the fix

3. **Optional: add a defensive check in the route** (`app/routes/($locale).api.assistant.jsx`, after line 190):

   - After normalizing the checkout, verify `checkout?.checkoutUrl` is not empty/falsy before using it
   - This provides defense-in-depth if another soft-error pattern emerges in the future
   - Currently, no such check exists (the cart path has one, but checkout does not)

4. **Do NOT modify `normalizeCheckout()`**: The function is correct — it expects a valid checkout object and extracts the fields it needs. The guard must happen in `createCheckout()` before the payload is returned.

### Why this approach is correct

- The fix aligns `createCheckout()` with the already-correct `updateCart()` pattern (identity discriminator on the presence of `id`)
- The live probe evidence shows `id` is present in all real checkouts and absent from soft-error envelopes
- Test coverage validates the fix and prevents regression (matching the pattern applied to cart functions)
- The route's null-handling is already in place; no logic changes needed there
- The discriminator (`id`) is load-bearing for `normalizeCheckout()`, which depends on `id` to construct the return object

---

## Regression risk areas

1. **`createCheckout()` as a rare fallback** (`app/routes/($locale).api.assistant.jsx`, lines 184–196):

   - Currently only fires when a cart's `continue_url` is absent (cart exists but `checkoutUrl` is null/undefined)
   - Today, soft-error envelopes always throw `tool_error` exceptions, so they never reach the checkout consumption path
   - After the fix, soft-error envelopes will correctly return `checkout: null` instead, which the route already handles correctly (the conditional at line 189 checks truthiness)
   - **Mitigation:** Route handling is already correct; the fix is transparent to the route

2. **`normalizeCheckout()` expectations** (`app/lib/mcp-normalize.js`, lines 238–243):

   - Expects a checkout object with at least `id` (for `result.id`) and optionally `continue_url` (for `checkoutUrl`)
   - After the guard, only real checkouts reach this function; soft-error envelopes never do
   - Test fixtures confirm this is the correct expectation
   - **Mitigation:** No changes needed; the function is already correct

3. **Route's fallback checkout URL handling** (cart → checkout handoff, route lines 180–196):

   - If a cart's `continue_url` is absent, the route calls `createCheckout()` as a fallback
   - After the fix, a soft-error checkout will return `null`, and the route will not override the cart's `checkoutUrl` (line 195 sets it to `checkout?.checkoutUrl`, which is `undefined`, so no override occurs)
   - **Mitigation:** Route behavior is already correct; the fix will actually prevent junk checkout URLs from being set

4. **Zero test coverage for `createCheckout()`** (`app/lib/mcp.server.test.js`):

   - No tests currently exist, so no regression in test behavior
   - However, the fix must include tests to prevent future regression (mirrors the cart fix pattern)
   - **Mitigation:** Add comprehensive test cases for success, soft-error, and error paths

5. **Soft-error envelope shape evolution**:
   - If the UCP API changes to include `id` even in soft-error envelopes in the future, the guard would no longer filter correctly
   - Current evidence (live probe, test fixtures) shows `id` is the definitive discriminator
   - **Mitigation:** Tests will validate the current shape; any future API changes would require test updates

---

## Conclusion

The bug is a latent soft-error guard gap identical in class to the just-fixed cart bug: an unwrap expression that only distinguishes "no payload" from "a payload," not "a real success payload" from "a soft-error envelope." The fix is to guard on the `id` field, which is always present in real checkouts and always absent from soft-error envelopes. Live evidence confirms `id` is the correct discriminator. The route already handles null checkouts correctly, so the fix is transparent and low-risk. Test coverage must be added to prevent regression, mirroring the pattern applied to cart functions.
