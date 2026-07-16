# QA Report: `ucp-migration` (SECOND PASS — supersedes prior report)

Date: 2026-07-08
QA agent: Claude Code (Sonnet 5)
Plan: `docs/plans/ucp-migration.md` (Revision 2, approved via `docs/reviews/ucp-migration-review-2.md`)
Impl notes: `docs/plans/ucp-migration-impl-notes.md`
Dev-env investigation: `docs/bugs/ucp-dev-env-investigation.md`
Dev-env Issue #2 fix notes: `docs/bugs/ucp-dev-env-issue2-fix-notes.md`
Fixtures: `docs/dev-fixtures.md`
This report **overwrites and supersedes** the first-pass report (`PASS WITH NITS`, blocked on two dev-env issues). Both blockers are now independently re-verified as resolved in this pass, with live evidence reaching all the way to the UCP tools, including a store-side error path.

---

## Explicit re-confirmation of the two prior nits (audit trail)

### Nit #1 — `npm run dev` did not load `.env.local` — RESOLVED (operator action), RE-CONFIRMED LIVE

- **Prior finding:** `shopify hydrogen dev --codegen`'s `--env-file` flag defaults to `.env` only; `.env.local` vars (`DEV_STOREFRONT_PASSWORD`, `PUBLIC_UCP_AGENT_PROFILE_URL`) were never injected into MiniOxygen.
- **Operator fix:** merged `.env.local` contents into `.env`.
- **Re-verification this pass:** killed a stale leftover dev-server process left over from a prior session (was silently occupying port 3000), then started a fresh `npm run dev` from a clean state. The startup log's "Environment variables injected into MiniOxygen" section now lists **8** vars, including both previously-missing ones:
  ```
  SESSION_SECRET                          from local .env
  PUBLIC_STOREFRONT_API_TOKEN             from local .env
  PUBLIC_STORE_DOMAIN                     from local .env
  PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID   from local .env
  PUBLIC_CHECKOUT_DOMAIN                  from local .env
  SHOP_ID                                 from local .env
  DEV_STOREFRONT_PASSWORD                 from local .env
  PUBLIC_UCP_AGENT_PROFILE_URL            from local .env
  ```
- **Verdict:** Confirmed resolved on a stock `npm run dev` per `CLAUDE.md`'s documented procedure — no QA-side env-file workaround was needed this time (unlike pass 1).

### Nit #2 — Shim's `/password` round trip failed inside MiniOxygen/workerd (missing `User-Agent`) — RESOLVED (code fix), RE-CONFIRMED LIVE END-TO-END

- **Prior finding:** the dev store's bot-protection returns 403 to requests with no `User-Agent` header; workerd's native `fetch()` sends none by default (unlike Node's, which silently sends `User-Agent: node`), so the shim's `GET/POST /password` calls were blocked before ever reaching the cookie-extraction logic.
- **Coder fix:** `app/lib/ucp-auth.server.js`'s `mintCookie()` now sends an explicit `User-Agent: DEV_SHIM_USER_AGENT` (`app/lib/const.js`) header on both the `GET /password` and `POST /password` legs.
- **Re-verification this pass (independent, not just re-reading the fix notes):**
  1. Confirmed via `curl` that a manually-replicated shim round trip (`GET /password` → extract `authenticity_token` → `POST /password` with a browser `User-Agent`) against the live store returns `HTTP/2 500`-class responses are unrelated — the password/cookie mint itself succeeds: 302 + `Set-Cookie: _shopify_essential=...`.
  2. **Ran the real code path inside the actual dev server** (not a repro harness): `curl -X POST http://localhost:3000/api/assistant` with `intent=search&message=snowboard` returned a full SSR document with `actionData` containing 8 real UCP catalog products — this is only possible if the shim successfully minted the cookie and `search_catalog` succeeded past the password gate, inside the real MiniOxygen/workerd sandbox.
  3. **Drove the identical flow through the browser via Playwright** (see "Live `search_catalog` evidence" below) — the shopping-assistant dialog returned real results with zero `config_error` and zero console errors.
- **Verdict:** Confirmed resolved. No `config_error` was observed anywhere in this session's server log except for the deliberate absence of a documented pre-existing case (none occurred). The single `[mcp] ...` server log line produced this session was `http_error status=500 tool=create_cart` — a store-side condition, not a shim/env failure (see below).

---

## Environment / setup

- Found and killed a stale `shopify hydrogen dev` process (PID from an earlier, unrelated session) that was silently listening on port 3000 before this session started. This is an environment-hygiene note, not a defect — flagging it because it could otherwise mask a "clean start" test with cached/stale server state. Restarted cleanly on port 3000 per `CLAUDE.md`.
- Dev server: `npm run dev` (`shopify hydrogen dev --codegen`), per `CLAUDE.md`. Runs at `http://localhost:3000`.
- Storefront connection: `theme-evolution-os2-hydrogen.myshopify.com`, matching `CLAUDE.md`.
- No application code, `.env`, or `.env.local` was edited by QA. `.env` was only read (never written) to confirm the operator's merge.
- `docs/dev-fixtures.md` confirms Hydrogen previews do not require a storefront-password gate for the local dev server itself (`localhost:3000` is directly reachable) — the storefront password in this feature is a _different_ concern: the **UCP MCP endpoint** (`/api/ucp/mcp`) on the connected Shopify store is itself password-gated, which is exactly what the DEV-ONLY shim exists to work around.

## Five-check CLAUDE.md baseline

1. **HTTP smoke test:** `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` → `200`. PASS.
2. **Browser / hydration check:** Homepage: 0 console errors, 2 pre-existing/unrelated prefetch warnings (`Tried to prefetch /collections/frontpage but no routes matched`, present on a stock homepage load, unrelated to the assistant). Shopping-assistant dialog open → search → results → add-to-cart-error flow: 0 console errors, 0 console warnings, throughout. PDP (`the-complete-snowboard`): 1 pre-existing `console.error`-classified React DOM-attribute warning (`preserveControl`/`preservecontrol`), confirmed via `git log` to originate from an unrelated prior commit (`b43d959`) in a file this migration never touches — same finding as pass 1, re-confirmed, not a migration regression, not a hydration mismatch (it's a prop-name warning, not a client/server markup divergence).
3. **Product page check:** `the-complete-snowboard` renders correctly — image, title, vendor ("Snowboard Vendor"), 5 color variant links, "Add to Cart", "Buy with Shop Pay", 11-item related-products grid with images and prices. Unaffected by this migration (no GraphQL changes, confirmed by unchanged `storefrontapi.generated.d.ts`/`customer-accountapi.generated.d.ts` after `npm run build`).
4. **Build check:** `npm run build` independently re-run by QA this pass (not just re-quoted from impl notes). Exit code **0**. Both client and SSR bundles built (`✓ built` logged twice), `dist/server/index.js` produced. Generated GraphQL type files show no diff. The same non-fatal cosmetic "Bundle analyzer failed to analyze the bundle" / `ENOENT: ... metafile.server.json` warning documented in the impl notes and fix notes reproduced identically — confirmed non-blocking (build exit code 0 regardless).
5. **Lint check:** Full-repo `npx eslint` → 72 pre-existing errors, **zero** in any file this migration touched. Scoped lint command against exactly the migration's file list → exit 0, no output. Both independently re-run this pass. PASS.

## Live `search_catalog` evidence — reached this pass (the coverage pass 1 could not reach)

Drove the full flow with the **Playwright MCP**: navigated to `http://localhost:3000`, clicked "Open shopping assistant," typed "show me snowboards under $1000," clicked "Send."

- **Result:** "Found 8 products." rendered in the dialog with 8 real product cards — real titles (The Compare at Price Snowboard, The Hidden Snowboard, The Videographer Snowboard, The Out of Stock Snowboard, The Multi-location Snowboard, The Complete Snowboard, and two Collection Snowboard variants), real `<Money>`-rendered prices ($785.95, $749.95, $885.95, $885.95, $729.95, $699.95, $749.95, $749.95), real `cdn.shopify.com` images, and "Add to cart" buttons.
- **Network response body** (`POST /api/assistant`, captured via Playwright network inspection) confirms every product has: a real UCP product `id` (`gid://shopify/Product/...`), a complete `priceRange.min`/`max` in **decimal major-unit** strings with `currencyCode: "USD"` (correct per plan §6.5 — UCP minor units converted to decimal for the browser-facing `AssistantProduct` shape), a complete `image` object (`url` + non-empty `altText`), and a real `firstVariantId` (`gid://shopify/ProductVariant/...`). No null/undefined/stubbed/placeholder fields anywhere in the 8-product payload.
- **Server-rendered HTML confirmed:** `curl http://localhost:3000/` returns full markup (nav, hero collection, product grid, footer) — not an empty root div. `view-source`-equivalent `curl` of the assistant POST itself returns a complete SSR document with `actionData` embedded in `window.__remixContext`, proving the Remix action round-trip is real, not client-only.
- **Console:** 0 errors, 0 warnings on the entire search flow (checked immediately after page load, dialog open, and after the search response rendered).
- **No React hydration warnings** anywhere in this flow.
- Screenshot: `docs/qa/screenshots/ucp-migration-search-results-live.png`.

### Analytics Contract — verified with real fired-event data, not just static code review

- `app/components/AssistantProductCard.jsx` uses `<Analytics.ProductView>` (confirmed correct component name — **not** the non-existent `Analytics.ItemView`) with a `{products: [ProductPayload]}` payload, gated on `firstVariantId` being present.
- **Captured the actual outbound Monorail analytics beacon** (`POST https://monorail-edge.shopifysvc.com/unstable/produce_batch`) fired by the browser after the search results rendered and inspected its request body:
  ```json
  {
    "event_name": "product_page_rendered",
    "products": [
      "{\"product_gid\":\"gid://shopify/Product/9356160893148\",\"name\":\"The Compare at Price Snowboard\",\"variant\":\"Default Title\",\"brand\":\"Unknown\",\"price\":785.95,\"quantity\":1,\"variant_gid\":\"gid://shopify/ProductVariant/50239737790684\",\"product_id\":9356160893148,\"variant_id\":50239737790684}"
    ]
  }
  ```
- `variant_gid` is a real, valid GID matching the card's `firstVariantId` exactly — **not null, not undefined, not a placeholder**. `price` is a real numeric value matching the rendered `<Money>` amount. 17 total Monorail beacon requests fired for the page, consistent with 8 `Analytics.ProductView` events plus standard page-view/session events.
- `vendor` is the literal string `"Unknown"` by deliberate design (documented in `mcp-normalize.js:157-162`): UCP's `search_catalog` does not expose a vendor field at all; the normalizer supplies a **truthy** placeholder specifically because Hydrogen's Analytics drops the event entirely on a falsy `vendor` (`if (!product.vendor)`). This is an honest "field genuinely absent from the source" state, not fabricated data, and is exactly what the plan's §6.7 Analytics Contract review anticipated. Not a defect.
- **Verdict:** Analytics Contract fully satisfied with live, real, non-null `variantId` data — confirmed via the actual fired network beacon, the strongest form of evidence available for this claim.

## Cart/checkout path (`create_cart`/`update_cart`/`create_checkout`) — reached live, store-side error reproduced and independently attributed

Clicked "Add to cart" on the first search result ("The Compare at Price Snowboard," `firstVariantId = gid://shopify/ProductVariant/50239737790684`) in the live browser session.

- **UI result:** a clean `alert`-role element appeared inside the dialog: **"Unable to reach the shopping service."** No crash. No React error boundary triggered. No hydration break. The product list stayed rendered and interactive. The "Send" textbox/button remained functional. The site's own cart badge stayed at "0" (confirms the dual-cart design — the assistant's cart failure did not touch or fake-populate the site's real Hydrogen cart).
- **Console:** 0 errors, 0 warnings during and after this failure — the error was handled entirely as a normal fetcher JSON response, never thrown as an exception.
- **Network:** `POST /api/assistant` (intent=add) → **HTTP 200** with body `{"error":{"type":"http_error","message":"Unable to reach the shopping service."}}`. A clean, typed, user-facing error — not a stubbed/fake cart pretending to succeed.
- **Server log:** `[mcp] http_error status=500 tool=create_cart` — confirming the underlying `/api/ucp/mcp` call for `create_cart` returned a raw HTTP 500.
- **Independent live reproduction via direct `curl`** (bypassing the app entirely, replicating the shim's exact mint-then-call sequence by hand against the real store): confirmed the exact same failure, with the full response body:
  ```
  HTTP/2 500
  {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error","data":"Internal error calling tool create_cart: Core client error"}}
  ```
  This is the **identical** `-32603 "Core client error"` the Coder documented in the impl notes, reproduced independently by QA in this session, from a completely separate HTTP client (not the app, not a repro harness) — strong corroboration this is a real, store-side, reproducible condition and not an artifact of any particular code path.

### Code-vs-store attribution

- **This is store-side, not a code defect.** Evidence:
  1. `search_catalog` (same store, same shim, same session) succeeds consistently and returns fully-formed data — rules out a broken shim, wrong cookie, wrong domain, or wrong credential.
  2. The independent `curl` reproduction used a hand-built, minimal request body matching the plan's §5.3 schema (`cart.line_items[].item.id` + `quantity`) with a known-valid, live variant GID pulled directly from the search results — ruling out a malformed-request-shape explanation. A malformed request against this store surfaces as a distinct, differently-worded `-32602`/schema-validation error (observed and documented separately for `create_checkout`'s `line_items` requirement in the impl notes) — not this generic `-32603 "Core client error"`.
  3. `mcp.server.js::callTool()`'s error-handling code is correct and intentional here: a raw HTTP 500 is caught by the `!res.ok` branch (line 171) **before** the JSON-RPC body is ever parsed, so it is logged and mapped as `McpError('http_error', {status: 500})` rather than `McpError('rpc_error', {...})`. **Correction (2026-07-09, per `docs/bugs/ucp-cart-32603-fix-notes.md`, the authoritative account):** the `-32603` on this store is confirmed to always arrive as **HTTP 500 carrying a JSON-RPC `-32603` body**, not a 200-body JSON-RPC error — the earlier framing here ("which of the two transport shapes is it") is resolved, not ambiguous. The impl notes' original envelope documentation (200-body) described the _general_ Dev MCP-documented shape for protocol errors, not this specific store-side failure. The client code already handles either shape correctly regardless (`http_error` covers non-ok statuses; a hypothetical 200-wrapped `-32603` is separately unit-tested and correctly falls through to `rpc_error`, not misclassified as `rate_limited`), so this correction is factual-accuracy only, not a new defect. The route's `mapMcpError()` has a defined case for `http_error` producing exactly the clean message observed live. No gap, no crash, no silent failure in the client code either way.
  4. No documentation of a required cart/checkout prerequisite (e.g., Shopify Payments provisioning) was found via the Shopify Dev MCP by either the Coder or this QA pass.
- **Conclusion:** the `-32603`/HTTP-500 `create_cart` failure is a **store-side UCP-preview validator/resolver contradiction on ProductVariant GIDs** on `theme-evolution-os2-hydrogen.myshopify.com` — the validator demands a `gid://shopify/ProductVariant/<id>` (rejecting numeric ids and Product GIDs as invalid), while the resolver crashes with `-32603` on that exact shape (reproduced across 6 products; byte-identical crash in `create_checkout`). **No client-side fix is possible.** (Root cause refined 2026-07-09 in `docs/bugs/ucp-cart-32603-fix-notes.md`, which supersedes the earlier, less-precise "store-side condition, cause unknown" framing and the now-overturned "client-fixable" hypothesis in `docs/bugs/ucp-cart-32603-investigation.md`.) Per the task's guidance, this does **not** fail the migration itself. The application code's handling of it (clean typed error, graceful UI degradation, no stub data, no crash) is itself evidence the migration was implemented correctly for this failure mode — however, **Phase-1 cart/checkout parity is blocked upstream (not by our code)** until Shopify resolves the store-side contradiction; see the fix notes for the full probe matrix and the operator recommendation to report this to Shopify UCP/platform support.
- **Note for the operator:** `update_cart` (with a valid existing cart) and `create_checkout` were not separately live-probed to a successful response in this session (no cart could be created to update, and `create_checkout`'s fallback path only fires when a cart lacks `continue_url` — moot without a cart). This matches the exact same reachability boundary the Coder's own probes hit. Once the store-side condition is resolved, a follow-up pass should exercise `update_cart` (two-item carry-forward) and the `continue_url`-preferred handoff explicitly, since those remain unit-tested-only paths.

## Unit tests — independently re-run this pass

```
node --test app/lib/mcp.server.test.js app/lib/mcp-normalize.test.js app/lib/ucp-auth.server.test.js

ℹ tests 51
ℹ suites 12
ℹ pass 51
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All 51 tests pass (up from the pre-fix 49 — the two new User-Agent/bot-block regression tests from the Issue #2 fix are present and passing). Specifically confirmed present and passing:

- `-32000-in-body path (MANDATORY, change #5): a 200 response with a JSON-RPC -32000 error AND a Retry-After header maps to rate_limited with retryAfterMs, NOT a generic rpc_error` — PASS.
- `non-rate-limit JSON-RPC error (e.g. -32603) still maps to generic rpc_error` — PASS. Directly relevant: proves the client-side mapping for this exact error code is correct when it arrives in a 200-body JSON-RPC envelope (the live reproduction this pass instead saw it wrapped in an HTTP 500 status, which the `!res.ok`/`http_error` branch — also tested — handles equally cleanly).
- `non-429 HTTP error status throws http_error McpError` — PASS. This is the exact branch that fired live in this session's `create_cart` reproduction.
- `(d) single-flight concurrency: two concurrent callers with no cached cookie trigger exactly ONE /password POST and both receive the same cookie` — PASS.
- `(e) sends a non-empty User-Agent header on both the GET and the POST (dev-env Issue #2 regression guard)` — PASS. This is the regression test that would catch a future reintroduction of nit #2.
- `(f) a workerd-style bot-protection 403 (no Set-Cookie at all) surfaces as a loud config_error, not a silent failure` — PASS.
- `callTool — 302 password-gate retry`: both the successful-remint-then-retry and the persistent-302-throws-config_error (bounded, not infinite) cases — PASS.
- `normalizeCart` totals-rewrite tests (including the decoy `.cost` field proving the retired path is dead) — PASS.

## Shim discipline (read-only review)

- `app/lib/ucp-auth.server.js`: clear top-of-file `DEV-ONLY — NEVER SHIP TO PRODUCTION` banner, `.server.js` suffix (never bundled client-side, confirmed by the file never appearing in any client-side network request in the Playwright network log).
- Hard gate confirmed by reading source: `ensureStorefrontDigest()` throws `McpError('config_error', {reason: 'dev_storefront_password_missing'})` immediately if `password` is falsy — no silent no-op, no default cookie.
- `mcp.server.js::callTool()` has a redundant second hard gate at the call site before ever invoking the shim.
- 302-retry is bounded via an `_isRetry` flag — a second 302 after a fresh mint raises `config_error` rather than looping (confirmed both by reading the code and by the passing "persistent 302 ... throws config_error" unit test).
- **No logging of the password, cookie, or authenticity token anywhere.** `grep -n "console\." app/lib/ucp-auth.server.js` → zero matches — the module is completely silent. `mcp.server.js` logs only `[mcp] <error-type> status=<n> tool=<name>` — confirmed exactly this shape in the live server log this session, with no payload/cookie/query content leaked.
- `env.d.ts` declares `DEV_STOREFRONT_PASSWORD?: string` (optional — correctly modeling "may be legitimately absent in production") and `PUBLIC_UCP_AGENT_PROFILE_URL: string` (required).
- Production behavior: with the password env var absent and no signer configured (Phase 2, not yet built), both gates raise a loud `config_error` rather than looping — this is the correct, verified-safe behavior for "no shim, no signer" in production per plan §3.4/§4.4.

## Defects / nits found this pass

### Nit A — Pre-existing PDP console warning (Low, out of scope, not a regression, re-confirmed from pass 1)

- **Reproduction:** Navigate to `http://localhost:3000/products/the-complete-snowboard`. Console shows a React `console.error`-classified warning: `Warning: React does not recognize the preserveControl prop on a DOM element...`, originating in `app/routes/($locale).products.$productHandle.jsx` → `ProductForm` → `Link` → `LinkWithRef`.
- **MCP used:** Playwright (`browser_console_messages`).
- **Attribution:** `git log` confirms this file's last touching commit (`b43d959`, "fix(product-route): use Remix Link `search` prop for variant URLs") predates and is unrelated to the `ucp-migration` diff; `git status` confirms the file is untouched by this migration. Not a migration regression. Note: Playwright classifies this as a console **error** (not warning) because React's invalid-DOM-attribute check logs via `console.error` internally — worth flagging precisely so the severity isn't understated, but it remains pre-existing and out of scope for this migration's verdict.

### Nit B — `create_cart`/`create_checkout` `-32603` arrives as HTTP 500, not HTTP 200-with-JSON-RPC-error as the impl notes' envelope framing implied (Low, documentation-precision only, code already handles it correctly)

- **Observation:** the impl notes' §6.2 envelope documentation states protocol errors "are returned as JSON-RPC error with code -32000, or -32001 for discovery errors" arriving in a 200 body (per Dev MCP docs), and the unit tests model `-32603` the same way (200 body). This session's live reproduction — both through the app and via an independent raw `curl` — observed the `-32603 "Core client error"` on `create_cart` arriving wrapped in a raw **HTTP 500** status, not HTTP 200.
- **Impact:** none functionally — `mcp.server.js::callTool()`'s `!res.ok` branch (line 171) correctly catches any non-2xx status before attempting to parse a JSON-RPC error object, logs it, and maps it to `McpError('http_error', {status})`, which the route maps to a clean "Unable to reach the shopping service." message. This is a **correct and already-tested** code path (`non-429 HTTP error status throws http_error McpError`), just a different one than the specific `-32603`-in-200-body unit test targets. No code change is needed; this is purely a documentation-precision nit for whoever next investigates the store-side `-32603` condition, so they know to expect either transport shape.
- **MCP used:** Playwright (browser flow) + direct `curl` (independent reproduction, no MCP).
- **Attribution:** Store-side (see full attribution above). Not a code defect. Not a migration regression.

No other defects found. No Anti-Stubbing violations. No hydration mismatches. No Analytics Contract violations. No secrets/PII leakage.

## Console errors and warnings (consolidated)

- Homepage: 0 errors, 2 pre-existing/unrelated prefetch warnings.
- Assistant dialog — open/search/results/add-to-cart-error flow: 0 errors, 0 warnings throughout.
- Product page (`the-complete-snowboard`): 1 pre-existing, out-of-scope `preserveControl` warning (console.error-classified), no hydration-mismatch warnings.

## Network failures and slow responses

- `POST /api/assistant` (search intent, browser): 200 OK, ~624ms cold via browser fetcher; ~326ms warm via a follow-up curl (cache-hit path, no re-mint). Consistent with the fix notes' own measured timings.
- `POST /api/assistant` (add intent, browser): 200 OK (200 status, error payload in body — correct REST/JSON-RPC-over-HTTP-action discipline, not a raw 500 surfaced to the browser), ~406ms.
- Direct `/api/ucp/mcp` `create_cart` probe (raw curl, bypassing the app): HTTP 500, store-side, ~repeatable.
- No 404s on static assets observed on homepage, assistant flow, or PDP.
- No CSP violations observed. 17 Monorail analytics beacons fired successfully (200 OK) during the search flow.

## Accessibility observations

- Assistant dialog: `role="dialog"` with accessible name "Shopping assistant," labelled textbox ("Message to shopping assistant"), error states render inside an `alert`-role element. Confirmed via Playwright accessibility-tree snapshot, no ARIA warnings.
- "Send" button correctly disabled when the input is empty, enabled with text present, and remains enabled/interactive after both a `config_error`-class and an `http_error`-class response (no stuck/dead UI state observed in either failure mode).
- Product cards render semantic `heading` (h3) + price + button structure; "Add to cart" buttons correctly disabled/labeled "Sold out" for unavailable variants per the `available` flag (not exercised live this session since all 8 returned products were available, but confirmed present in the component's conditional render logic).

## Performance notes

- No Performance-trace escalation to Chrome DevTools MCP was needed. Playwright's network timing was sufficient: all `/api/assistant` round trips completed in under 1.3s (cold) / under 700ms (warm), well within acceptable bounds for a chat-style interaction. No rate-limiting (`429`/`-32000`) was encountered live in this session (not surprising given light, sequential single-user testing).

## Screenshots

- `docs/qa/screenshots/ucp-migration-search-results-live.png` — full-page screenshot of the shopping assistant dialog showing 8 live UCP `search_catalog` results with real images, prices, and "Add to cart" buttons (this pass's new evidence, reaching the coverage pass 1 could not reach).
- `docs/qa/screenshots/ucp-migration-cart-error-live.png` — the clean `alert`-role "Unable to reach the shopping service." error state after clicking "Add to cart," demonstrating graceful degradation on the store-side `-32603`/HTTP-500 condition (this pass's new evidence).
- `docs/qa/screenshots/ucp-migration-config-error.png` — retained from pass 1 for continuity (the `config_error` state that pass 1 was stuck on before the env/shim fixes; no longer reproducible on a clean run, kept as historical record of what was fixed).

## Summary

- **Both prior nits are re-confirmed resolved with fresh, independent live evidence in this pass**, not just re-read from the fix notes: nit #1 via the dev server's own startup log on a clean restart; nit #2 via an independent `curl` shim replication, a real end-to-end `curl` through the actual running app, and a full Playwright browser drive of the assistant UI, all agreeing.
- **`search_catalog` was exercised live, end-to-end, through the real browser UI** — the exact coverage gap pass 1 flagged. Real data confirmed at every layer: server-rendered HTML, network response body, rendered DOM, and the fired Analytics beacon's `variant_gid`/`price` fields. Zero console errors, zero hydration warnings, zero stubbed/placeholder data.
- **The cart/checkout path was exercised live and its failure mode independently reproduced and attributed to the store**, not the client. The application code's handling of that failure (typed error, clean UI degradation, dual-cart integrity preserved, no crash) is itself further evidence the migration is correct.
- **51/51 unit tests pass**, independently re-run, including every review-driven required-change test and both new dev-env-fix regression tests.
- **Lint and build independently re-verified**: zero lint errors in migration files, `npm run build` exits 0 with generated types unchanged.
- **Shim discipline confirmed by direct source review and live server-log inspection**: DEV-ONLY, hard-gated, no logging leakage, bounded retries, single-flight concurrency.
- **No code regression, Anti-Stubbing violation, hydration break, or Analytics Contract violation was found.** The two nits raised (a pre-existing unrelated PDP warning, and a documentation-precision note about the `-32603` transport shape) are both non-blocking.

The migration is functionally complete and verified live for everything reachable on this dev store. The only remaining gap is the store-side `-32603`/HTTP-500 condition on `create_cart`/`create_checkout`, which is outside the application code's control, independently reproduced by two different investigators via two different HTTP clients, and handled correctly (gracefully) by the migrated code when it occurs. **Root-cause update (2026-07-09):** per the authoritative `docs/bugs/ucp-cart-32603-fix-notes.md`, this is specifically a store-side UCP-preview validator/resolver contradiction on ProductVariant GIDs with no client-side fix possible — Phase-1 cart/checkout parity for this store remains blocked upstream pending a Shopify-side resolution.

PASS WITH NITS

---

## Root-cause reconciliation (2026-07-10) — supersedes the "validator/resolver contradiction, pending upstream fix" framing above

The `-32603` cart/checkout root cause is now definitively identified and corroborated by two public Shopify community threads (see `docs/bugs/ucp-cart-32603-fix-notes.md` → "RESOLUTION (2026-07-10)"). It is **not** a Shopify code bug awaiting a patch and **not** a "validator/resolver contradiction":

- **Cause:** `create_cart`/`create_checkout` require the store's **agentic commerce sales channel** to be provisioned. On a dev store that channel only becomes available once the store is **published AND storefront-password protection is removed**. Unprovisioned, the resolver crashes with an unhandled `-32603` instead of a clean error.
- **Corroboration:** thread #34081 (byte-identical crash, OP fixed it via publish + password-off; _"the agentic channel was not available in our store"_) and thread #34499 (Shopify staff: _"no supported way to make that merchant scoped UCP MCP endpoint publicly accessible while keeping the storefront password enabled"_).
- **Ticket #68842755:** Shopify's "expected on a password-protected store" answer was directionally correct; the specific mechanism (agentic-channel prerequisite) was confirmed via the forum threads. Fresh 2026-07-10 reproductions with server-side `x-request-id`s were sent as product-quality feedback on the crash-vs-clean-error behavior — not a fix request.

**Effect on this report's verdict:** unchanged — **PASS WITH NITS** still holds. The migration code is correct; cart/checkout parity is blocked on `theme-evolution-os2-hydrogen` by a store **prerequisite** (password off + agentic channel provisioned), not by our code and not by a pending Shopify fix. Every other statement in this report stands; only the _characterization_ of the cart/checkout blocker is refined here.
