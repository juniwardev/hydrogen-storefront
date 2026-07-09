# Fix notes: UCP dev-env Issue #2 — shim `/password` POST fails inside MiniOxygen/workerd

**Date:** 2026-07-08
**Scope:** `docs/bugs/ucp-dev-env-investigation.md` Issue #2 only. Issue #1 (`.env.local` not loaded) was already resolved by the operator merging vars into `.env` before this task started — confirmed still merged and loading correctly (see Step 4 below).
**Plan under which this fix falls:** `docs/plans/ucp-migration.md` (verdict `APPROVE`, `docs/reviews/ucp-migration-review-2.md`).

---

## 1. The repro

Built in the scratchpad (`/private/tmp/claude-501/.../scratchpad`, not committed to the repo). Three stages, each isolating one variable:

### Stage A — Local HTTP mock, Node vs. workerd (Miniflare, `miniflare@3.20241022.0`, matching the investigation's reported MiniOxygen version)

A minimal `http.createServer` mock reproduced the shim's exact `GET /password → parse token → POST /password (redirect: 'manual') → extractSetCookie()` sequence, byte-for-byte identical to `mintCookie()` in `app/lib/ucp-auth.server.js`. Ran the identical worker script once under plain Node `fetch()` and once inside a real `Miniflare` instance (the same package MiniOxygen 3.1.1 depends on).

**Result: no divergence.** `redirect: 'manual'` correctly returned the 302 response object (not auto-followed) in both runtimes. `Headers.getSetCookie()` returned the cookie identically in both runtimes, including with multiple `Set-Cookie` headers on the same response (tested 1, 2, and 3 simultaneous cookies, in different orders, including an expired/empty-value cookie mixed with a valid one — all preserved correctly by workerd). This directly disproves the investigation's `redirect: 'manual'` hypothesis and the "`Set-Cookie` visibility" hypothesis as stated — neither reproduces against a real HTTP mock.

(One early multi-cookie test appeared to show workerd dropping 2 of 3 cookies — traced this to a bug in that particular mock server, which 302-redirected on every path including the redirect target `/`, not to any real workerd behavior. Rebuilt the mock correctly and the false lead disappeared.)

### Stage B — Live dev store, Node vs. workerd, via Miniflare with real credentials

Since the operator resolved Issue #1 (`.env` now has `PUBLIC_STORE_DOMAIN` and `DEV_STOREFRONT_PASSWORD`), ran the exact `mintCookie()` sequence against the **real live dev store** `https://theme-evolution-os2-hydrogen.myshopify.com/password`:

- **Plain Node `fetch()`:** `GET /password` → 200, token found. `POST /password` (`redirect: 'manual'`) → 302, exactly 1 `Set-Cookie` header named `_shopify_essential`, extraction succeeds.
- **Miniflare/workerd, identical code, identical credentials:** `GET /password` → **403 "Access denied"** (Shopify's bot-protection page, confirmed by inspecting the response body). Token extraction fails (no form to parse). `POST /password` → also 403, zero `Set-Cookie` headers. This exactly reproduces `password_rejected_or_cookie_not_set` (technically `authenticity_token_not_found` would fire first in the real shim, but the effect — total mint failure — matches).

### Stage C — Isolating the divergence

Compared what Node's `fetch()` sends by default vs. workerd's. Node's native `fetch()` silently sends `User-Agent: node` on every outbound request (confirmed via an echo endpoint: `{"user-agent":"node"}`). Workerd's native `fetch()` sends **no `User-Agent` header at all** by default.

Added an explicit `User-Agent` header (a realistic browser UA string) to both the `GET` and `POST` in the Miniflare-against-live-store repro, keeping everything else identical:

- **With `User-Agent` added:** `GET /password` → 200, token found. `POST /password` → 302, exactly 1 `Set-Cookie` header (`_shopify_essential`), extraction succeeds. Reproduced consistently across 3 separate runs (not a fluke).
- **Without it (byte-for-byte the original shim code):** consistently 403 on both legs, reproduced again as a final confirming run before touching any code.

This isolates the User-Agent header as the sole variable that flips the outcome from 403 to 200/302.

---

## 2. Confirmed root cause

**Does NOT match the `redirect: 'manual'` hypothesis.** `redirect: 'manual'` and `Headers.getSetCookie()` both behave identically between Node and workerd — verified against a local mock (multiple cookie-count and ordering permutations) and against the live store. That hypothesis is disproven by direct repro evidence, not just deprioritized.

**Actual confirmed root cause:** the live dev store `theme-evolution-os2-hydrogen.myshopify.com` has an edge/WAF bot-protection layer that returns **HTTP 403 "Access denied"** to any request with no `User-Agent` header. Node's native `fetch()` masks this because it silently injects `User-Agent: node` on every request by default. MiniOxygen's workerd-based `fetch()` sends no `User-Agent` header at all, so every outbound request the shim makes — both the `GET /password` that fetches the authenticity token and the `POST /password` that submits the password — gets blocked at the edge before the shim's cookie-extraction logic is ever reached. The shim's `extractSetCookie()` logic, the `redirect: 'manual'` mode, and the `getSetCookie()` call were all correct and were never the defect; they simply had nothing to extract from because the request was rejected upstream of any cookie-setting logic.

This is a genuine workerd-vs-Node parity gap (different default request headers), just not the one flagged in the investigation.

---

## 3. The fix

**Files changed:**

- `app/lib/const.js` — added `DEV_SHIM_USER_AGENT`, a browser-like `User-Agent` string constant, with a comment documenting the confirmed root cause and pointing at this notes file.
- `app/lib/ucp-auth.server.js` — `mintCookie()`'s `GET /password` and `POST /password` `fetchImpl` calls now send `headers: {'User-Agent': DEV_SHIM_USER_AGENT}` (merged into the POST's existing `Content-Type` header object). Added a `DEV-ENV FIX` paragraph to the top-of-file banner documenting the confirmed cause so a future reader doesn't have to re-derive it. No other logic changed — `redirect: 'manual'`, `extractSetCookie()`, the single-flight promise, the soft TTL cache, and the invalidate-on-302 retry are all untouched, preserving the DEV-ONLY shim discipline exactly as before (hard env-gate on `password`, bounded single re-mint on 302, no logging of the password/cookie/token, loud `config_error` on any failure).
- `app/lib/ucp-auth.server.test.js` — extended (not duplicated) the existing test file:
  - `makeFakeFetch()`'s fake `fetchImpl` now records `{method, userAgent}` for every call it receives (`requestLog`), so tests can assert on what headers the shim actually sends.
  - New test **(e)**: asserts both the GET and the POST carry a non-empty `User-Agent` header. This is the test that would have caught the original bug directly — it fails if someone (or a future refactor) drops the header, independent of any particular runtime's fetch defaults.
  - New test **(f)**: feeds a fetchImpl that always returns a bare 403 with no `Set-Cookie` header (the exact response shape observed from workerd against the live store) and asserts the shim still surfaces a loud `McpError('config_error', {reason: 'password_page_unreachable'})` rather than failing silently — a regression guard for the exact failure mode, independent of whatever causes a future 403.
  - All 6 pre-existing tests (a)-(d) plus the two "password absent" / "password rejected" tests are unchanged and still pass.

**Not changed:** `redirect` mode, cookie-extraction logic (`getSetCookie()` was already correct), single-flight behavior, TTL/cache behavior, `mcp.server.js`, `mcp-normalize.js`, the route action, or any `.env`/`.env.local` file.

---

## 4. Test results

```
npx eslint --no-error-on-unmatched-pattern --ext .js,.ts,.jsx,.tsx app/lib/ucp-auth.server.js app/lib/ucp-auth.server.test.js app/lib/const.js
→ exit 0, no errors on touched files
```

```
npm run test:unit
→ node --test app/lib/mcp.server.test.js app/lib/mcp-normalize.test.js app/lib/ucp-auth.server.test.js
ℹ tests 51
ℹ suites 12
ℹ pass 51
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
(8 tests in `ucp-auth.server.test.js`: the original 6 plus new (e) and (f), all passing.)

```
npm run build
→ exit 0, "✓ built in ~1-2s" for both the client and SSR bundles, dist/server/index.js produced.
```
Note: the build emits a non-fatal `Bundle analyzer failed to analyze the bundle: TypeError: Invalid URL` / `Could not generate bundle analysis summary` warning. This is a pre-existing, unrelated issue in the bundle-analyzer plugin choking on a docblock comment elsewhere in `mcp.server.js` (not a file this task touched) — it does not affect the build exit code (confirmed `0`) or the codegen/type-validation gate.

`npm run lint` (repo-wide) still reports 72 pre-existing errors in unrelated files (`ChatAssistant.jsx`, `AccountAddressBook.jsx`, `root.jsx`, various route/component files — import ordering and Prettier formatting issues). Confirmed via `git stash` that this is pre-existing baseline debt (75 errors before this task's changes even existed on disk, including the entire uncommitted `ucp-migration` feature) — not something introduced by this fix. None of the errors are in any file this task touched.

---

## 5. Live `npm run dev` + round-trip verification

Ran `npm run dev` (port 3001; 3000 was in use). Confirmed the startup log lists all 8 env vars injected, including `DEV_STOREFRONT_PASSWORD` and `PUBLIC_UCP_AGENT_PROFILE_URL` (Issue #1 stays resolved).

Sent a live `POST /api/assistant` with `intent=search&message=snowboard` via `curl` against the running dev server (which runs the *real* `app/routes/($locale).api.assistant.jsx` → `mcp.server.js` → `ucp-auth.server.js` code path inside the actual MiniOxygen/workerd sandbox, not a repro harness). The SSR response's `actionData` contained:

```json
{"reply":"Found 8 products.","products":[{"id":"gid://shopify/Product/9356160729308","title":"The Complete Snowboard", ... "priceRange":{"min":{"amount":"699.95","currencyCode":"USD"}}, "image":{"url":"https://cdn.shopify.com/...", "altText":"..."}, "firstVariantId":"gid://shopify/ProductVariant/50239737331932", ...}, ... 7 more products]}
```

This is the shim successfully minting the cookie, clearing the password gate, and `search_catalog` returning real live catalog data — end-to-end, inside the actual dev server, not a synthetic harness. A second request (`message=jacket`) completed in ~0.5s total, consistent with the cache-hit path (no re-mint, single-flight cache working as designed). No error/shim/password-related noise in the server log. Dev server and all scratchpad mock-server processes were shut down cleanly after verification.

**This directly unblocks the Coder's documented `-32603` cart/checkout blocker from being reachable** — `search_catalog` now works live from inside the dev server, which was the prerequisite QA needed to even attempt `create_cart`/`create_checkout` and observe (or clear) that separate, store-side `-32603` condition. Whether `-32603` itself is resolved is out of scope for this task (it's a distinct, store-side issue per the investigation's own framing) and was not re-tested here.

---

## 6. Answering the task's explicit questions

- **Root cause matched the `redirect: 'manual'` hypothesis?** No. Disproven by direct repro (Stage A). The real cause is a missing `User-Agent` header triggering the live store's bot-protection 403, which happens before the shim's redirect/cookie-extraction logic is ever exercised.
- **Fix preserves DEV-ONLY shim discipline?** Yes — no changes to the env-gate, the single-flight promise, the bounded retry, or the no-logging rule. Only an additional static header on two `fetch()` calls.
- **Single-flight intact?** Yes — untouched, and test (d) (two concurrent callers → exactly one POST) still passes.
- **Scope:** Phase-1 only, no new UCP tools added, `.jsx`/JSDoc preserved (no `.tsx` conversion), `.env`/`.env.local` untouched.
