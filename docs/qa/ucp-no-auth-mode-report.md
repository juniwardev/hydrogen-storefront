# QA Report: `ucp-no-auth-mode`

Date: 2026-07-15/16
QA: automated + manual verification against plan `docs/plans/ucp-no-auth-mode.md` (Revision 2), impl notes `docs/plans/ucp-no-auth-mode-impl-notes.md`, review `docs/reviews/ucp-no-auth-mode-review.md`.

---

## Env under test (read-only inspection, not modified)

- `PUBLIC_STORE_DOMAIN` = `ashford-quantum.myshopify.com` (`.env`) — the migrated, public, agentic-commerce-provisioned store this feature targets.
- `UCP_AUTH_MODE` — **not set** in either `.env` or `.env.local`. Confirmed by `grep` of both files and by the MiniOxygen "Environment variables injected" startup log, which lists 10 vars from `.env` and does not include `UCP_AUTH_MODE`. Effective mode: **`dev-cookie`** (the documented default).
- `DEV_STOREFRONT_PASSWORD` = `saoteu` in `.env.local`, but **not injected into `context.env`** by the running dev server — the MiniOxygen startup log lists zero `.env.local` vars. This reproduces the pre-existing, already-documented Issue #1 in `docs/bugs/ucp-dev-env-investigation.md` (the Shopify Hydrogen CLI's `--env-file` flag loads exactly one file, defaulting to `.env`, and does not auto-merge `.env.local`). Not caused by this feature.

**Net effect:** the running dev server is in `dev-cookie` mode (the default) against a store that no longer needs a password, with the one env var that would fix that (`UCP_AUTH_MODE=none`) never declared in the file the CLI actually loads. This is an **operator/env configuration gap**, not a defect in the code under test — see "Issues found" below for the recommended fix. Per the task brief, live testing was scoped down accordingly rather than forcing an env change.

---

## 1. Automated gates (actual output)

### `npm run test:unit`

```
ℹ tests 61
ℹ suites 13
ℹ pass 61
ℹ fail 0
```

All 8 `ucp-auth.server.test.js` cases pass, file byte-unchanged (confirmed `git diff --stat` shows zero diff on `ucp-auth.server.js`, `ucp-auth.server.test.js`, `mcp-normalize.js`/`.test.js`, `mcp-error.server.js`). All 15 pre-existing `mcp.server.test.js` cases pass with the `dev-cookie` default. The new `describe('callTool — auth modes')` block has all 10 §7b cases, read directly from the test file and confirmed to assert real behavior, not smoke:

- Test 2 asserts `log.calls.length === 1` and that no call URL contains `/password` — structurally proves the shim is never invoked on `none`.
- Test 3 asserts `'Cookie' in capturedHeaders === false` (not `Cookie: undefined`) and a non-empty `User-Agent`.
- Test 4 asserts `err.detail.reason === 'auth_mode_none_but_store_gated'` and `callCount === 1` (no remint retry).
- Test 7 asserts `err.detail.reason === 'signed_mode_not_implemented'` and zero network calls.
- Test 8 asserts `err.detail.reason === 'unknown_auth_mode'` and zero network calls.
- Test 10 asserts `err.detail.reason === 'dev_storefront_password_missing'` and `err.detail.hint.includes('UCP_AUTH_MODE=none')`.

The test run's stdout also showed every expected `[mcp] config_error reason=... tool=...` log line firing during the suite, confirming the logging code executes on every code path exercised by tests (not just theoretically reachable).

### `npm run lint`

Full repo: **72 problems (72 errors, 0 warnings)** — matches the impl-notes' claimed pre-existing baseline. Scoped `npx eslint` on the four touched files (`app/lib/const.js`, `app/lib/mcp.server.js`, `app/lib/mcp.server.test.js`, `app/routes/($locale).api.assistant.jsx`) produced **zero output** — clean. No new errors introduced by this feature.

### `npm run build`

Exit code **0**. `dist/server/index.js` and client assets built successfully. The `Bundle analyzer failed to analyze the bundle: TypeError: Invalid URL` message appears, matching the impl-notes' claim of a pre-existing, unrelated issue (I did not re-verify against `main` HEAD myself, but the message is orthogonal to this diff — no auth-mode code touches the bundle analyzer). No `package.json`/`package-lock.json` drift observed after this run.

---

## 2. Baseline verification (CLAUDE.md "Verification" + browser, Playwright MCP)

- HTTP smoke: `curl -s -o /dev/null -w "%{http_code}"` → **200**.
- Homepage / collection page (`/collections/frontpage`, the effective home route): SSR confirmed via `curl` of the raw HTML — real rendered markup (`Ashford Quantum Solutions`, nav, JSON-LD, product cards), not an empty root div.
- Product page `/products/the-multi-location-snowboard`: SSR renders product title, vendor, Add to Cart, Buy with Shop Pay link, related products with real prices; raw HTML contains 12 real `gid://shopify/ProductVariant/...` GIDs.
- Console (Playwright, both pages): **0 hydration warnings**. Console entries seen:
  - `[INFO]` React DevTools download hint (harmless, dev-only).
  - `[WARNING]` "Tried to prefetch /collections/frontpage but no routes matched." x2 (pre-existing Remix routing quirk on the homepage link, unrelated to this feature).
  - `[ERROR]` `Failed to load resource: the server responded with a status of 401 () @ https://theme-evolution-os2-hydrogen.myshopify.com/api/unstable/graphql.json` — see "Issues found" #2 below. Pre-existing, unrelated to this feature's diff.
- Analytics: `monorail-edge.shopifysvc.com/v1/produce` and `/unstable/produce_batch` POSTs fired (200) on product-page load, confirming `<Analytics.ProductView>` (or equivalent) actually dispatches with real variant data — consistent with the Analytics Contract.

---

## 3. UCP / assistant path — the feature itself

**Live browser exercise (Playwright):** Opened the shopping assistant widget on the storefront, typed "show me snowboards", submitted. Result: the widget rendered the generic alert **"The shopping assistant is not configured."** — this is the expected, unchanged `mapMcpError` string for any `config_error` (confirmed by reading the route: `mapMcpError` is untouched, per plan §2/§4.1 design).

**Server-side log (ground truth, via dev-server stdout):**
```
[mcp] config_error reason=dev_storefront_password_missing tool=search_catalog
```
This is the *correct* reason for the *actual* running configuration (`dev-cookie` default + `password` not reaching `context.env`, per the env note above) — the code is behaving exactly as designed for this misconfiguration. It also independently confirms: (a) the observability code fires in the live running server, not just under test; (b) no secret value (password, cookie, query) appears anywhere in the log output — confirmed by grepping the full dev-server log for the password string and for `Cookie:`, finding neither.

**Conclusion on the live `none`-mode E2E path:** **BLOCKED-ON-ENV**, not passed and not failed. The running server never declares `UCP_AUTH_MODE=none` (it isn't set in `.env`, the file the Hydrogen CLI actually loads), so the assistant cannot be exercised through the browser in the `none` mode this feature exists to support. I did not modify env files to force this path, per instructions — see "Issues found" #1 for the recommended operator fix.

**Independent confirmation the `none`-mode premise is real (direct-to-store probe, bypasses local dev-server config entirely):** Issued a raw `tools/call search_catalog` JSON-RPC POST directly to `https://ashford-quantum.myshopify.com/api/ucp/mcp` with `Content-Type: application/json` only (no `Cookie`, mirroring exactly what the `none` branch of `callTool` sends) — **HTTP 200**, returning 3 real products (e.g. `gid://shopify/Product/10218830463224`, "The Multi-location Snowboard", `$729.95`) with no auth of any kind. This confirms the live store genuinely supports the no-auth path the code implements; the gap is purely local env declaration, not a flaw in the design or code. (I did not probe `create_cart` live to avoid creating stray cart records on the live store outside of the app's own flow; the plan's Architect had already probe-verified `create_cart` via curl per §1, and the unit tests (test 1, 5, 6) cover the request-construction behavior for cart-shaped calls under `none` structurally.)

---

## 4. §10.4a UA probe — **PASS** (not blocked-on-env; resolved via direct probe)

Ran the exact cookieless `none`-mode MCP POST against the live `ashford-quantum.myshopify.com/api/ucp/mcp`, both with and without a `User-Agent` header:

| Request | HTTP status |
| :--- | :--- |
| With `User-Agent: Mozilla/5.0 ... Chrome/120.0.0.0 Safari/537.36` | **200** |
| Without any `User-Agent` header (`curl -A ""`, verified via `-v` that no `User-Agent:` line was sent) | **200** |

**AL-7 resolved:** the `User-Agent` is **not** required on the cookieless `none` MCP POST. This matches the code's own documentation exactly — `UCP_CLIENT_USER_AGENT`'s JSDoc in `const.js` already says the UA is "PRECAUTIONARY, not a proven requirement" and cites the same reasoning (the `/password` shim legs need a UA; the MCP POST itself, cookied or not, apparently does not). No code change is implied by this result — the plan explicitly says the code ships with the UA regardless of the probe outcome, and it does. This is a genuine, evidence-backed confirmation of a hypothesis the plan and impl-notes had explicitly left as "unconfirmed, deferred to QA."

---

## 5. Observability spot-check (§4.1)

- Unit tests: confirmed (by reading the test file, not just trusting the impl-notes) that tests 4, 7, 8, 10 assert `err.detail.reason` for `auth_mode_none_but_store_gated`, `signed_mode_not_implemented`, `unknown_auth_mode`, and `dev_storefront_password_missing` respectively, and test 10 additionally asserts `detail.hint.includes('UCP_AUTH_MODE=none')`. These pass (61/61 total).
- Live server log: the one `config_error` path actually reachable in this env (`dev_storefront_password_missing`) fired with the correct token and correct format (`[mcp] config_error reason=<token> tool=<name>`), matching the existing `http_error`/`rpc_error` logging discipline. No secret values (password, cookie, query text) appeared in the log — confirmed by grep.
- Could not independently trigger `auth_mode_none_but_store_gated`, `signed_mode_not_implemented`, or `unknown_auth_mode` live (would require changing `UCP_AUTH_MODE` in env, out of scope for QA per the read-only-on-env constraint) — these three reason tokens are verified only via the unit tests (which is exactly what the plan's own §4.1 verification section describes as sufficient: "Unit (CI)... Manual (operator)").
- Code review confirms the `unknown_auth_mode` console-line deviation (`mode=` omitted from the printed line, kept in `detail.mode`) is exactly as described in the impl-notes' "Deviations" section, and is harmless — no test or contract depends on the console string containing `mode=`.

---

## Issues found

1. **[Operator env-config gap, not a code defect — Medium severity for reachability of the feature, zero severity for code correctness]** The live dev env's `.env` (the file actually loaded by the Shopify Hydrogen CLI) never declares `UCP_AUTH_MODE=none` for the migrated `ashford-quantum` store. Combined with the pre-existing, already-documented Issue #1 (`.env.local` is not loaded by `npm run dev`, so `DEV_STOREFRONT_PASSWORD` also never reaches `context.env`), this means the running dev server currently cannot successfully call the UCP assistant at all — it falls into the `dev-cookie` default and throws `dev_storefront_password_missing`. **Recommendation:** the operator should add `UCP_AUTH_MODE=none` directly to `.env` (not `.env.local`, since that file isn't loaded) to actually exercise this feature's raison d'être locally. This is flagged per the task brief's instruction to report the env gap rather than force a change. (Verified via Playwright MCP + direct log inspection.) — **CLOSED in second pass, see below.**

2. **[Pre-existing, unrelated to this feature — Low severity]** Every page load throws a console error: `Failed to load resource: the server responded with a status of 401 () @ https://theme-evolution-os2-hydrogen.myshopify.com/api/unstable/graphql.json`. Root cause: `.env`'s `PUBLIC_CHECKOUT_DOMAIN` still points at the old `theme-evolution-os2-hydrogen.myshopify.com` store while `PUBLIC_STORE_DOMAIN` has been migrated to `ashford-quantum.myshopify.com` — a leftover from the store migration, unrelated to any file this feature touched. Worth a follow-up env cleanup ticket. (Verified via Playwright MCP console capture on two separate pages.) — **CLOSED in second pass, see below.**

3. **[Env file hygiene, unrelated to this feature — Low severity/nit]** `.env` has a missing newline between `PUBLIC_CUSTOMER_ACCOUNT_API_URL=https://shopify.com/83979895032` and the next `PUBLIC_UCP_AGENT_PROFILE_URL=...` line — they're concatenated on a single physical line, so `PUBLIC_CUSTOMER_ACCOUNT_API_URL`'s value is garbled to include the next var's key=value appended to it. Confirmed via `cat -e`. Not part of this feature's diff (no touched file writes to `.env`); flagged for operator awareness since it could affect the Customer Account API surface elsewhere. Not exercised further as it's out of this feature's scope. — **CLOSED in second pass, see below.**

4. **[Nit — cosmetic, non-blocking]** §4.1/§10.6 of the plan itself (not the code) describes the new §7b tests as ones that "already assert" `detail.reason` — the Plan-Reviewer already flagged this as a harmless wording nit (N1); confirmed still present in Revision 2 but doesn't affect any test or code behavior.

No defects found in the actual code under test (`app/lib/const.js`, `app/lib/mcp.server.js`, `app/routes/($locale).api.assistant.jsx`, `app/lib/mcp.server.test.js`). The mode-dispatch switch, conditional headers, mode-branched 302 handling, relocated/rewritten hint, and observability logging all match the plan exactly and behave correctly everywhere they were reachable (unit tests, live server log, and an independent direct-to-store probe).

---

## Console errors and warnings (verbatim)

```
[INFO] %cDownload the React DevTools for a better development experience: https://reactjs.org/link/react-devtools
[WARNING] Tried to prefetch /collections/frontpage but no routes matched.
[WARNING] Tried to prefetch /collections/frontpage but no routes matched.
[ERROR] Failed to load resource: the server responded with a status of 401 () @ https://theme-evolution-os2-hydrogen.myshopify.com/api/unstable/graphql.json:0
```
No React hydration warnings observed on any page.

## Network failures and slow responses

- One recurring 401 (see Issues #2), unrelated to this feature.
- No slow responses observed; UCP direct-probe round trips to the live store completed in well under a second each.
- Live direct probes (bypassing local dev server): `POST /api/ucp/mcp` with UA → 200; without UA → 200. Both returned real `search_catalog` payloads.

## Accessibility observations

No new accessibility issues observed in the shopping-assistant dialog (proper `dialog` role, labelled textbox, disabled Send button when empty) or on the product/collection pages exercised. Not a focus area for this backend-auth-mode feature; only spot-checked incidentally while driving the assistant UI.

## Performance notes

None specific to this feature — `authMode` switch is a synchronous branch before the existing network call; no measurable overhead. Full performance trace not run (not warranted for a server-side auth-branch change).

## Screenshots

None captured — no visual regressions or UI issues were found; the only user-visible surface (the assistant's generic error alert) was verified via accessibility snapshot text, which is more precise than a screenshot for this purpose.

---

## Verdict rationale (first pass)

Everything in the actual code diff (`const.js`, `mcp.server.js`, `mcp.server.test.js`, the assistant route) was verified correct wherever it was reachable: 61/61 unit tests pass and were read to confirm they assert real mode-dispatch behavior (not smoke), lint is clean on the touched files, build exits 0, the untouched files are byte-identical (`git diff --stat` empty), the observability log line fires correctly and safely in the live running server, and an independent direct-to-store probe confirms both the underlying no-auth premise and resolves the previously-open AL-7 UA question with real evidence. The only shortfall is environmental: the operator has not yet declared `UCP_AUTH_MODE=none` in the file the Hydrogen CLI actually loads, so the full live browser E2E of the `none` path (the feature's whole point) could not be exercised end-to-end through the app itself in this session. That gap is called out explicitly rather than glossed over, is outside the Coder's and QA's control, and does not reflect a code defect — hence not a `FAIL`, but also not a clean `PASS` since one of the requested live checks is genuinely blocked-on-env.

PASS WITH NITS (first pass, superseded — see second pass below)

---
---

## Second QA pass (2026-07-15)

Purpose: verify the LIVE `none`-mode end-to-end path now that the operator has fixed the env that blocked the first pass. This section is additive; nothing above is edited.

### Env confirmation (read-only, `.env` not modified)

Read `.env` directly (13 lines, one var per line, no concatenation):

```
PUBLIC_STORE_DOMAIN=ashford-quantum.myshopify.com
PUBLIC_CHECKOUT_DOMAIN="ashford-quantum.myshopify.com"
...
PUBLIC_CUSTOMER_ACCOUNT_API_URL=https://shopify.com/83979895032
UCP_AUTH_MODE=none
```

Confirmed:
- **`UCP_AUTH_MODE=none` is present** (line 13, its own line, own var).
- **`PUBLIC_STORE_DOMAIN` and `PUBLIC_CHECKOUT_DOMAIN` both point at `ashford-quantum.myshopify.com`** — the checkout-domain mismatch from pass 1 is gone.
- **Line 12 (`PUBLIC_CUSTOMER_ACCOUNT_API_URL`) is no longer concatenated** with the next var — each var now has its own line. Issue #3 (env hygiene) is resolved.

All three env-fix preconditions the task asked me to confirm are verified true. Proceeding to the live path.

### Server health

The dev server was already running (operator-restarted per the task brief), but with no captured stdout I could inspect. To get full visibility into the MiniOxygen "environment variables injected" log and any `[mcp] config_error` lines at runtime, I stopped that process (`kill` on the `npm run dev` PID and its `workerd`/`esbuild` children) and restarted it myself in the background with stdout redirected to a scratch log file (`/private/tmp/.../dev-server-pass2.log`) — this is the same `npm run dev` command from `CLAUDE.md`, just with output captured for QA visibility. No application code or env file was touched.

- `curl -s -o /dev/null -w "%{http_code}"` → **200**.
- MiniOxygen startup log now reads:
  ```
  Environment variables injected into MiniOxygen:
  ...
  UCP_AUTH_MODE                           from local .env
  ```
  `UCP_AUTH_MODE` is now in the injected set — the running server actually has the var this time, unlike pass 1.

### Live `none`-mode path — search_catalog (Playwright MCP)

Navigated to `/products/the-multi-location-snowboard`, opened the shopping-assistant dialog, typed "show me snowboards", submitted.

**Result: WORKS.** The assistant returned "Found 8 products." with 8 real snowboard products (name, price, image, "Add to cart" button each) — e.g. The Hidden Snowboard $749.95, The Multi-location Snowboard $729.95, The Videographer Snowboard $885.95, etc. This is a live, real Storefront response through the app's own UI, not a probe.

- **No `config_error` anywhere.** The generic "not configured" message from pass 1 is gone entirely.
- **Server log:** grepped the full captured dev-server log for `mcp]`, `config_error`, `Cookie`, `password` across the entire session (search + two add-to-cart attempts, see below) — **zero matches**. No config_error fired, no `/password` mint attempt, no `Cookie` header ever logged or sent. **G2/G3 hold at runtime**, not just in unit tests — the `none` path genuinely never touches the shim.
- Network tab (Playwright): the assistant's own `POST /api/assistant` calls returned 200; the underlying live Storefront GraphQL request also came back **200** (see 401 nit below).

This closes Issue #1 (env gap) from pass 1 completely: `search_catalog` now works live, end-to-end, through the browser, in `none` mode, with no config error and no shim invocation.

### Live `none`-mode path — add to cart (Playwright MCP, then isolated Node probes)

Clicked "Add to cart" on "The Multi-location Snowboard" ($729.95, variant GID `gid://shopify/ProductVariant/49985859879160`) from the assistant's search results.

**Result: the assistant surfaced `"The assistant ran into a problem. Please try again."` (mapped from a `tool_error`), reproducible on every attempt** (tried twice via the browser, a third time via a bare `curl -X POST http://localhost:3000/api/assistant` with the same `intent=add&variantId=...` form body — same `tool_error` embedded in the rendered `actionData`, ruling out anything browser-specific).

This is **not** a `config_error` — the auth-mode switch this feature implements is not at fault; the request clearly reached the live MCP endpoint successfully (no auth failure of any kind). To find the actual cause without editing application code, I wrote two throwaway Node scripts (deleted after use, never committed) that `import`ed the real, unmodified `app/lib/mcp.server.js` and called (a) the low-level `callTool()` and (b) the public `createCart()` wrapper directly, with the exact same `storeDomain`, `profileUrl`, `variantId`, and `authMode: 'none'` the app itself uses:

- **`callTool({name: 'create_cart', ...})` directly: succeeds.** The live store returns a real, valid cart: `id: "gid://shopify/Cart/hWNEWkscDja2FqAuTXrVdTJY?key=..."`, real `line_items`, `totals`, `currency`, and a working `continue_url` (`https://ashford-quantum.myshopify.com/cart/c/...`). `isError` is `false`. **This is the actual "payoff of the migration" working** — the live, public, provisioned store genuinely creates real carts with no auth, exactly as the plan's §1 premise claims.
- **`createCart({...})` (the wrapper the route actually calls): returns `{cart: null, messages: []}`** for that exact same successful call.

**Root cause identified (pre-existing bug, NOT part of this feature's diff):** `createCart()` in `app/lib/mcp.server.js` does:
```js
return {
  cart: payload.cart ?? null,
  messages: payload.messages ?? [],
};
```
This assumes the cart object is **nested** under a `.cart` key inside `structuredContent` (the function's own JSDoc says so explicitly: *"the cart object is nested at `structuredContent.cart`, NOT flat at top level — unlike search_catalog/create_checkout"*). But the live `ashford-quantum` store's actual `create_cart` response has the cart fields (`id`, `line_items`, `currency`, `totals`, `continue_url`, etc.) **flat at the top level of `structuredContent`** — there is no `.cart` key at all. So `payload.cart` is always `undefined` → `?? null` → the route's `if (!cart)` branch fires → the generic `tool_error` is returned to the browser, even though the underlying UCP call succeeded and a real, billable-if-checked-out cart now exists on the live store.

**Confirmed via `git diff` that this logic is untouched by the `ucp-no-auth-mode` diff** — `createCart`'s return statement is identical before and after this feature; the diff only added the `authMode` parameter and threaded it into `callOpts`. `createCart` also has **zero unit test coverage** in `mcp.server.test.js` (confirmed via grep — no test references `createCart` or `create_cart`), which is why this shape mismatch was never caught by CI. This is a **newly surfaced, pre-existing defect** — it was unreachable during earlier QA passes because `config_error` always fired first (either the old dev-cookie/gated-store loop, or pass 1's env gap); now that `ucp-no-auth-mode` correctly unblocks reachability, this is the first time `create_cart` has actually succeeded far enough through the app to expose the mismatch.

**Practical/side-effect note:** because the raw MCP call *does* succeed on every attempt, each failed "Add to cart" click in the assistant is silently creating a real, abandoned cart on the live `ashford-quantum` store (three were created during this QA session, expiring in 30 days per `expires_at`). This is a minor real-world cost of the bug, not of this feature.

**Answering the task's direct question — "is a real cart created?":** **Yes, upstream** (confirmed three times: twice via isolated Node probes calling the actual unmodified `callTool`/`createCart` functions, once via the earlier direct `curl` probe in pass 1's Architect-cited premise) — **but no, not as observed by an end user through the app**, because a separate, pre-existing bug in `createCart()`'s payload-shape assumption discards the successful result before it reaches the browser. Screenshot: `docs/qa/screenshots/ucp-no-auth-mode-pass2-cart-tool-error.png`.

### §10.6 observability at runtime

Confirmed via the captured server log across the full session (search_catalog success + two add-to-cart tool_error attempts): **zero `[mcp] config_error` lines fired**, because no config-mode misconfiguration occurred at any point — the auth-mode layer worked correctly throughout. This is the expected, correct outcome for a fully-configured `none`-mode run; it is not a gap. The four `config_error` reason tokens remain verified only via the unit-test assertions (tests 4/7/8/10, still 61/61 green), exactly as pass 1 reported — there was no safe way to trigger them live without editing the operator's env, which is out of scope.

### 401 nit (Issue #2) — CLOSED

Re-checked on a fresh navigation to `/` and to the product page: the Storefront GraphQL POST (`https://ashford-quantum.myshopify.com/api/unstable/graphql.json`) now returns **200**, not 401. Console messages on both pages: **0 errors, 0 warnings** (aside from harmless dev-only `[vite]` connect/`[INFO]` React DevTools lines). The repointed `PUBLIC_CHECKOUT_DOMAIN` fully resolved this — confirmed via Playwright console capture and the network-requests list.

### Gates re-confirmation

- `git diff --stat` — **identical to pass 1** (`const.js` +31, `mcp.server.js` +115/-?, `mcp.server.test.js` +298, assistant route +10/-?; four files, no drift). Code is unchanged since pass 1, as expected (QA is read-only).
- `npm run test:unit` — re-ran: **61/61 pass**, identical to pass 1. Lint/build not re-run since the code diff is byte-identical to pass 1 (confirmed via `git status`/`git diff --stat`) and both passed cleanly then.

### Second-pass issues found

1. **[Pre-existing bug, NOT part of this feature's diff — HIGH severity, blocks the practical payoff of the migration]** `createCart()` in `app/lib/mcp.server.js` reads `payload.cart` on a response whose live shape is flat (no `.cart` key), so every real, successful `create_cart` call is silently treated as a failure by the route, surfacing a generic `tool_error` to every end user who tries to add an item via the shopping assistant, on every attempt, 100% reproducible. Confirmed root cause via isolated Node probes against the real, unmodified `mcp.server.js` (see above). Zero unit test coverage of `createCart`/`updateCart`'s cart-extraction logic let this ship. **This is not a defect in `ucp-no-auth-mode`** (confirmed via `git diff` — the relevant code is byte-identical before/after this feature) but it is the single thing standing between "auth now works" and "the assistant can actually complete a purchase," which is the stated business goal of the whole UCP migration. **Recommendation:** file a new bug report (e.g. `docs/bugs/ucp-cart-response-shape-mismatch.md`) and route it through `/plan` → `/implement` as its own fix cycle; likely fix is to read the cart fields from the top level of `payload` (mirroring how `search_catalog`'s flat shape is already handled) rather than `payload.cart`, plus add unit test coverage for `createCart`/`updateCart` success-shape parsing so this class of regression can't recur silently. (Verified via Playwright MCP for the UI repro, plus direct Node-script probes of the actual unmodified `mcp.server.js`/`callTool`/`createCart` for root-causing — no Chrome DevTools MCP needed for this.)
2. Issues #1 (env gap), #2 (401 on stale checkout domain), and #3 (concatenated `.env` line) from pass 1 are **all confirmed closed** by the operator's env fix. No further action needed on any of them.
3. No regressions found in the `ucp-no-auth-mode` feature's own code: the auth-mode switch, conditional headers, and 302 handling all behave correctly on the live path exactly as designed — confirmed by the complete absence of `config_error`/shim/`Cookie` artifacts in the runtime log during a real, successful `none`-mode session.

### Second-pass verdict rationale

The feature under test — `ucp-no-auth-mode` — is now fully verified live, end-to-end, through the browser: `UCP_AUTH_MODE=none` is genuinely injected by the running server, `search_catalog` returns real products with no config error, the dev-cookie shim is never invoked (zero `Cookie`/`password` artifacts across the entire captured server log), and all three previously-blocked-on-env issues are closed. This is exactly what the plan set out to deliver, and it works.

The add-to-cart path surfaced a real, high-severity, 100%-reproducible defect — but it lives in `createCart()`'s payload-shape assumption, a section of code this feature's diff does not touch (confirmed via `git diff`) and which the plan's own non-goals (§2) explicitly exclude ("changing the response-envelope... normalizer... untouched"). The underlying capability this feature was built to unlock — a public store accepting unauthenticated UCP calls — is proven to work (three independent confirmations of a real cart being created upstream). The fact that a *different*, pre-existing, untested function then discards that success is a serious bug worth immediate follow-up, but it is not a failure of `ucp-no-auth-mode` itself.

Given the severity and the fact that this was the specific "payoff" this pass was asked to verify, this is flagged as loudly as possible above (severity HIGH, explicit recommendation for an immediate new bug-fix cycle) rather than being downgraded to a footnote. The `ucp-no-auth-mode` feature itself, on its own merits and scope, passes cleanly with no remaining nits from pass 1 (all closed) and one newly-discovered out-of-scope defect that must not be lost — hence `PASS WITH NITS`, carrying forward the same token as pass 1 but for a different reason: pass 1's nits are now closed, and a new, more serious one (out of this diff's scope) has taken their place.

Bug reproduced before fix: not attempted (this is a feature QA pass, not a fix verification; the cart-shape bug found here is a new discovery, not the subject of a prior bug report)
Bug reproduced after fix: n/a (see above — this is a newly discovered defect, not a regression check against a prior fix)

PASS WITH NITS
