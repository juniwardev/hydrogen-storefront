# Fix Plan: `createCheckout()` soft-error guard gap (`checkout: payload ?? null`)

**Slug:** `fix-create-checkout-soft-error-gap`
**Type:** Bug fix (root-cause plan)
**Author:** Architect
**Date:** 2026-07-15
**Bug report:** `docs/bugs/create-checkout-soft-error-gap.md`
**Investigation (root-cause source):** `docs/bugs/create-checkout-soft-error-gap-investigation.md`
**Sibling fix (same defect class, mirror its structure):** `docs/plans/fix-ucp-cart-create-flat-shape.md`
**Severity:** Low — latent; `createCheckout` is a rare fallback and no live soft-error has been observed for checkout. Fixed for correctness + parity with the just-fixed cart tools.

---

## 1. Root cause statement

Per the investigation (`docs/bugs/create-checkout-soft-error-gap-investigation.md`, "Root cause" and "Mechanism"), `createCheckout()` returns `checkout: payload ?? null` (`app/lib/mcp.server.js:520`) without guarding on a checkout identity field.

`callTool()` throws `McpError('empty_result')` on any falsy payload (`mcp.server.js:246–248`, `:262–264`) and throws `McpError('tool_error')` whenever `result.isError === true` (`:267–271`). Therefore, on `createCheckout`'s **return path**, `payload` is **always a truthy object** — either a real checkout OR a non-thrown soft-error envelope (`isError:false`, carrying `messages[]` with `type:"error"` entries and **no** real checkout identity fields). The bare `?? null` distinguishes only "no payload" from "a payload"; it can never yield `null` for a truthy soft-error envelope. So a soft-error envelope is returned as a truthy "junk" checkout with `id: undefined`, which flows into `normalizeCheckout()` (`mcp-normalize.js:238–243`) and the route's checkout-URL handoff (`($locale).api.assistant.jsx:189–195`) as if a real checkout had been created.

**Empirical discriminator (investigation, live probe of `ashford-quantum.myshopify.com`, 2026-07-15):** a real checkout success payload always carries a top-level `id` (`structuredContent.id`, e.g. `gid://shopify/Checkout/hWNEWo17...`); the soft-error envelope's top-level keys are exactly `["continue_url", "messages", "ucp"]` — **no `id`**. So `id` is the correct identity discriminator, identical to the cart fix.

**Distinction from the cart bug (keep precise):** the cart bug (`fix-ucp-cart-create-flat-shape`) had **two** defects — a nesting mismatch (`payload.cart` vs the flat payload) **and** a missing soft-error guard. Checkout is **already correctly flat** — `callTool` returns the raw `structuredContent` and `createCheckout` already unwraps the whole payload (not `payload.checkout`). So this fix is **only** the soft-error guard gap. Nothing about nesting changes.

---

## 2. Goals

- A soft-error `create_checkout` response (non-thrown, `isError:false`, no `id`) must yield `checkout: null`, so the route's downstream `if (checkoutResult.checkout)` branch does not proceed as if a real checkout were created.
- Bring `createCheckout` to parity with the already-fixed `createCart` / `updateCart` identity-discriminator guard (`payload?.id ? payload : null`).
- Close the **zero-coverage** gap on `createCheckout()` with unit tests, one of which fails against the current code and passes after the fix (pins the bug).

## 3. Non-goals

- No change to `createCart` / `updateCart` — already fixed in `fix-ucp-cart-create-flat-shape` (`mcp.server.js:450–453` etc.).
- No change to the route (`($locale).api.assistant.jsx`) — the investigation confirms its `if (checkoutResult.checkout)` gate (`:189–191`) makes `checkout: null` safe. The investigation's optional "defense-in-depth" route guard (its "Suggested fix approach" item 3) is **explicitly out of scope** for this minimum-surface fix (see AL-3).
- No change to `normalizeCheckout()` — it is correct; after the guard only real checkouts (with `id`) reach it.
- No nesting change — checkout is already flat.
- No `.tsx` conversion, no dependency changes, no drive-by cleanups.

---

## 4. The exact change

### 4.1 `app/lib/mcp.server.js` — `createCheckout()` return (`~519–522`)

**Before:**
```js
  const payload = await callTool(callOpts);
  // Success: checkout fields are FLAT at structuredContent (id, status,
  // messages, continue_url, totals[], line_items[]) — the same flat shape as
  // the cart tools (create_cart / update_cart) and search_catalog. There is no
  // .checkout wrapper to unwrap.
  return {
    checkout: payload ?? null,
    messages: payload?.messages ?? [],
  };
```

**After:**
```js
  const payload = await callTool(callOpts);
  // Success: checkout fields are FLAT at structuredContent (id, status,
  // messages, continue_url, totals[], line_items[]) — the same flat shape as
  // the cart tools (create_cart / update_cart) and search_catalog. There is no
  // .checkout wrapper to unwrap. Guard on the checkout's identifying `id` so a
  // NON-thrown soft business-outcome payload (isError:false with error
  // messages[] and no checkout fields — top-level keys continue_url/messages/
  // ucp, no id, PROBED live) yields checkout:null instead of a junk checkout,
  // mirroring createCart/updateCart's identity guard.
  return {
    checkout: payload?.id ? payload : null,
    messages: payload?.messages ?? [],
  };
```

**Justification of the discriminator (`id`):** the investigation's live capture shows a real checkout always carries top-level `id`; the soft-error envelope's top-level keys are exactly `["continue_url", "messages", "ucp"]` with no `id`. `normalizeCheckout()` itself depends on `rawCheckout.id` (`mcp-normalize.js:240`), so `id` is the load-bearing identity field — the correct thing to guard on.

### 4.2 The exact edited expression

- **Only** line 520 changes: `checkout: payload ?? null,` → `checkout: payload?.id ? payload : null,`
- The inline comment above the `return` is expanded to state the soft-error guard rationale (§4.1), mirroring `updateCart`'s comment (`mcp.server.js:447–449`).

### 4.3 `messages` — NO change (confirmed against the actual current return)

`createCheckout` **already** returns `messages: payload?.messages ?? []` (`mcp.server.js:521`), which is exactly the optional-chained form the cart functions use. Unlike the cart fix (which had to change `payload.messages` → `payload?.messages`), checkout already has the correct, null-safe `messages` path. **No `messages` change is needed** (see AL-1).

### 4.4 JSDoc / comment accuracy

The pre-fix inline comment (`:515–518`) is **accurate** about the flat shape and does **not** misdescribe soft-error behavior — it simply says nothing about the guard. It is therefore not "inaccurate" today; the change in §4.1 **augments** it with the soft-error guard rationale for parity with the cart comments rather than correcting an error. The `createCheckout` JSDoc block (`:456–485`) describes argument/schema semantics only (no response-shape claim) and needs **no** change.

---

## 5. Affected files and modules

| File | Change |
| --- | --- |
| `app/lib/mcp.server.js` | One-line guard change + augmented inline comment in `createCheckout()` (§4.1). |
| `app/lib/mcp.server.test.js` | Add `createCheckout` to the existing import (`:28`); append a new `describe` block with the checkout cases (§7). |

No other files change. Explicitly **not** touched: `($locale).api.assistant.jsx`, `mcp-normalize.js`, `createCart`/`updateCart`.

---

## 6. Data model and API changes

None. No GraphQL fragments/queries change, so **no codegen regeneration is triggered** (`storefrontapi.generated.d.ts` untouched). The `createCheckout` return shape is unchanged (`{checkout: object|null, messages: object[]}`); only which value populates `checkout` on the non-thrown soft-error path changes (junk truthy object → `null`). The real-checkout path is byte-for-byte identical (`payload?.id` is truthy → returns `payload`).

---

## 7. Test plan (mandatory — currently ZERO coverage on `createCheckout`)

Add a new `describe` block to the **existing** `app/lib/mcp.server.test.js` (do not create a new file — the harness `plainFetch`, `withPasswordShim`, `BASE_OPTS`, `UCP_AUTH_MODES`, and `__resetForTests()` already live there). Add `createCheckout` to the existing import on line 28:

```js
import {callTool, createCart, updateCart, createCheckout, McpError} from './mcp.server.js';
```

The existing `successFetch()` helper is scoped **inside** the cart `describe` block (`:742–754`) and is not visible to a new block. Mirror the cart block by defining a local `successFetch` (or reuse `plainFetch` directly) inside the new checkout block. Each mocked response wraps a fixture as `{jsonrpc:'2.0', id:1, result:{structuredContent: <fixture>, isError:false}}` with 200 + `Content-Type: application/json`, served via `plainFetch` with `authMode: UCP_AUTH_MODES.NONE` and `password: undefined` (matching the cart cases at `:756–826`). Call `__resetForTests()` at the top of each test.

Fixtures (mirror the investigation's live-captured shapes):

```js
// Real checkout success — flat, carries top-level id (the discriminator).
const FLAT_CHECKOUT_PAYLOAD = {
  id: 'gid://shopify/Checkout/hWNEWo17abc',
  status: 'open',
  line_items: [{id: 'gid://shopify/CheckoutLine/1', quantity: 1}],
  totals: [{type: 'total', amount: 72995, display_text: 'Total'}],
  continue_url:
    'https://ashford-quantum.myshopify.com/checkout/c/hWNEWo17abc',
  messages: [],
};

// Soft-error envelope — isError:false, NO id; top-level keys continue_url/
// messages/ucp exactly as PROBED live (investigation "Evidence").
const SOFT_ERROR_CHECKOUT_PAYLOAD = {
  continue_url: 'https://ashford-quantum.myshopify.com/',
  messages: [
    {
      type: 'error',
      code: 'invalid',
      content:
        'The merchandise with id gid://shopify/ProductVariant/99999999999999 does not exist.',
      severity: 'unrecoverable',
    },
  ],
  ucp: {status: 'error'},
};
```

Required cases (mirroring the cart fix's 2-case pattern):

| # | Fixture (isError) | Assertion | Current code | After fix |
| - | ----------------- | --------- | ------------ | --------- |
| 1 | `FLAT_CHECKOUT_PAYLOAD` (false) | `result.checkout` non-null; `result.checkout.id === FLAT_CHECKOUT_PAYLOAD.id`; `result.checkout.continue_url` present; `result.messages` deep-equals `[]` | **PASSES** (already flat) | PASSES |
| 2 | `SOFT_ERROR_CHECKOUT_PAYLOAD` (false) | `result.checkout === null`; `result.messages` deep-equals the error `messages[]` | **FAILS** (`payload ?? null` returns the truthy envelope) — **pins the bug** | **PASSES** |

**Which case pins the bug:** because checkout was already flat, **case 1 (success) passes even pre-fix** — it is a regression/contract guard, not the pin. **Case 2 is the bug-pinning case:** against the current `checkout: payload ?? null` it returns the soft-error envelope as a truthy object (so `assert.equal(result.checkout, null)` **fails**); after the `payload?.id ? payload : null` guard it returns `null` (**passes**). The Coder must run `npm run test:unit` **before** applying §4.1 to confirm case 2 genuinely fails, then apply the fix and confirm all green — this is the fails-before / passes-after proof.

Optional (recommended, not required): a case asserting `createCheckout` **rejects** with `McpError('tool_error')` when the mocked `result.isError === true`, documenting that hard business errors throw rather than return `null` (matches the existing `callTool` `tool_error` test at `:164–194`). This clarifies the two error paths but does not pin the bug.

No changes to `mcp-normalize.test.js` are required.

---

## 8. Regression risk areas

Feeds QA's regression matrix.

1. **Route checkout fallback path (`($locale).api.assistant.jsx:189–195`) — null is already safe.** The plan relies on the investigation's finding that `const checkout = checkoutResult.checkout ? normalizeCheckout(...) : null;` gates on truthiness, so returning `checkout: null` is handled with no route change. Regression check: confirm the route still behaves — when `checkout` is `null`, `cart.checkoutUrl` is set to `checkout?.checkoutUrl` (`undefined`), so no junk override occurs. **The fix does NOT change the real-checkout path** (`payload?.id` truthy → returns `payload` unchanged), so the common case is byte-identical.

2. **`normalizeCheckout()` (`mcp-normalize.js:238–243`) — guarded payload is still the right shape when non-null.** It reads `rawCheckout.id` and `rawCheckout.continue_url`. After the guard, only payloads with a truthy `id` reach it (real checkouts), which is exactly what it expects. No change needed; risk is only that it now never receives an `id`-less junk object. Regression check: `npm run test:unit` (any existing normalize suite stays green — normalize is untouched).

3. **`continue_url` handoff.** For a real checkout, `continue_url` is present and unchanged by the fix. For a soft-error envelope, the old code produced `checkoutUrl = <fallback root URL>` (a bogus "checkout" that is just the home page); after the fix that path yields `checkout: null` so no bogus URL is surfaced. This is a strict improvement, not a regression — verify no consumer relied on the bogus fallback (none does; the route only reads `checkout?.checkoutUrl`).

4. **Interaction with the cart path — checkout is a fallback only.** `createCheckout` fires only when `cart.checkoutUrl` is absent (`route :180–184`). The common path (cart `continue_url` present) never calls `createCheckout`, so most sessions are unaffected. Regression check: confirm the normal add-to-cart path (checkoutUrl present → `return json({reply, cart})` at `:181`) is untouched.

5. **Zero-test-coverage gap (`mcp.server.test.js`).** No `createCheckout` tests exist today, so there is no test-behavior regression; the new cases (§7) close the gap and lock the guard. Any future UCP shape change that starts emitting `id` in soft-error envelopes would silently defeat the guard — the tests document the current contract so such a change would need a deliberate test update.

---

## 9. Verification steps

Run in order; all must pass before the fix is declared done:

1. `npm run lint` — clean (ESLint over `.js/.jsx`).
2. `npm run build` — completes without errors. This is the project's type-check + production-build gate (codegen bundled via `--codegen`; there is no separate `typecheck` script). No GraphQL changed, so generated types are identical.
3. `npm run test:unit` — all green, including the new checkout cases (§7). **Prove the pin:** run once **before** applying §4.1 and confirm case 2 (soft-error → `checkout: null`) **fails** against `payload ?? null`; then apply the guard and confirm it **passes** and all other tests stay green.
4. **Live re-verification (note the reality).** `createCheckout` is a rare fallback (fires only when a cart's `continue_url` is absent), and the investigation found that all observed error cases come back with `isError:true` (which throws `tool_error` and never reaches the return path) — so **a live `isError:false` soft-error for checkout is hard to force** and may not be reproducible on demand. Accordingly, **the unit test (case 2) is the primary guard.** For QA: (a) confirm the real-checkout path still works by exercising a normal add-to-cart that hits the checkout fallback (if reproducible) and verifying a real checkout URL is surfaced; (b) treat the soft-error → `null` behavior as verified by the unit test rather than a live repro. Document in the QA report that the soft-error path is unit-guarded, not live-reproduced.
5. Baseline smoke (CLAUDE.md "Verification"): `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000` → 200; no React hydration warnings in the console.

---

## 10. Ambiguity Log

- **AL-1 — Does `messages` need the `payload?.messages ?? []` treatment (as the cart fix applied)?** **No.** Verified against the actual current return: `createCheckout` **already** returns `messages: payload?.messages ?? []` (`mcp.server.js:521`). Unlike the cart functions (which had `payload.messages`), checkout is already null-safe. **Recommendation: leave `messages` untouched.** Changing it would be a no-op churn.

- **AL-2 — Is a live soft-error reproducible for checkout?** Likely **not** on demand: the investigation's probes all returned `isError:true` (which throws before the return path). **Recommendation: rely on unit case 2 as the primary guard** and document in QA that the soft-error path is unit-verified rather than live-reproduced (§9 step 4). This matches the bug's "latent, not observed live" framing.

- **AL-3 — Add the investigation's optional defense-in-depth route guard (verify `checkout?.checkoutUrl` before use)?** **No — out of scope.** The investigation lists it as optional item 3; the route already handles `checkout: null` correctly via its truthiness gate (`:189–191`). Per bug-fix scope discipline (minimum surface), a route change is a separate concern. **Recommendation: do not touch the route.** If defense-in-depth is later wanted, file it as its own bug/plan.

- **AL-4 — Discriminator choice: `payload?.id` vs a `continue_url`/`messages`-based check.** `id` is the correct discriminator: the live probe shows real checkouts always carry top-level `id` and soft-error envelopes never do, and `normalizeCheckout` itself depends on `id`. Note `continue_url` is a **poor** discriminator (the soft-error envelope also carries a fallback `continue_url`), which is exactly why `id` is required. **Recommendation: `payload?.id ? payload : null`**, matching the cart fix. Committing, not hedging.

---

## 11. Step-by-step implementation checklist for the Coder

1. Re-read `CLAUDE.md` (Anti-Stubbing Rule — fix the real behavior, never suppress; `.jsx`+JSDoc, never `.tsx`; do not hand-edit generated types; do not edit `.env`).
2. In `app/lib/mcp.server.js`, `createCheckout()` (`~519–522`):
   a. Change the return's `checkout:` line from `payload ?? null` to `payload?.id ? payload : null` (§4.1/§4.2).
   b. Augment the inline comment above the `return` with the soft-error guard rationale (§4.1), mirroring `updateCart`'s comment.
   c. Do **not** change the `messages:` line — it is already `payload?.messages ?? []` (§4.3, AL-1).
   d. Do **not** change `createCheckout`'s JSDoc block, `createCart`, `updateCart`, the route, or `normalizeCheckout`.
3. Pre-save audit (CLAUDE.md): no duplicate exports, no unused imports, no stray declarations introduced.
4. In `app/lib/mcp.server.test.js`:
   a. Add `createCheckout` to the existing `./mcp.server.js` import (`:28`).
   b. Append a new `describe('createCheckout — soft-error guard', ...)` block with the two fixtures and two cases in §7 (optionally the thrown-`tool_error` case), reusing `plainFetch` / a local `successFetch`, `BASE_OPTS`, `UCP_AUTH_MODES`, and `__resetForTests()`.
5. Prove the pin: run `npm run test:unit` **before** step 2a to confirm case 2 fails against the current code; then apply the fix and confirm all green.
6. Run `npm run lint`, then `npm run build`. Both must pass.
7. Write `docs/plans/fix-create-checkout-soft-error-gap-impl-notes.md` summarizing the change and the before/after test result for case 2, then hand off to QA for the verification in §9 (note the soft-error path is unit-guarded, not live-reproduced — AL-2).
