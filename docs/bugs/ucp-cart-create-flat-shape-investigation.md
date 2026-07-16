# Investigation: `create_cart` success payload is flat, not nested under `.cart`

**Date:** 2026-07-15  
**Investigator:** General agent  
**Status:** Root cause confirmed; regression risk identified

---

## Root cause

**The UCP `create_cart` and `update_cart` success payloads are FLAT at `result.structuredContent`, with cart fields (`id`, `line_items`, `totals`, `continue_url`) at the top level — NOT nested under a `.cart` key.** The code at `app/lib/mcp.server.js` lines 386 and 441 incorrectly assumes a `.cart` key exists, reading `payload.cart ?? null`, which always evaluates to `null` on success because `payload.cart` is `undefined`. This causes the route action to treat every successful cart creation as a failure.

**Empirical proof:** Live probe of `ashford-quantum.myshopify.com` (UCP public, no-auth mode) using `curl`:
- `search_catalog` returned variant GID `gid://shopify/ProductVariant/49985859879160`.
- `create_cart` with that variant succeeded, returning `result.isError: false`.
- The response `result.structuredContent` contained `id: "gid://shopify/Cart/hWNEWlsFaRz4FHHRn5pk61vc?key=..."` (cart ID) **at the top level**, along with `line_items[]`, `currency`, `totals[]`, `continue_url` — all flat.
- **No `result.structuredContent.cart` key existed** — the nested path the code assumes is absent.

**Root-cause location:** `app/lib/mcp.server.js`:
- Line 386 in `createCart()`: `cart: payload.cart ?? null,` — should be `cart: payload ?? null,`
- Line 441 in `updateCart()`: `cart: payload.cart ?? null,` — should be `cart: payload ?? null,`
- Lines 339–343 and 381–384: misleading comments claiming a nested `.cart` key based on "PROBED + Dev MCP" — but that probe was against the old `theme-evolution-os2-hydrogen` store where `create_cart` crashed upstream with `-32603`, so no successful response ever existed to observe; the nested shape was inferred from the Dev MCP schema docs, not live data.

**Contrast with `createCheckout()`:** Lines 505–507 correctly document and handle the flat payload at `structuredContent`, returning `checkout: payload ?? null,`. This is correct and consistent with the live behavior.

---

## Mechanism

1. **Success path:** When `createCart()` calls `callTool()` with the `create_cart` tool, `callTool()` returns `payload = result.structuredContent` (line 252 of `mcp.server.js`). For `create_cart`, this payload is the **flat cart object** with fields like `id`, `line_items`, `totals`, `continue_url`.

2. **Incorrect unwrapping:** `createCart()` at line 386 tries to unwrap `payload.cart`, but that key does not exist. The `?? null` fallback fires, returning `{cart: null, messages: []}`.

3. **Route failure:** The route action at `app/routes/($locale).api.assistant.jsx` line 163 receives `result.cart = null`. The check `if (!cart)` at line 164 treats this as a failure and surfaces a `tool_error` to the user, even though the underlying UCP call succeeded and created a real cart.

4. **Why `normalizeCart()` is never called:** Because `result.cart` is `null`, the route never calls `normalizeCart(result.cart)`, so the incorrect unwrapping logic is not immediately exposed as a TypeError. Instead, it silently fails at the application level, making the bug harder to diagnose.

5. **Same issue in `updateCart()`:** Line 441 has identical logic and is affected the same way. Any call to `updateCart()` will also return `{cart: null, ...}` on success.

---

## Evidence

### Live curl probe (2026-07-15, ashford-quantum.myshopify.com)

**Step 1: `search_catalog` response** (truncated, showing product array):
```json
{
  "result": {
    "isError": false,
    "structuredContent": {
      "products": [
        {
          "id": "gid://shopify/Product/10218830463224",
          "variants": [
            {
              "id": "gid://shopify/ProductVariant/49985859879160",
              "title": "Default Title"
            }
          ]
        }
      ]
    }
  }
}
```
Extracted variant GID: `gid://shopify/ProductVariant/49985859879160`

**Step 2: `create_cart` request** (mirror of the app's request shape):
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "create_cart",
    "arguments": {
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"
        }
      },
      "cart": {
        "line_items": [
          {
            "item": { "id": "gid://shopify/ProductVariant/49985859879160" },
            "quantity": 1
          }
        ]
      }
    }
  }
}
```

**Step 3: `create_cart` response** (key excerpt from `result.structuredContent`):
```json
{
  "result": {
    "isError": false,
    "structuredContent": {
      "id": "gid://shopify/Cart/hWNEWlsFaRz4FHHRn5pk61vc?key=8af3d3c1115a4db555a21ffc90eb194e",
      "line_items": [
        {
          "id": "gid://shopify/CartLine/2ef24b9f-f3ee-4ee3-ad50-9691080cde90?cart=hWNEWlsFaRz4FHHRn5pk61vc",
          "quantity": 1,
          "totals": [...]
        }
      ],
      "currency": "USD",
      "totals": [
        {
          "type": "subtotal",
          "amount": 72995,
          "display_text": "Subtotal"
        },
        {
          "type": "total",
          "amount": 72995,
          "display_text": "Total"
        }
      ],
      "continue_url": "https://ashford-quantum.myshopify.com/cart/c/hWNEWlsFaRz4FHHRn5pk61vc?key=8af3d3c1115a4db555a21ffc90eb194e",
      "messages": []
    }
  }
}
```

**Analysis:** 
- `result.isError = false` → success.
- `result.structuredContent.id` exists at the **top level** → cart is flat.
- `result.structuredContent.cart` does **NOT exist** → the nested path the code assumes is absent.
- The cart object fields (`id`, `line_items`, `currency`, `totals`, `continue_url`) are all direct children of `structuredContent`, exactly as documented in the test fixtures at `app/lib/mcp-normalize.test.js` lines 316–329.

### Code evidence: `callTool()` returns raw `structuredContent`

`app/lib/mcp.server.js`, lines 252–265:
```javascript
let payload = result.structuredContent;
if (!payload) {
  if (Array.isArray(result.content) && result.content[0]?.text) {
    try {
      payload = JSON.parse(result.content[0].text);
    } catch {
      throw new McpError('rpc_error', {...});
    }
  } else {
    throw new McpError('empty_result', {});
  }
}
return payload;  // ← This is the raw structuredContent
```

`callTool()` returns `payload`, which is `result.structuredContent` (or its fallback from `content[0].text`). It does **not** unwrap anything — the payload is exactly what the API returned.

### Test fixture evidence: `normalizeCart()` expects flat input

`app/lib/mcp-normalize.test.js`, lines 316–329:
```javascript
const rawCart = {
  id: 'gid://shopify/Cart/hWNDolz1',
  currency: 'USD',
  line_items: [...],
  totals: [...],
  continue_url: 'https://...',
};
```

The test passes `rawCart` directly to `normalizeCart(rawCart)` at line 332. The `rawCart` is flat — it does not have a `.cart` wrapper. This matches the live probe data exactly.

### `createCheckout()` comparison: gets it right

`app/lib/mcp.server.js`, lines 505–510:
```javascript
const payload = await callTool(callOpts);
// Success: checkout fields are FLAT at structuredContent (id, status,
// messages, continue_url, totals[], line_items[]) — unlike the cart tools,
// which nest under a .cart key. There is no .checkout wrapper to unwrap.
return {
  checkout: payload ?? null,
  messages: payload?.messages ?? [],
};
```

The comment **incorrectly states** "unlike the cart tools, which nest under a .cart key" — but that's the bug. The cart tools also return flat payloads. However, `createCheckout()` **correctly returns `checkout: payload ?? null`** (unwrapping the entire payload, not a `.checkout` sub-key). This is the model `createCart()` and `updateCart()` should follow.

### Zero test coverage for `createCart()` and `updateCart()`

`app/lib/mcp.server.test.js`: The test file contains comprehensive tests for `callTool()` (envelope parsing, rate limits, auth modes) but **no tests for `createCart()` or `updateCart()`**. This gap allowed the incorrect `.cart` unwrapping logic to ship without being caught.

---

## Suggested fix approach

### High-level strategy

1. **Fix the response-shape assumption in `createCart()`** (`app/lib/mcp.server.js`, line 386):
   - Change `cart: payload.cart ?? null,` to `cart: payload ?? null,`
   - The entire `payload` IS the cart object; there is no `.cart` sub-key to unwrap.

2. **Fix the identical logic in `updateCart()`** (`app/lib/mcp.server.js`, line 441):
   - Same change: `cart: payload.cart ?? null,` → `cart: payload ?? null,`

3. **Correct the misleading comments** at lines 339–343 and 381–384:
   - Remove the claim that cart is "nested at `structuredContent.cart`".
   - Clarify that the cart object is flat, matching `search_catalog` and `create_checkout`.
   - Note that the old comment was based on an inference from Dev MCP docs, not live observation (the old store crashed before a successful response was possible).

4. **Add unit tests for `createCart()` and `updateCart()`** to `app/lib/mcp.server.test.js`:
   - Verify that a successful `create_cart` response (flat cart payload) returns `{cart: flatCartObject, messages: []}` — not `{cart: null, ...}`.
   - Verify that `update_cart` behaves identically.
   - Add error-path tests (tool_error with invalid_cart_id) to ensure `messages[]` is correctly surfaced.
   - This closes the test-coverage gap and prevents regression.

5. **Verify the route's normalization call remains correct**:
   - The route at line 163 calls `normalizeCart(result.cart)`, which will now receive the flat cart object (not `null`), and `normalizeCart()` expects a flat input — this is correct.
   - No change needed to the route action itself.

### Why this approach is correct

- The fix aligns `createCart()` and `updateCart()` with `createCheckout()`, which already handles flat payloads correctly.
- The normalized test fixtures in `mcp-normalize.test.js` expect flat cart objects, confirming the payload shape.
- The live probe is definitive: the API returns flat carts.
- Adding test coverage prevents this regression from reoccurring.

---

## Regression risk areas

1. **`updateCart()` path** (`app/lib/mcp.server.js`, lines 412–444):
   - Currently broken the same way as `createCart()`.
   - The route action calls `updateCart()` at line 156 when a `cartId` is present.
   - Any prior code relying on `result.cart` from `updateCart()` is already receiving `null` and silently failing. The fix will surface real cart objects instead of `null`, which is correct but could expose other bugs if downstream code doesn't handle cart objects properly.
   - **Mitigation:** The route action's usage at line 163 (`normalizeCart(result.cart)`) is already correct for flat payloads.

2. **`createCheckout()` edge cases** (`app/lib/mcp.server.js`, lines 477–512):
   - The comment at lines 505–507 claims cart tools are nested while checkout is flat — this is now proven wrong.
   - If any other code incorrectly assumes cart nesting, fixing `createCart()` might expose those assumptions.
   - The route action's usage at line 189 (`normalizeCheckout(checkoutResult.checkout)`) is already correct.

3. **Test-coverage gap** (`app/lib/mcp.server.test.js`):
   - `createCart()` and `updateCart()` have **zero unit tests**.
   - This gap allowed the bug to ship. The fix must include tests to prevent recurrence.

4. **Stale-cart retry logic** (`app/routes/($locale).api.assistant.jsx`, lines 197–249):
   - On cart_id errors (invalid/stale cart), the route clears the cartId and retries with `createCart()`.
   - Currently, the retry always returns `{cart: null, ...}`, so it also surfaces an error (double failure).
   - Once the fix is in place, the retry will correctly return a fresh cart, and the `cartReset: true` flag will work as designed.

5. **`messages[]` handling**:
   - Both `createCart()` and `updateCart()` return `messages: payload.messages ?? []`.
   - The route's error check at line 164 (`if (!cart)`) assumes the absence of a cart means an error, but business errors also include `messages[]`.
   - Currently, business errors throw a `tool_error` exception (caught at line 197), so `messages[]` from the successful path is not inspected.
   - After the fix, `messages[]` on success might include warnings — the route should verify this behavior is correct.

6. **No `.messages` key at root level** (potential follow-up concern):
   - The current code at line 387 returns `messages: payload.messages ?? []`.
   - Per the live probe, the cart response has `messages: []` at the top level (part of the flat payload).
   - This is correct; no change needed here.

---

## Conclusion

The bug is definitively a shape mismatch: the code assumes cart objects are nested under a `.cart` key at `structuredContent.cart`, but the live API returns them flat at `structuredContent` directly. The fix is straightforward — unwrap the entire `payload` instead of trying to access a non-existent `.cart` sub-key — but must be accompanied by unit tests to prevent regression.

The misleading comments in the original code arose because the assumption was based on Dev MCP schema documentation, not live observation (the old dev store crashed before a successful response could be captured). This investigation confirms the correct behavior via live probe and resolves the contradiction in favor of the flat shape, aligning with both the live API and the existing test fixtures in `mcp-normalize.test.js`.
