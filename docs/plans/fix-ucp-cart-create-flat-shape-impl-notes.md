# Implementation Notes: `fix-ucp-cart-create-flat-shape`

**Plan:** `docs/plans/fix-ucp-cart-create-flat-shape.md`
**Review:** `docs/reviews/fix-ucp-cart-create-flat-shape-review.md` (verdict: APPROVE)
**Investigation:** `docs/bugs/ucp-cart-create-flat-shape-investigation.md`
**Coder date:** 2026-07-15

---

## Summary

Fixed `createCart()` and `updateCart()` in `app/lib/mcp.server.js`, which
both read `payload.cart ?? null` on a shape that is actually FLAT (`payload`
itself IS the cart — no `.cart` sub-key), causing every successful
`create_cart`/`update_cart` call to surface a false `tool_error` to the
assistant route. Changed both to the plan's `id`-guarded flat unwrap:
`cart: payload?.id ? payload : null`. Corrected the misleading nested-`.cart`
comments/JSDoc that caused the bug, added the mandatory unit test coverage
(zero previously existed on these two functions), and folded in both
non-blocking review recommendations (NB-1, NB-2).

---

## Files changed

1. **`app/lib/mcp.server.js`**
   - `createCart()` JSDoc response-shape comment (~§339–348): replaced the
     "nested at `structuredContent.cart`" claim with the live-probed flat
     shape, explaining why the old comment was wrong (inferred from Dev MCP
     docs against a store where `create_cart` always crashed, so no
     successful response was ever observed).
   - `createCart()` return (~§383–392):
     - **Before:** `cart: payload.cart ?? null, messages: payload.messages ?? []`
     - **After:** `cart: payload?.id ? payload : null, messages: payload?.messages ?? []`
     - Inline comment rewritten to explain the `id` guard's purpose (preserving
       the route's defensive `if (!cart)` branch against a soft business-outcome
       envelope).
   - `updateCart()` return (~§444–452): identical fix + new corrective comment.
     - **Before:** `cart: payload.cart ?? null, messages: payload.messages ?? []`
     - **After:** `cart: payload?.id ? payload : null, messages: payload?.messages ?? []`
   - `createCheckout()` (~§514–518): comment-only correction — removed the
     stale "unlike the cart tools, which nest under a .cart key" clause,
     replaced with "the same flat shape as the cart tools." **No code change**
     to `createCheckout` (deliberately out of scope per plan §3/AL-2).

2. **`app/lib/mcp-normalize.js`** — `normalizeCart()` JSDoc doc-only fix (§5.5):
   - Header comment: `... (from create_cart / update_cart structuredContent.cart)` → `... (from create_cart / update_cart, whose payload is the flat structuredContent cart object — no .cart wrapper)`
   - `@param {object} rawCart - structuredContent.cart` → `@param {object} rawCart - the flat structuredContent cart object`
   - No code change.

3. **`app/lib/mcp.server.test.js`** — added `createCart, updateCart` to the
   existing import, and a new `describe('createCart / updateCart — flat UCP
   cart payload', ...)` block with the plan's 4 required cases (§8), reusing
   `plainFetch`, `BASE_OPTS`, and `__resetForTests()` from the existing
   harness. Did not add the plan's optional 5th (thrown-`tool_error`) case —
   the plan listed it as optional/not required, and case coverage for thrown
   `tool_error` already exists in the `callTool` suite, so it was left out to
   keep the bug-fix scope minimal.

4. **`app/lib/mcp-normalize.test.js`** — NB-1: corrected the header comment at
   ~§305–313 that repeated the same false nested-`.cart` claim ("on success
   (per Dev MCP docs), structuredContent.cart.totals[]...") to describe the
   real flat shape, citing the investigation. **Comment only** — the
   fixture/assertions in this file already used the (correct) flat shape, so
   no test expectations were changed.

5. **`docs/bugs/create-checkout-soft-error-gap.md`** (new) — NB-2: follow-up
   bug stub tracking the deferred AL-2 `createCheckout` soft-error gap
   (`checkout: payload ?? null` has the same latent missing-`id`-guard issue
   as the pre-fix cart tools, on the rare `create_checkout` fallback path).
   Severity Low, root cause left for a future investigation.

---

## Bug fix verification approach

Ties back to the bug report's steps to reproduce
(`docs/bugs/ucp-cart-create-flat-shape.md` — open the assistant with
`PUBLIC_STORE_DOMAIN=ashford-quantum.myshopify.com` and
`UCP_AUTH_MODE=none`, `search_catalog` for a product, add it to the cart) and
the investigation's live curl probe.

1. **Unit-level (done in this pass, see below):** the 4 new cases in
   `app/lib/mcp.server.test.js` directly exercise `createCart`/`updateCart`
   against a mocked flat-payload response byte-matching the investigation's
   live capture, and against a soft-error envelope. Cases 1 and 3 were
   confirmed to fail against the pre-fix code and pass after — this is the
   most direct proof the exact defect (the flat-vs-nested unwrap) is fixed.
2. **Live re-verification (QA, per plan §9 step 4):** with
   `PUBLIC_STORE_DOMAIN=ashford-quantum.myshopify.com` and
   `UCP_AUTH_MODE=none` set, open the assistant, `search_catalog` for a
   product, and add it to the cart. Expected: the assistant reports the cart
   was created and surfaces the cart / continue URL — **no** `tool_error`.
   Confirm "reproduced before / not after" against the original screenshot
   `docs/qa/screenshots/ucp-no-auth-mode-pass2-cart-tool-error.png`. Also add
   a second item in the same session to exercise the `updateCart` path (which
   had the byte-identical defect) and confirm the cart updates rather than
   erroring.
3. **Regression coverage (plan §7):** confirm `createCheckout`'s fallback
   path (only fires when `continue_url` is absent) is unaffected — its code
   is untouched, only its comment changed. Confirm the stale-cart retry path
   (route `:197–249`) now produces a fresh cart with `cartReset:true` instead
   of double-failing.

---

## Test results — prove-the-pin

### Before the fix (cases 1 and 3 added, fix NOT yet applied)

```
▶ createCart / updateCart — flat UCP cart payload
  ✖ 1. createCart success (flat payload) returns a non-null cart carrying id/line_items/continue_url (0.583ms)
  ✔ 2. createCart soft-error payload (no id/cart fields) returns cart:null (0.1225ms)
  ✖ 3. updateCart success (flat payload) returns a non-null cart with id (0.152458ms)
  ✔ 4. updateCart soft-error payload (no id/cart fields) returns cart:null (0.077417ms)

ℹ tests 65
ℹ pass 63
ℹ fail 2
```
Failure detail for case 1 (and identically for case 3):
```
AssertionError [ERR_ASSERTION]: a successful create_cart must not yield cart:null
  actual: null
  expected: null (i.e. asserted NOT-equal, but actual WAS null)
  operator: notStrictEqual
```
This confirms `payload.cart ?? null` fires on every success (`payload.cart`
is `undefined` on the flat shape), exactly as the investigation describes.

### After the fix (`payload?.id ? payload : null` applied to both functions)

```
▶ createCart / updateCart — flat UCP cart payload
  ✔ 1. createCart success (flat payload) returns a non-null cart carrying id/line_items/continue_url (0.17425ms)
  ✔ 2. createCart soft-error payload (no id/cart fields) returns cart:null (0.064583ms)
  ✔ 3. updateCart success (flat payload) returns a non-null cart with id (0.082083ms)
  ✔ 4. updateCart soft-error payload (no id/cart fields) returns cart:null (0.052541ms)

ℹ tests 65
ℹ suites 14
ℹ pass 65
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All 65 tests pass (the pre-existing 61 + the 4 new cases).

---

## Lint

`npm run lint` initially surfaced 7 new prettier-formatting errors introduced
by my raw test additions (line-wrapping style in `mcp.server.test.js`). Ran
`npx prettier --write app/lib/mcp.server.test.js` to bring the new code into
the repo's formatting convention (no logic change — prettier only reformats
whitespace/line-breaks). Re-ran lint:

```
✖ 72 problems (72 errors, 0 warnings)
```

72 matches the documented pre-existing baseline (CLAUDE.md/plan reference
"~72 pre-existing baseline problems in untouched files"). Confirmed zero
errors attributed to `app/lib/mcp.server.js`, `app/lib/mcp-normalize.js`,
`app/lib/mcp-normalize.test.js`, or `app/lib/mcp.server.test.js` (the four
files this fix touched) in the final lint output.

---

## Build

`npm run build` — exit code 0. The build emits a "Bundle analyzer failed to
analyze the bundle: TypeError: Invalid URL" notice from the SSR bundle
analysis step. Confirmed pre-existing and unrelated to this fix: stashed all
working-tree changes and ran `npm run build` against `main` — the identical
"Invalid URL" notice appears there too, with exit code 0. No GraphQL
fragments/queries changed, so `storefrontapi.generated.d.ts` was not
regenerated/touched (as expected — this fix has no data-contract changes).

---

## Deviations from the plan

None. All changes match plan §5 exactly:
- `createCart`/`updateCart` return + comment fix (§5.2/§5.3) — done as specified.
- `createCheckout` comment-only correction (§5.4), code untouched — done.
- `mcp-normalize.js` JSDoc fix (§5.5) — done.
- 4 required test cases (§8) — done, byte-matching the plan's fixtures.
- Optional 5th test case (thrown `tool_error`) — not added; plan listed it as
  optional/not required, and equivalent coverage already exists in the
  `callTool` suite (`throws tool_error McpError when result.isError is true`).
- NB-1 (mcp-normalize.test.js comment fix) — done, comment only, no assertion
  changes.
- NB-2 (create-checkout-soft-error-gap bug stub) — done.

---

## Out-of-scope observations

- The working tree already contained unrelated, pre-existing uncommitted
  changes to `app/lib/const.js` and `app/routes/($locale).api.assistant.jsx`
  (from an apparently separate, already-in-progress `ucp-no-auth-mode`
  feature — `UCP_AUTH_MODES`, `UCP_DEFAULT_AUTH_MODE`, `UCP_CLIENT_USER_AGENT`
  constants, and an `authMode` parameter threaded through `callTool` and the
  cart/checkout functions). These predate this bug-fix session, are not part
  of this plan, and were left untouched — confirmed via `git diff --stat`
  that my edits are confined to exactly the 4 files the plan named
  (`mcp.server.js`, `mcp-normalize.js`, `mcp-normalize.test.js`,
  `mcp.server.test.js`) plus the new `create-checkout-soft-error-gap.md` bug
  stub. Not fixed, not touched — noted here per the guardrail instructions,
  not actioned.

---

## Base branch / commit

Started from `main` at commit `e6934a9` (working tree already had the
unrelated pre-existing uncommitted changes noted above). No commit was made
in this session — changes are left staged/unstaged per instructions (commit
only if explicitly requested).
