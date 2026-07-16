# Investigation: Assistant renders a "checkout here" CTA with no URL when checkout can't be started

**Investigation slug:** assistant-checkout-null-dangling-cta-investigation  
**Investigated:** 2026-07-15  
**Status:** Root cause identified; ready for fix planning

---

## Root cause

The assistant reply composition in `app/routes/($locale).api.assistant.jsx` (lines 175, 226, 242) unconditionally includes the hardcoded text "checkout here" in the `reply` field, regardless of whether a usable checkout URL exists in the cart object. Meanwhile, the frontend component `app/components/ChatAssistant.jsx` (lines 292–295) renders this reply text unconditionally whenever `reply` is truthy, creating a mismatch: the UI displays "checkout here" as text, but the checkout link (lines 345–354) only renders when `cart.checkoutUrl` is also truthy. When `checkoutUrl` is `null` or `undefined`, the text remains but the link disappears, leaving a dangling, non-clickable call-to-action.

---

## Mechanism

1. **Route response composition** (`app/routes/($locale).api.assistant.jsx:175–196`, :226–245):

   - Line 175: `const reply = 'Added to your assistant cart — checkout here.';` — hardcoded, unconditional.
   - Lines 180–182: If `cart.checkoutUrl` exists, return immediately with that URL.
   - Lines 184–196: If cart has no URL, fall back to `createCheckout()`. After the `fix-create-checkout-soft-error-gap` fix, when `createCheckout` returns a soft-error response, `checkoutResult.checkout` is `null`. Line 195 spreads the cart object with `checkoutUrl: checkout?.checkoutUrl`, which evaluates to `checkoutUrl: undefined` (since `null?.checkoutUrl` yields `undefined`).
   - Result: the response JSON contains `{reply: "...checkout here.", cart: {..., checkoutUrl: undefined}}`.

2. **Frontend reply rendering** (`app/components/ChatAssistant.jsx:275–296`):

   - Line 292–295: Renders the `reply` field unconditionally: `{reply && (<div>{reply}</div>)}`. This renders "Added to your assistant cart — checkout here." as plain text.
   - Line 331–356: Renders the checkout link **only if** `cart.checkoutUrl` is truthy (line 345: `{cart.checkoutUrl && (<a href=...>`).
   - Result: when `checkoutUrl` is `undefined`, the text "checkout here" remains visible but no hyperlink element is rendered, creating a dangling CTA.

3. **State enumeration — paths to dangling CTA**:

   - **Path A (primary):** Cart's `continue_url` is absent → `createCheckout()` returns soft-error (`checkout: null`) → `checkoutUrl` becomes `undefined`. Reply says "checkout here" but link does not render.
   - **Path B (variant):** Cart's `continue_url` is absent → `createCheckout()` returns a checkout object with no `continue_url` field (or `continue_url: null`) → `normalizeCheckout` (line 241 of `mcp-normalize.js`) assigns `checkoutUrl: undefined` → same result.

4. **Stale-cart retry path** (lines 232–245):
   - The retry logic mirrors the primary path. If the retry cart has no `checkoutUrl` and the fallback `createCheckout()` returns null/no-URL, the reply says "Started a new cart and added the item — checkout here." but with no usable `checkoutUrl`. Same dangling state.

---

## Evidence

### Route response composition (dangling URL created here)

**File:** `app/routes/($locale).api.assistant.jsx`

**Primary path (lines 175–196):**

```javascript
const reply = 'Added to your assistant cart — checkout here.';

if (cart.checkoutUrl) {
  return json({reply, cart});
}

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

When `checkout` is `null`, `checkout?.checkoutUrl` evaluates to `undefined`. The response includes `checkoutUrl: undefined` in the cart object. The `reply` field still says "checkout here."

**Stale-cart retry path (lines 232–245):** Identical pattern.

### Frontend CTA rendering (dangling text created here)

**File:** `app/components/ChatAssistant.jsx`

**Reply rendering (lines 292–295):**

```javascript
{
  reply && (
    <div className="max-w-[85%] bg-primary/5 text-primary rounded-2xl rounded-tl-sm px-3 py-2 text-sm">
      {reply}
    </div>
  );
}
```

This renders the `reply` text unconditionally. If the reply is "Added to your assistant cart — checkout here.", that text appears on screen regardless of whether `checkoutUrl` is defined.

**Checkout link rendering (lines 331–356):**

```javascript
{cart && (
  <div className="bg-primary/5 rounded-xl px-3 py-2 text-xs space-y-1">
    {cartReset && (...)}
    <div className="text-primary/70">
      Assistant cart — {cart.lineCount} {cart.lineCount === 1 ? 'item' : 'items'} ·{' '}
      <Money data={cart.totalAmount} />
    </div>
    {cart.checkoutUrl && (
      <a
        href={cart.checkoutUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs font-medium text-primary underline hover:no-underline"
      >
        Go to checkout →
      </a>
    )}
  </div>
)}
```

The `<a>` element is gated on `{cart.checkoutUrl &&` (line 345). When `checkoutUrl` is `undefined`, the entire link is not rendered — but the reply text "checkout here" above it remains visible.

### URL path trace

1. Route line 175: `reply = 'Added to your assistant cart — checkout here.'`
2. Route line 195: `{...cart, checkoutUrl: checkout?.checkoutUrl}` where `checkout` is `null` → `checkoutUrl: undefined`
3. Route line 193: `json({reply, cart: {...}})` — response includes both fields
4. Frontend line 87: `{_id: ++msgIdRef.current, role: 'assistant', ...data}` — spreads response into message object
5. Frontend line 292–295: renders `message.reply` unconditionally
6. Frontend line 345: checks `message.cart.checkoutUrl &&` — condition is false, link does not render

### Dangling CTA states enumerated

| Condition              | cart.checkoutUrl   | checkout from fallback | checkoutUrl in response | Reply text                            | Link rendered? |
| ---------------------- | ------------------ | ---------------------- | ----------------------- | ------------------------------------- | -------------- |
| Normal (cart URL)      | `"https://..."`    | (not called)           | `"https://..."`         | "checkout here"                       | ✓ Yes          |
| **Dangling A**         | `null`/`undefined` | `null`                 | `undefined`             | "checkout here"                       | ✗ No           |
| **Dangling B**         | `null`/`undefined` | `{continue_url: null}` | `undefined`             | "checkout here"                       | ✗ No           |
| **Dangling C** (retry) | `null`/`undefined` | `null`                 | `undefined`             | "Started a new cart... checkout here" | ✗ No           |

---

## Suggested fix approach

**Layer:** Route action (`app/routes/($locale).api.assistant.jsx`).

The fix should gate the "checkout here" reply on the availability of a usable checkout URL, not blindly include it in all add-to-cart scenarios. When no usable URL is available (both cart and checkout fallback return falsy URLs), the reply should degrade gracefully to an error or neutral message.

**Design considerations (for the Architect):**

- **Fix site:** The route action is the natural fix site because it controls what `reply` text is included in the response. The frontend component correctly gates the link on `cart.checkoutUrl`; the bug is in the route providing conflicting data (a reply that promises a checkout link when no URL exists).
- **Options to explore:**
  1. Conditionally set the reply only when `checkout?.checkoutUrl` is truthy; otherwise use a fallback message like "Couldn't start checkout — please try again."
  2. Or: include a separate flag in the response (e.g., `canCheckout: boolean`) and have the frontend use it to decide which reply variant to show.
  3. Ensure the fallback message is user-facing and honest about the failure mode.
- **Verification:** After the fix, verify that when `createCheckout` returns null or a checkout with no URL, the assistant reply does NOT say "checkout here" or does not render a misleading CTA.

---

## Regression risk areas

1. **Healthy checkout path** (`app/routes/($locale).api.assistant.jsx:180–182`): The normal flow where `cart.checkoutUrl` exists should remain untouched. Verify the reply still says "checkout here" and the link renders correctly.

2. **Stale-cart retry path** (`app/routes/($locale).api.assistant.jsx:224–229` and :232–245): The retry logic mirrors the primary path. Ensure any reply fix applies consistently to both the original add and the retry after `cartReset`.

3. **Reply composition in other intents:** Currently only the `'add'` intent produces checkout CTAs. Verify no other intents (e.g., `'search'`) are affected by changes to reply composition.

4. **Frontend rendering** (`app/components/ChatAssistant.jsx:292–295`, :345–354): The component correctly gates the link. Verify that the reply text change (if any) is consistent with link availability in all scenarios.

5. **Test coverage gap:** No existing tests cover the checkout fallback path or the dangling-CTA scenario. The fix should include test coverage for:

   - Reply composition when `cart.checkoutUrl` is falsy and `createCheckout` returns `null`.
   - Reply composition when `cart.checkoutUrl` is falsy and `createCheckout` returns a checkout with no `continue_url`.
   - Stale-cart retry variant of both above.
   - Frontend rendering of non-checkout-link replies (ensure they display gracefully).

6. **Copy/i18n:** If the graceful fallback message is user-facing (likely), verify it is clear and matches the tone of existing error messages. If i18n is in scope, translate the fallback message for all supported locales.

---

End of investigation.
