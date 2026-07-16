# Plan Review: `ucp-migration`

Reviewer: Plan-Reviewer (adversarial, read-only)
Date: 2026-07-08
Plan under review: `docs/plans/ucp-migration.md`
Verdict: see last line.

I did NOT write this plan and approached it skeptically. I read the plan in full, the ground-truth `docs/plans/ucp-tools-list.json`, the retired `mcp-shopping-assistant` impl-notes, the memory note, and the live code being migrated (`app/lib/mcp.server.js`, `app/lib/mcp-normalize.js`, `app/routes/($locale).api.assistant.jsx`, `app/components/AssistantProductCard.jsx`, `app/components/ChatAssistant.jsx`, `app/lib/const.js`). I independently verified the UCP envelope, auth-tier, idempotency, and Hydrogen Analytics claims via the Shopify Dev MCP rather than trusting the plan's assertions.

## Summary

This is a genuinely strong plan. The Architect learned the exact lessons from the retired attempt: the `structuredContent`-vs-`content[0].text` inversion that broke Revision 2 is explicitly flagged as the highest-risk item (AL-UCP-1) and gated behind a live probe rather than hard-coded, and the make-or-break cookie question (AL-UCP-3) is called out as a STOP condition. The Component Contract enumeration in §5.1 matches `ucp-tools-list.json` exactly. The Analytics Contract is correct (no `Analytics.ItemView`). The DEV-ONLY shim discipline is well thought through.

My independent verification confirmed the plan's most load-bearing claims are accurate, which is reassuring given the retired attempt failed on exactly these. However there are several concrete gaps that must be folded in before implementation — most importantly the ordering/ownership of the make-or-break probe versus the operator-supplied env var, a factual error in §5.3 about the `search_catalog` `required` array, an over-broad claim about idempotency in §5.4, and an unresolved seam around the removal of the `"detail"` intent. None of these rise to REJECT, but they are not optional polish.

## Independent verification (Dev MCP, 2026-04 / UCP 2026-04-08)

Confirmed accurate in the plan:

- **UCP envelope (AL-UCP-1 target).** Dev MCP Cart MCP docs: _"The cart is returned in `result.structuredContent`. The `result.content` array may also be present with a text representation of the cart."_ The documented Cart response literally shows BOTH `result.structuredContent.cart` AND a `result.content[0].text` stringified copy co-existing. The plan's "parse `structuredContent` primary, defensive `content[0].text` fallback" (§6.2) is exactly right. Business outcomes are a successful `result` with a `messages[]` array; protocol errors are JSON-RPC `error` code `-32000` (`-32001` for discovery). All matches §6.2.
- **Auth tiers / RFC 9421.** Confirmed Token > Signed > Anonymous; Cart tools accept unauthenticated (Anonymous) requests; Signed uses HTTP Message Signatures (RFC 9421); `complete_checkout` needs a token granted purchase permission; `get_order` needs `read_global_api_orders`. §4.4 is accurate.
- **Minor units everywhere + `totals[]` not `cost` (AL-UCP-5).** Dev MCP: _"Minor currency units apply to every amount"_ and _"Cart/checkout pricing lives in `result.totals[]`; there is no `result.cost` field."_ §6.5's simplification claim is correct, and the current `normalizeCart` reading `cart.cost.total_amount` (mcp-normalize.js:296) WILL break against UCP — the plan correctly identifies this.
- **Full-replace `update_cart` (§6.4).** Dev MCP: _"`update_cart`: Replace the cart's contents"_ and _"cart update is full-replace: always carry forward the entire `line_items` array."_ Correct, and the data-loss risk is real.
- **Catalog product shape (AL-UCP-4).** Dev MCP Global Catalog response confirms `structuredContent.products[]` with `id: gid://shopify/p/...`, `variants[].id: gid://shopify/ProductVariant/...`, `price_range.min.{amount,currency}` (minor units), `variants[].availability.available`, and `media[].url`. The plan's assumed field paths are doc-backed; the probe is a sensible confirmation, not a shot in the dark.
- **Analytics namespace.** Dev MCP `useAnalytics` docs enumerate Provider, ProductView, CollectionView, CartView, SearchView, CustomView. No `ItemView`. §6.7 is correct.
- **Idempotency (partial — see finding 3).** `complete_checkout` requires `meta.idempotency-key`. Confirmed in `ucp-tools-list.json` AND Dev MCP. But the plan's §5.4 prose about `cancel_checkout`/`cancel_cart` needs correction (below).

## Correctness

The migration solves the stated problem (move off deprecation-flagged `/api/mcp` to `/api/ucp/mcp` before the 2026-08-31 sunset) and the design is sound. The trust boundary, `.server.js` discipline, and no-LLM-planner routing are carried forward correctly. The normalizer simplification (single minor-units path) is a real improvement over the two-path divergence the current code carries. The verification section includes both `npm run build` and `npm run lint` (§10.2 items 4–5) — the required type/lint gate is present.

## Required changes

### 1. The make-or-break probe (AL-UCP-3) is blocked on an operator action the Coder cannot self-satisfy — resolve the ordering explicitly

§9 step 1a tells the Coder to run the AL-UCP-3 probe FIRST ("If it does not return 200, STOP and escalate"). But that probe requires the storefront password, and §5.2 / OQ-U2 say the password lives in `.env.local` / `docs/dev-fixtures.md` and is an operator concern the Coder does not control. The plan never states that OQ-U2 must be satisfied _before_ the Coder starts — it lists it as an open question to "get operator answers for" in the same step that depends on it. Per the project's file-based-handoff / no-chaining rule, this is a sequencing hazard: the Coder could begin, discover the env var is absent, and stall.

Make OQ-U2 (and confirmation that `docs/dev-fixtures.md` contains the current dev-store password) an explicit **pre-implementation gate** at the top of §9, owned by the operator, resolved before the Coder is dispatched — not a step the Coder performs. State that if the password is absent the plan does not proceed to implementation at all.

### 2. AL-UCP-3 has no documented fallback if the cookie does NOT clear the 302 — add one

The plan says "escalate to the operator" if the cookie fails, but gives the operator nothing actionable. This is the single highest risk (the retired attempt died here) and the memory note explicitly lists _"until the password is removed or a path exception is configured (operator concern)"_ as the only known unblocks. If `storefront_digest` alone does not satisfy the `/api/ucp/mcp` gate (plausible — the endpoint may key off a different session cookie, a Bearer, or a storefront access token rather than the Liquid password cookie), Phase 1 is dead on this store. The plan must document the fallback branch concretely: (a) operator removes the storefront password / configures a path exception, or (b) defer the entire migration until a paid tier / signed-request path exists. Without a written fallback, "escalate" is hand-waving on the exact axis the last attempt failed.

### 3. §5.4 overstates the idempotency requirement for `cancel_cart` / `cancel_checkout` — correct the prose

§5.4 says _"the Cart MCP docs prose states `cancel_cart` MUST include `meta['idempotency-key']`"_ and logs the schema-vs-docs conflict as AL-UCP-8 to resolve by probe. I verified the live Dev MCP Cart MCP docs: _"For `cancel_cart`, you must also include `meta['idempotency-key']` with a unique UUID for retry safety."_ — so for **`cancel_cart`** the docs prose is real. BUT the Checkout MCP docs say _"For `complete_checkout` and `cancel_checkout`, you must also include `meta['idempotency-key']`"_ — i.e. the docs DO require the key on `cancel_checkout`, contradicting the plan's claim that only `complete_checkout` needs it among checkout tools. Meanwhile `ucp-tools-list.json` requires only `ucp-agent` on both cancel tools. This is a three-way schema-vs-docs-vs-docs discrepancy, worse than the plan states. Since all of this is Phase 2, it is not a blocker, but AL-UCP-8 should be corrected to reflect that BOTH cancel tools have a docs-vs-schema conflict and the Checkout docs explicitly require the key on `cancel_checkout`. Do not let the current understated wording propagate into a Phase 2 plan the way the `ItemView` error propagated last time.

### 4. §5.3 mis-states the `search_catalog` `required` array — factual error against ground truth

§5.1's table and §5.3 are mostly exact, but note the ground truth: in `ucp-tools-list.json`, `search_catalog` has top-level `required: ["meta","catalog"]` (§5.1 states this correctly) — however the `catalog` object itself has NO `required` array (query and filters are both optional; the tool description says "At least one of query or filters must be provided" as prose, not schema). The plan's §5.3 body is fine, but the Coder should be told that `catalog.query` is not schema-required (the server enforces query-or-filters at runtime), so an empty-message guard must stay in the action (it already does — route line 78). Minor, but call it out so the Coder does not assume schema validation will catch an empty query.

### 5. Removal of `getProductDetails` / the `"detail"` intent is under-specified — an integration seam is left dangling

§4 says `mcp.server.js` will "Replace `getProductDetails`/`getCart` (standard-tool exports) with the Phase-1 UCP exports." But the live route `($locale).api.assistant.jsx` has a `"detail"` intent (lines 109–124) that calls `getProductDetails` + `normalizeProductDetail`, and imports both (lines 6–14). The plan's §4 "Modified files" entry for the route (line 179) only mentions the `"add"` intent and the stale-cart path — it never says what happens to the `"detail"` intent or its imports. UCP's product-detail tool is `get_product` (Phase 2, explicitly out of scope per §2 line 50). So Phase 1 will either leave a dead `"detail"` intent importing a deleted function (build break — violates the pre-save audit rule about unresolved imports) or silently drop a feature. The plan must state explicitly: is the `"detail"` intent removed, stubbed to a graceful "not available" response, or retained against `/api/mcp` temporarily? Whatever the choice, it must be named so the Coder does not leave an unresolved import and so this does not count as an Anti-Stubbing violation (removing the intent is fine; commenting it out to dodge a TypeError is not). Note `normalizeProductDetail` and `normalizeProductDetailsMoney` in mcp-normalize.js become dead code too — say whether they are deleted.

### 6. AL-UCP-13 (rate-limit shape) should not keep the HTTP 429 branch on faith

§6.5/AL-UCP-13 keeps the existing HTTP-429 + `Retry-After` branch AND adds a `-32000` mapping. Good instinct, but the Dev MCP is explicit that UCP surfaces rate-limiting via the JSON-RPC `-32000` protocol error while _also_ honoring the HTTP `Retry-After` header. The current `callTool` throws on `res.status === 429` BEFORE parsing the body (mcp.server.js:88), so a `-32000`-in-a-200-body rate-limit would bypass that branch entirely. The plan should instruct the Coder to read `Retry-After` in BOTH places (HTTP status 429 path and the `-32000` body path) and unit-test the `-32000`+`Retry-After` combination, not just carry the existing 429 test forward. As written, §10.4 only lists "the 429/`Retry-After` branch," which risks leaving the more-likely `-32000` path untested.

### 7. Cookie single-flight / concurrency (AL-UCP-10) is "resolve during coding" but is a correctness issue, not an ambiguity

AL-UCP-10 and the §7 medium risk correctly identify that a module-level cookie shared across concurrent in-flight requests can be invalidated mid-flight, and AL-UCP-10's resolution ("serialize minting with an in-flight promise") is the right pattern. But this is design, not an unknown to probe — it should be a firm requirement in §9 step 3 (it is mentioned: "single-flight minting (AL-UCP-10)"), AND the unit test in §4/§9 step 4 should assert the single-flight behavior (concurrent callers share one `/password` POST). §9 step 4's test assertions do not currently include a concurrency case. Add it, or the race ships untested.

## Non-blocking observations (not required, but worth folding in)

- **§3.5 / §10.3 checkout-URL sourcing is genuinely ambiguous until AL-UCP-6 resolves.** The plan hedges between cart-level `continue_url` and a separate `create_checkout`. The Dev MCP strongly favors the cart `continue_url` for handoff (_"Sharing a cart link with the buyer → Cart MCP (continue_url)"_), which would eliminate a whole tool call per add and drop `create_checkout` from Phase 1's critical path. Recommend the plan bias explicitly toward `continue_url` and treat `create_checkout` as the fallback, since it also reduces Anonymous-tier rate-limit pressure (§7). This would also make AL-UCP-7 (the `cart_id`-vs-`line_items` question) moot for Phase 1.
- **`ChatAssistant.jsx` is confirmed data-shape-agnostic** (reads `cart.id`, `cart.checkoutUrl`, `products`, `error`, `cartReset`, `productDetail` — lines 71, 287, 345). The plan's "no change expected" is accurate — EXCEPT it reads `message.productDetail` (line 287, 323–329), which ties back to finding 5: if `"detail"` is removed, `productDetail` becomes permanently undefined and that branch is dead but harmless. Worth a one-line note.
- **§5.2 env-var hygiene is correct.** Password referenced by pointer to `docs/dev-fixtures.md`, not pasted into the committed plan; `.env`/`.env.local` explicitly not Coder-edited (§4 line 191). This satisfies the DEV-ONLY-secret gate. Confirmed the plan file itself contains no password literal.
- **DEV-ONLY hard-gate (§3.4).** The "shim disabled when password env var absent, hard guard prevents silent production activation" is the right shape. Recommend the plan additionally require the guard to be an explicit boolean check surfaced in a comment banner AND that the production path throw a clear config error (not silently no-op into an unauthenticated 302 loop) if someone deploys with neither the shim nor a signed-request signer. Currently §3.4 says the client "relies on the endpoint being reachable" when the password is absent — in production against a password-gated store that means an infinite 302, which should be a loud config error, not a silent failure.
- **Analytics per-card exemption** (§6.7, "skip the event rather than emit an empty id") is carried forward correctly from the existing card (AssistantProductCard.jsx:83) and matches the Hydrogen truthy-`vendor`/`variantTitle` drop behavior the current normalizer already handles.

## Priority-scrutiny verdicts (as requested)

- **AL-UCP-3 (make-or-break cookie unblock):** De-risking probe EXISTS and is correctly ordered first with a STOP condition (§9 step 1a). This is the plan's biggest strength versus the retired attempt. BUT it is (a) blocked on an unowned operator prerequisite (finding 1) and (b) has no written fallback if the cookie fails (finding 2). These two gaps are why this is APPROVE WITH CHANGES rather than APPROVE.
- **AL-UCP-1 (envelope shape):** Handled correctly. Not hard-coded; probe-gated; `structuredContent`-primary with `content[0].text` fallback; matches Dev MCP exactly. No change required.
- **AL-UCP-2 (cookie name / password field):** Treated as an assumption to confirm by live probe, not a fact (§9 step 1a). Correct posture.
- **Phase discipline:** Phase 1 is genuinely scoped to `search_catalog`, `create_cart`, `update_cart`, `create_checkout`. Checkout-completion, cancel, lookup, get_product, get_order all correctly deferred to §11. No Phase 2 smuggling — except the dangling `"detail"` intent (finding 5), which is a Phase-1 loose end, not Phase-2 creep.
- **Ambiguity Log quality:** 13 entries, each with a concrete resolve-by path (probe/doc-lookup/design decision). AL-UCP-3 is the only one that is a true blocker masquerading as deferrable, and the plan does flag it as make-or-break — but it needs the fallback (finding 2) to be honestly resolvable. AL-UCP-8 has a factual understatement (finding 3). The rest are legitimately deferrable.

## Required changes to fold in before implementation

1. Make OQ-U2 (operator adds the dev-only password env var; `docs/dev-fixtures.md` holds the current password) an explicit operator-owned **pre-implementation gate** at the top of §9, resolved before the Coder is dispatched — not a step the Coder self-serves.
2. Add a concrete written fallback for AL-UCP-3 failing (operator removes password / configures path exception, OR defer the migration) instead of a bare "escalate."
3. Correct §5.4 / AL-UCP-8: the Checkout MCP docs explicitly require `meta.idempotency-key` on `cancel_checkout` (not only `complete_checkout`), and Cart MCP docs require it on `cancel_cart`; the schema-vs-docs conflict applies to BOTH cancel tools.
4. Note in §5.3 that `search_catalog`'s `catalog` object has no schema-required fields (query-or-filters is enforced at runtime), so the action's empty-query guard must remain.
5. Specify the fate of the route's `"detail"` intent and its `getProductDetails` / `normalizeProductDetail` / `normalizeProductDetailsMoney` dependencies (remove cleanly vs graceful "not available"); ensure no unresolved imports and no Anti-Stubbing violation.
6. Require reading `Retry-After` in BOTH the HTTP-429 path and the `-32000` JSON-RPC body path, and unit-test the `-32000`+`Retry-After` case (not just the existing 429 case).
7. Require a single-flight concurrency unit test for the cookie shim (concurrent callers share one `/password` POST), and make production-with-no-auth a loud config error rather than a silent 302 loop.

APPROVE WITH CHANGES
