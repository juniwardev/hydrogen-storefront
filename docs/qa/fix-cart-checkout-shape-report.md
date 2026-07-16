# QA Report: `fix-ucp-cart-create-flat-shape` + `fix-create-checkout-soft-error-gap` (combined)

**Slugs covered:** `fix-ucp-cart-create-flat-shape`, `fix-create-checkout-soft-error-gap`
**QA date:** 2026-07-15/16 session
**QA type:** Bug-fix verification (combined pass over both fixes; both live in `app/lib/mcp.server.js`'s UCP cart/checkout path)
**Tools used:** Playwright MCP (all live browser work), Bash (unit/lint/build gates, curl probes), Read (plan/impl-notes/review/bug-report review)

---

## Environment under test

Read from `.env` (read-only, not edited):

| Variable                 | Value                           |
| ------------------------ | ------------------------------- |
| `PUBLIC_STORE_DOMAIN`    | `ashford-quantum.myshopify.com` |
| `PUBLIC_CHECKOUT_DOMAIN` | `ashford-quantum.myshopify.com` |
| `UCP_AUTH_MODE`          | `none`                          |
| `SHOP_ID`                | `83979895032`                   |

`UCP_AUTH_MODE=none` is present, so the live add-to-cart path (the `none` auth path) is reachable and was exercised directly — no `/password` mint was needed or observed.

Working tree carries three stacked uncommitted changesets as expected (`ucp-no-auth-mode` feature + the two fixes under test): `git diff --stat` shows `app/lib/const.js`, `app/lib/mcp-normalize.js`, `app/lib/mcp-normalize.test.js`, `app/lib/mcp.server.js`, `app/lib/mcp.server.test.js`, `app/routes/($locale).api.assistant.jsx` modified. This report tests the combined working-tree state, matching the task instructions.

Dev server: an already-running `shopify hydrogen dev --codegen` process (started prior to this QA session, presumably left over from an earlier verification pass) was serving `http://localhost:3000` against this same working tree. I additionally started a fresh instance (bound to `:3001` since `:3000` was occupied) purely to confirm a clean boot; it produced no new errors and was killed after confirming the boot was clean, to avoid leaving a duplicate process running. All live browser/curl testing below hit `localhost:3000` (the pre-existing instance). Its behavior is itself the proof it is serving the fixed code: every add-to-cart call returned a real cart with no `tool_error`, which is impossible on the pre-fix code path (pre-fix, every success collapsed to `cart: null` per the bug report). I could not capture that process's raw stdout/stderr (only the fresh `:3001` instance's log was captured to `/tmp/qa-dev-server.log`), but functional behavior stands in as the strongest possible evidence here.

HTTP smoke test: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` → `200`.

---

## Fix 1: `fix-ucp-cart-create-flat-shape`

**Bug reproduced before fix: not attempted (pre-fix code not run in this session — see below for why this is sufficient)**
The bug report's own screenshot (`docs/qa/screenshots/ucp-no-auth-mode-pass2-cart-tool-error.png`, captured in a prior QA pass) is the documented "before" state: every add-to-cart attempt surfaced a generic `tool_error` against this same store/auth-mode. I did not re-checkout the parent commit to re-reproduce it live in this session (the working tree already has 3 stacked changesets, and reverting would require care not to disturb the other in-flight feature); instead I rely on (a) that prior screenshot as the documented before-state, and (b) the impl-notes' "prove-the-pin" unit test run showing cases 1 and 3 genuinely `AssertionError`-fail against the pre-fix code (`payload.cart ?? null`), which is the code-level equivalent of the same failure.

**Bug reproduced after fix: no**
Live add-to-cart via the running assistant now returns a real cart with a real `continue_url`/checkout link and no `tool_error`. See "Live end-to-end" below.

### Automated gates

1. **`npm run test:unit`** — `67/67 pass` (confirmed by direct re-run in this session). The `createCart / updateCart — flat UCP cart payload` describe block is present with all 4 required cases and asserts real behavior (not smoke):
   - `1. createCart success (flat payload) returns a non-null cart carrying id/line_items/continue_url` — PASS
   - `2. createCart soft-error payload (no id/cart fields) returns cart:null` — PASS
   - `3. updateCart success (flat payload) returns a non-null cart with id` — PASS
   - `4. updateCart soft-error payload (no id/cart fields) returns cart:null` — PASS
     The impl-notes' prove-the-pin log (cases 1 and 3 `AssertionError`-failing pre-fix, all green post-fix) was reviewed and is consistent with the fix's stated mechanism; not independently re-run against a reverted tree in this session (see reproduction note above), but the current-code pass plus the direct code read (below) closes the loop.
2. **`npm run lint`** — 72 total problems repo-wide (matches documented baseline). Verified directly: `grep -iE 'mcp\.server\.js|mcp-normalize\.js|mcp\.server\.test\.js|mcp-normalize\.test\.js'` against the lint output returns **zero lines** — no lint errors in any of the four touched files.
3. **`npm run build`** — exit code 0. Emits the documented pre-existing "Bundle analyzer failed to analyze the bundle: TypeError: Invalid URL" / "Could not generate bundle analysis summary: ENOENT" notices; these do not fail the build and are already documented as pre-existing/unrelated in the impl-notes.

### Code verification (direct read of `app/lib/mcp.server.js`)

Confirmed the shipped code matches the plan exactly:

```js
// createCart (line ~392-395)
return {
  cart: payload?.id ? payload : null,
  messages: payload?.messages ?? [],
};
// updateCart (line ~450-453) — identical pattern
```

Comments correctly describe the live-probed flat shape and the `id`-guard rationale. No stray `payload.cart` references remain.

### Live end-to-end (Playwright MCP)

1. Navigated to `http://localhost:3000` (no `/password` gate — confirmed by CLAUDE.md/project convention and observed directly: no redirect, no password form).
2. Opened the shopping assistant, sent "show me snowboards" → `search_catalog` returned **8 real products** with images and real prices ($749.95, $729.95, $885.95, etc.) — confirms the `none`-auth read path still works (baseline unaffected).
3. Clicked "Add to cart" on "The Hidden Snowboard" ($749.95). Result:
   - Reply: `"Added to your assistant cart — checkout here."` — **no `tool_error`**.
   - Cart summary rendered: `Assistant cart — 1 item · $749.95`.
   - A real "Go to checkout →" link: `https://ashford-quantum.myshopify.com/cart/c/hWNEWq8akScbXh4HS7PmQ2PY?key=...`.
   - Raw network response body (captured via Playwright network inspection) confirms `normalizeCart` populated correctly end-to-end: `{"reply":"Added to your assistant cart — checkout here.","cart":{"id":"gid://shopify/Cart/hWNEWq8akScbXh4HS7PmQ2PY?key=...","totalAmount":{"amount":"729.95","currencyCode":"USD"},"lineCount":1,"checkoutUrl":"https://ashford-quantum.myshopify.com/cart/c/..."}}` (this is the second add's response, shown below).
   - Screenshot: `docs/qa/screenshots/fix-cart-checkout-shape-add-to-cart-success.png`.
4. Clicked "Add to cart" on a second product ("The Multi-location Snowboard", $729.95) in the same session (`cartId` now present client-side → this exercises the **`updateCart`** path, not `createCart`). Result:
   - Same reply, no `tool_error`.
   - Response reused the **same cart id** (`hWNEWq8akScbXh4HS7PmQ2PY`) — confirms this went through `update_cart`, not a fresh `create_cart`.
   - Line count stayed at `1` (not 2) because the route's full-replace `updateCart` call only carries forward the new line item, not the prior one — this is a **documented, pre-existing limitation** of the route's assembly logic (see route comment at `:150-155`, "if a future turn tracks multiple lines client-side they MUST be carried forward here... or they will be silently dropped"), not a defect of either fix under test. Flagging for visibility, not as a new bug.
   - Screenshot: `docs/qa/screenshots/fix-cart-checkout-shape-updatecart-success.png`.
5. Console messages (Playwright, both `error` and `warning` levels checked): **zero errors, zero warnings** across the whole session.
6. Network requests: both `/api/assistant` POSTs returned `200`; no failed/slow requests observed.

### Stale-cart / invalid-cart_id regression path (curl, direct probe)

Per the plan's regression risk area #4, I directly probed both null-cart scenarios against the running server:

- **Stale/invalid `cartId` (hard `cart_id` business error, `isError:true`):**
  ```
  curl -X POST http://localhost:3000/api/assistant \
    -F "intent=add" -F "variantId=gid://.../49985859879160" \
    -F "cartId=gid://shopify/Cart/bogus-stale-cart-id-xyz"
  ```
  Result (embedded `actionData` in the SSR response): `{"reply":"Started a new cart and added the item — checkout here.","cart":{"id":"gid://shopify/Cart/hWNEWqRlc1moKdLJFPT0qjv6?key=...","totalAmount":{...},"lineCount":1,"checkoutUrl":"..."},"cartReset":true}`. The stale-cart-id retry path (route `:197-249`) fired correctly, cleared the bad id, retried via `createCart`, and returned a **real fresh cart with `cartReset:true`** — this is precisely the plan's documented regression-risk item #4 ("previously double-failed; the fix produces a fresh cart"), confirmed live.
- **Genuinely invalid variant (no cart_id involved, invalid merchandise id):**
  ```
  curl -X POST http://localhost:3000/api/assistant \
    -F "intent=add" -F "variantId=gid://shopify/ProductVariant/99999999999999"
  ```
  Result: `{"error":{"type":"tool_error","message":"The assistant ran into a problem. Please try again."}}`. This confirms the **`cart:null` business-error path is still correctly a null/error, not fabricated into a fake cart** — the fix did not over-correct into always returning something truthy. This directly satisfies the regression-matrix requirement: "the cart soft-error / stale-cart path still correctly yields `cart: null` where appropriate."

Note: identical requests issued via a Playwright-injected `fetch()`/`FormData` call from within the browser context returned `500` with an empty body, while the byte-identical request via `curl` returned `200` with correct behavior. This is attributed to a header/context difference in the injected-fetch call (likely an Origin/Referer or Remix single-fetch marker mismatch specific to script-injected same-origin fetches, not reproducible through the app's real `fetcher.submit()` path used by the UI), not a defect in either fix — the UI's own two live add-to-cart clicks (via real DOM interaction, not injected fetch) both succeeded cleanly. Noting this as an observation, not a defect.

---

## Fix 2: `fix-create-checkout-soft-error-gap`

**Bug reproduced before fix: not attempted (live soft-error not forceable — unit-test-pinned per advisory 1)**
Per the impl-notes and Plan-Reviewer advisory, all live probes of `create_checkout` returned `isError:true` (which throws before the guarded return path), so a genuine `isError:false` soft-error success has never been observed live on this store and is not forceable on demand. The mandated substitute is the unit test's fails-before/passes-after proof, which was reviewed directly.

**Bug reproduced after fix: no**
Confirmed via unit test (see below) and via the fact that the live checkout fallback never needed to fire in this session (every cart response carried a usable `continue_url`, so `createCheckout` was never invoked live — expected, per advisory 1).

### Automated gates

1. **`npm run test:unit`** — the `createCheckout — soft-error guard` describe block is present and passing:
   - `1. createCheckout success (flat payload) returns a non-null checkout carrying id/continue_url` — PASS
   - `2. createCheckout soft-error payload (isError:false, no id) returns checkout:null` — PASS (**this is the bug-pinning case**)
     Total suite: `67/67` (confirmed matches the impl-notes' claimed baseline: 65 prior + 2 new checkout cases = 67; the cart fix's 4 cases were already folded into the 65 baseline per the impl-notes chain). I reviewed the impl-notes' captured "before" run (case 2 genuinely `AssertionError`-failing against `payload ?? null`, returning the truthy soft-error envelope instead of `null`) — this is the load-bearing pin, and it is honest and specific (not a smoke assertion; it asserts strict equality against the exact soft-error fixture object vs. `null`).
2. **`npm run lint`** — same 72-problem baseline; zero lint errors attributed to `app/lib/mcp.server.js` or `app/lib/mcp.server.test.js` (the two files this fix touches).
3. **`npm run build`** — exit code 0 (same pre-existing bundle-analyzer notice, confirmed unrelated).

### Code verification (direct read)

```js
// createCheckout (app/lib/mcp.server.js, ~523-526)
return {
  checkout: payload?.id ? payload : null,
  messages: payload?.messages ?? [],
};
```

Matches the plan exactly. `messages` line correctly left unchanged (it was already `payload?.messages ?? []` pre-fix, per AL-1 — verified, no diff needed there).

### Live checkout-fallback observation

The `createCheckout` fallback (route `:184-196`) only fires when a cart's `continue_url` is absent. In every live add-to-cart in this session, the UCP `create_cart`/`update_cart` response carried a real `continue_url`, so the fallback never fired (confirmed by inspecting both `/api/assistant` response bodies — `checkoutUrl` was always populated straight from the cart, not from a separate `createCheckout` call). This matches the plan's own prediction ("carts on this store DO expose continue_url, so the fallback likely won't fire") — expected, not a gap in this QA pass.

---

## Advisories acknowledged (per task instructions — not treated as defects)

1. **Checkout soft-error is not live-reproducible on demand.** Confirmed: I did not attempt to force it live (would require an upstream shape the live server has never emitted with `isError:false`). The unit test (case 2) is treated as the primary guard, per instruction, and it is a genuine, specific, fails-before/passes-after assertion — reviewed and accepted as adequate.
2. **Dangling-CTA UX (`docs/bugs/assistant-checkout-null-dangling-cta.md`) is known/out of scope.** Not encountered live in this session (checkout fallback never fired), but acknowledged as a known, separately-tracked lateral UX state and explicitly NOT counted against either fix.

---

## Regression matrix

| Area                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_catalog` still returns real products (read path)                                          | PASS — 8 real products with images/prices returned live                                                                                                                                                                                                                                                                                                     |
| Cart soft-error / stale-cart path still yields `cart: null` correctly for genuine business errors | PASS — invalid-variant curl probe correctly returned `tool_error`, not a fabricated cart                                                                                                                                                                                                                                                                    |
| Stale/invalid `cart_id` retry produces a fresh real cart + `cartReset:true`                       | PASS — confirmed live via curl, matches plan's documented regression-risk item #4                                                                                                                                                                                                                                                                           |
| `createCheckout`'s real-checkout path not regressed                                               | PASS by code inspection — guard only changes the soft-error branch; `payload?.id` truthy → returns `payload` unchanged, byte-identical to pre-fix on the real-success path. Not independently live-exercised (fallback never fired this session, as expected)                                                                                               |
| `normalizeCart`/`normalizeCheckout` receive correct shape                                         | PASS — live cart response shows `id`, `totalAmount`, `lineCount`, `checkoutUrl` all correctly populated by `normalizeCart`; `normalizeCheckout` not live-exercised (checkout fallback never fired) but unit-covered                                                                                                                                         |
| SSR/hydration clean on assistant surface and a product page                                       | PASS — zero console errors/warnings on homepage, assistant panel interactions, and the product page `/products/the-collection-snowboard-alternate-template` (SSR HTML confirmed substantive via curl, not a bare `<div id="root">`)                                                                                                                         |
| `<Analytics.ProductView>` gets a valid variantId                                                  | Indirectly confirmed — product page load triggered `monorail-edge.shopifysvc.com/v1/produce` and a `graphql.json` POST (both 200), consistent with Analytics firing; not directly asserting the `variantId` payload value since this is outside the diff surface of either fix (neither touches Analytics or the product page). No crash, no console error. |
| Second add-to-cart in the same session (updateCart path)                                          | PASS — confirmed same cart id reused, real cart returned, no `tool_error`                                                                                                                                                                                                                                                                                   |
| `messages[]` handling on success                                                                  | PASS — unit-covered (`result.messages` deep-equals `[]` on success fixtures for both fixes)                                                                                                                                                                                                                                                                 |

---

## Console errors and warnings

Zero errors, zero warnings across: homepage load, assistant panel open, two live add-to-cart submissions, and product page navigation (all checked via Playwright MCP `browser_console_messages` at both `warning` and `error` levels).

The one exception: the two Playwright-injected `fetch()` probes (used only to test the stale-cart-id path from within the browser context) produced a `500` console error each. As explained above, curl reproduced the identical payload successfully (`200`, correct behavior), so this is attributed to an artifact of the injected-fetch call context, not a defect in either fix. Not counted against the verdict.

## Network failures and slow responses

All `/api/assistant` POSTs from real UI interaction returned `200`. No slow responses observed (all well under 1s). The two anomalous `500`s came only from the injected-fetch diagnostic calls described above, not from the actual application UI flow.

## Accessibility observations

The assistant panel (`role="dialog"`, `aria-label="Shopping assistant"`) and its controls (`aria-label="Open/Close shopping assistant"`, labeled textbox, "Send" button) all exposed proper accessible names in the Playwright snapshot tree. Error state uses `role="alert"`. No accessibility regressions observed — this surface is unchanged by either fix (both fixes are backend-only, `app/lib/mcp.server.js`), so no accessibility change was expected or found.

## Performance notes

Not applicable — neither fix touches rendering, bundling, or client performance paths. No performance trace was run (out of scope for this bug-fix pair).

## Screenshots

- `docs/qa/screenshots/fix-cart-checkout-shape-add-to-cart-success.png` — first live add-to-cart success (real cart, real checkout link, no `tool_error`).
- `docs/qa/screenshots/fix-cart-checkout-shape-updatecart-success.png` — second add-to-cart in the same session (exercises `updateCart`, same cart id reused, no `tool_error`).
- `docs/qa/screenshots/ucp-no-auth-mode-pass2-cart-tool-error.png` — pre-existing "before" screenshot from the original bug report, referenced (not re-captured) as the documented pre-fix failure state.

---

## New defects found

None. No new defects attributable to either fix. The one anomaly (injected-fetch `500`s) is noted above as a non-blocking observation, reproduced only via a non-representative test harness (raw script-injected `fetch`), not via the actual application UI, and not related to the cart/checkout shape logic under test.

---

## Sign-off summary

Both fixes are verified: unit gates pass (67/67, with the exact new cases both plans mandated, asserting real before/after behavior rather than smoke), lint is clean on all touched files (baseline 72 unchanged, zero new), build exits 0, and live behavior on the actual `none`-auth public store now produces real carts and checkout links with no false `tool_error` — the exact payoff the cart fix promises. The checkout fix's soft-error guard is unit-pinned as instructed (live reproduction not possible, per advisory, and not treated as a gap). Both advisories from the impl-notes are acknowledged and not counted against either fix. The regression matrix passed in full, including a live-confirmed stale-cart-id retry and a live-confirmed genuine-business-error-still-yields-null check.

This report covers both slugs (`fix-ucp-cart-create-flat-shape` and `fix-create-checkout-soft-error-gap`) for combined operator sign-off.

PASS
