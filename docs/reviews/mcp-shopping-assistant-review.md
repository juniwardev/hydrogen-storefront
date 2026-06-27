# Plan Review: `mcp-shopping-assistant`

Reviewer: Plan-Reviewer (adversarial)
Plan: `docs/plans/mcp-shopping-assistant.md`
Date: 2026-06-27
Verdict: see final line.

This is a strong, unusually honest plan. The trust boundary, Anti-Stubbing discipline, probe-first sequencing, and the Ambiguity Log are all above the bar. I independently re-verified the load-bearing API claims via the Shopify Dev MCP and they largely hold. The objections below are about places where the plan's **verification steps could mask a wrong assumption instead of exposing it**, plus two compliance/coverage gaps that are not in the Ambiguity Log at all.

---

## Independent verification of API claims (Dev MCP, version 2026-04)

Confirmed FACT, no objection:

- **Two-endpoint split** — `https://shopify.dev/docs/apps/build/storefront-mcp/servers/storefront`: standard tools (`get_cart`, `update_cart`, `search_shop_policies_and_faqs`) are "available on a separate endpoint from the UCP-conforming tools." Catalog tools on `/api/ucp/mcp`. CONFIRMED.
- **`/api/ucp/mcp` requires an agent profile** — "every request must include a `meta.ucp-agent.profile` URL." CONFIRMED verbatim.
- **`search_catalog` response envelope** — `result.structuredContent` with `ucp` metadata + `products[]`; prices `{amount:<minor units>, currency}` (`{amount: 8900, currency: "USD"}`). CONFIRMED (`/docs/agents/get-started/search-catalog`). This vindicates AL-11 and §5.3's minor-units guard.
- **UCP Cart (surface B) PUT semantics** — CONFIRMED. `update_cart` replaces full state.
- **Negotiation failure path exists** — `/docs/agents/profiles`: "If the profile cannot be loaded, is invalid, or yields no compatible capabilities, you get an error path instead of a successful negotiation." Relevant to AL-16 (see below).

New finding the plan did NOT capture:

- **Standard `/api/mcp` `update_cart` has an internally inconsistent doc.** The Storefront MCP server doc lists the parameter as **`lines`** ("lines: Array of items to update or add (required, each with quantity and optional line_item_id)") but its own JSON example uses **`add_items`**: `"arguments": {"cart_id": "...", "add_items": [{"line_item_id": "...", "merchandise_id": "gid://shopify/ProductVariant/789012", "quantity": 2}]}`. The plan inherits this confusion: §0.5(A) says `add_items`, but §3.2's sequence diagram and §3.3 prose say `lines:[{merchandise_id, quantity:1}]`. **This `lines` vs `add_items` discrepancy is not in the Ambiguity Log and is not called out as a probe target.** The §8 probe records `tools/list` and a `search_catalog` body, but never an actual `update_cart` body, so this naming mismatch can survive into code as a silent 400. See required change #5.

- **Catalog-declaring profile fixtures DO exist** (relevant to AL-5). `/docs/agents/profiles` shows hosted fixtures declaring `dev.shopify.catalog.global` extending `dev.ucp.shopping.catalog.search`/`.lookup`, plus dedicated "empty capabilities" test fixtures. AL-5's claim that "no concrete catalog-declaring fixture URL was found" is under-researched. The caveat that the *Storefront* catalog extension (`dev.shopify.catalog`) differs from the *Global* one (`dev.shopify.catalog.global`) is legitimate, so the decision to defer to a probe is still safe — but the architect overstated the gap.

- **Hydrogen `<Image>` accepts `src`** (MediaFile/Image docs) in addition to `data` (which "must be an Image object"). So §5.3's `<Image src/width/height/alt>` external form is valid, and the `<img>` fallback is reasonable. No objection — but note that if MCP media URLs are not on `cdn.shopify.com`, the default Hydrogen loader's transform params won't apply and srcset is lost; the `<img>` fallback is then the honest choice.

---

## PRIORITY: the five flagged Ambiguity Log entries

### AL-4 — `media` field names unknown (`low`)
**Decision defensible?** Yes. The docs genuinely do not expose the inner `Media` schema; even the `search_catalog` example response I retrieved omits media fields. "Probe live, don't invent `media.url`, `<img>` fallback" is correct, and the plan rightly calls this the top implementation snag.

**Does verification catch a wrong assumption, or mask it?** **It can MASK it.** §8.1 probe 3 (record live `media` field names) is a genuine pre-code catch — good. But the §8.3 QA criterion "product cards render with real images (or graceful no-image)" is a masking trap: if the Coder maps the wrong field name, `image` is `undefined`, which silently routes into the *graceful no-image* branch. QA sees a card without an image and accepts it as the designed fallback rather than a mapping bug. **Required change #1** specifies the assertion that actually distinguishes the two.

### AL-5 — catalog agent-profile fixture URL not pinned (`low`)
**Decision defensible?** Mostly — but see above, the architect understated that catalog-declaring fixtures exist. The fail-safe (config error if `MCP_AGENT_PROFILE_URL` unset; defer concrete URL to Coder/operator) is sound.

**Catch vs mask?** Risk of masking, coupled to AL-16. The plan asserts probes "fail loudly on a bad/insufficient profile," but whether an *incompatible* profile (e.g. a Global-catalog fixture used against the Storefront endpoint) yields a JSON-RPC **error** versus an empty `products[]` is exactly what AL-16 admits is unspecified. If incompatibility surfaces as empty products, QA's "No matches found" path masks a misconfigured profile. **Required change #2.**

### AL-6 — rate budget figure unreproducible (`low` on the number)
**Decision defensible?** Yes. My searches also failed to reproduce "~1,000 cost points/min"; the docs describe trust tiers (Token > Signed > Anonymous), not a numeric standard-server budget. The conservative design (1 call/turn, `limit=8`, honor `Retry-After`) holds regardless, so the unknown number is low-risk.

**Catch vs mask?** The verification ("runtime 429 monitoring") is not a real test — nothing in the plan can deterministically trigger a 429, so the entire 429/`Retry-After` path (and AL-14's seconds-vs-ms assumption) ships **unverified**, despite "robust rate-limit handling" being stated goal #5. **Required change #3** adds a deterministic unit test on the `callTool` 429 branch. (The number itself is fine to leave as OQ-5.)

### AL-15 — surface-A not-found signal assumed from surface-B docs (`low-medium`)
**Decision defensible?** Yes, and honestly labeled as assumed-by-analogy.

**Catch vs mask?** The catch (probe `update_cart` with a stale `cart_id`) lives **only** inside AL-15's "Verification path" — it is absent from the §8.1 command list and the step-7 checklist, so it is the probe most likely to be skipped. Worse masking risk: the standard `update_cart` doc says it "creates a new cart if not provided," so a stale/invalid `cart_id` may silently mint a **fresh cart**, orphaning the shopper's prior items with no error. QA's "add to cart works" check passes while cart continuity is silently lost. **Required change #4** promotes the stale-cart probe into §8.1 and demands the action distinguish "auto-created new cart" from "updated existing cart."

### AL-16 — UCP negotiation failure shape + profile lifecycle undocumented (`low`)
**Decision defensible?** Yes; mapping failures to a generic error state is safe given the docs don't pin the failure shape.

**Catch vs mask?** §8.3's forced-error test ("point the profile URL wrong → graceful error state") exercises the path, but as written it only asserts "no crash, no fabricated data." It must assert the **error state specifically** (visible error copy), and must cover *both* (a) an unreachable profile URL and (b) a reachable-but-incompatible profile — the docs ship an "empty capabilities" fixture precisely for case (b). Folded into **required change #2**.

---

## Lighter Ambiguity Log entries — sanity check

- **AL-2** (`/api/mcp` literal from WebSearch, rated medium-high): I confirmed `/api/ucp/mcp` and the "separate endpoint" language directly via Dev MCP, but the literal standard path is still only indirectly corroborated. Rating fair; probe will catch.
- **AL-3** (cart surface A vs B, medium): Reasonable for a demo, but the plan **underweights** one argument — the catalog flow already builds all the agent-profile/UCP plumbing, so surface B (UCP cart) would *reuse* it and avoid a second cart paradigm, while surface A is the deprecated one. Non-blocking (OQ-3 defers to me): my recommendation is to keep `callTool` endpoint-agnostic so an A→B swap is a one-line change, and lean B if the probe shows it's available. Acceptable as written.
- **AL-12** (`structuredContent` envelope uniform, low-medium): Correctly rated. Note the cart payload nests under `structuredContent.cart` (and catalog under `structuredContent.products`); normalizers must dig in. Cart responses also carry a parallel `content[]` text block — ignore it, use `structuredContent`.
- **AL-13** (no `initialize` handshake, medium-high): Fine; documented helpers do stateless POSTs.
- **AL-17** (locale guard mirrors `api.newsletter.jsx`, medium-high): Verified — `api.newsletter.jsx` guards via `context.storefront.i18n {language, country}` vs `params.locale` and throws `404`. Note the plan also cites `api.countries.jsx` as a mirror, but that file has **no** guard and is a `loader`, not an `action`; the Coder must mirror **newsletter**, not countries. Minor, already implied.
- **AL-1**, **AL-10**, **AL-11**: ratings fair.

No entries are dangerously mis-rated. The honest low-confidence labeling is appropriate.

---

## Findings NOT in the Ambiguity Log (the more serious gaps)

### G1 (blocking) — PDP `<Link>` is probably dead; §8.3 asserts it works
The `search_catalog` product `id` is a UPID (`gid://shopify/p/{upid}`), and the example response carries `title`/`options`/`price_range` but **no `handle`**. The site PDP route is `($locale).products.$productHandle.jsx`, which needs a **handle**. §5.3 marks `handle?` optional and §7 step 7 says "use handle if present; otherwise omit the link" — but if handle is *always* absent (likely), the entire PDP-link feature is non-functional, and §8.3's "working PDP links" acceptance criterion is either unsatisfiable or silently skipped (masking). This is not flagged anywhere. Decide explicitly: (a) drop the in-card PDP link and rely solely on `checkout_url`/`continue_url` handoff; (b) call `get_product` to see whether it returns a handle or an `online_store`/canonical URL; or (c) resolve UPID→handle via Storefront GraphQL (reintroduces GraphQL — weigh against §5.1's "no GraphQL" stance). At minimum, remove the unconditional "working PDP links" claim from §8.3 until resolved.

### G2 (blocking) — Analytics Contract is silent for `AssistantProductCard`
CLAUDE.md's Analytics Contract is non-negotiable: "When rendering product pages **or product cards**, ensure the `variantId` is correctly extracted ... and passed to `<Analytics.ProductView>` or `<Analytics.ItemView>`." The plan renders product cards in-chat with `firstVariantId` available in the normalized model, yet never mentions Analytics. Either wire `<Analytics.ItemView>` with `firstVariantId` on each card, or document an explicit, defensible exemption (e.g. these are conversational results outside the analytics surface). Silence is a directive violation.

### G3 (non-blocking) — CSP / `img-src` for MCP media
`entry.server.jsx` applies `createContentSecurityPolicy`. If live `media` URLs are on `cdn.shopify.com` the default policy allows them; if they resolve to another host, images are CSP-blocked and render blank — which would *also* feed the AL-4 masking trap (blank image read as "graceful no-image"). Add a console-clean assertion (no CSP violations) to the §8.2 browser check, and record the media URL host in impl notes.

### G4 (non-blocking) — logging discipline / observability
`api.newsletter.jsx` carries an explicit no-unconditional-`console.log` / no-PII note. The MCP client has none. Server-side error logging is desirable for debugging the many "confirm live" unknowns, but must not log the raw user query or full MCP payloads. Add the same logging-discipline note to `mcp.server.js` so the Coder doesn't either over-log (PII/payloads) or under-log (no observability on the error paths this plan depends on).

---

## Scope discipline — clean
Customer-account MCP, full checkout completion, UCP Cart surface B, single-cart unification, LLM planner, and framework-agnostic Hydrogen are all correctly in §2 Non-goals / Next steps and do not leak into the design. Good.

## Trust boundary — sound
`.server.js` suffix, normalized view model only to the browser, no endpoint/profile URLs client-side, untrusted-input capping. `PUBLIC_STORE_DOMAIN` is public anyway and the agent-profile URL is a public HTTPS doc, so nothing secret crosses the wire. The one thing to actually verify is mechanical, and §8.3 already includes the "no MCP URL in client JS / `mcp.server.js` not in client graph" check. Good.

## File-by-file realism — accurate
I read `PageLayout.jsx`, `Drawer.jsx`, `ProductCard.jsx`, `Footer.jsx`, `useIsHydrated.jsx`, `api.newsletter.jsx`, `const.js`, `entry.server.jsx`. The plan's mount point, hydration-gating precedent (Badge/Footer), `useRouteLoaderData('root')?.selectedLocale?.pathPrefix` pattern, plain-string action URL (no `<Link>` double-prefix), and `<Money>`/`<Image>` usage all match existing conventions. `Drawer` reuse (OQ-2/AL-9) is plausible: its API is `{heading, open, onClose, openFrom, children}` driven by `useDrawer()` — fits a launcher-toggled panel. One caveat: `Drawer` mounts a full-screen `Dialog` overlay with a backdrop; a persistent floating launcher + conversational panel may want lighter weight, so the "bespoke panel" fallback is realistic. No file claims are fabricated.

---

## Required changes (fold in before `/implement`)

1. **AL-4 / G3 — de-mask the image check.** §8.3 must assert that for a query/handle known (from `docs/dev-fixtures.md`) to return products *with* images, an `<Image>`/`<img>` with a **non-empty `cdn.shopify.com` (or recorded-host) src actually renders** — not the no-image fallback. The "graceful no-image" branch may only be accepted for a product genuinely lacking media. Add a DevTools-console "no CSP violation" assertion to §8.2.
2. **AL-5 / AL-16 — de-mask the profile-failure check.** The §8.3 forced-error test must assert a **visible error state** (not merely "no crash"), and must cover both an unreachable profile URL **and** a reachable-but-incompatible profile (use the docs' "empty capabilities" fixture). The action must distinguish "negotiation/RPC error" from "zero products," and the §8.1 probe must record which one an incompatible profile actually produces.
3. **AL-6 / AL-14 — make the 429 path testable.** Add a deterministic unit test for the `callTool` 429 branch (mock a `Response` with status 429 + `Retry-After`) asserting the `rate_limited` `McpError`, the `retryAfter` parse, and the seconds→ms conversion. "Runtime 429 monitoring" alone is insufficient for stated goal #5.
4. **AL-15 — add the stale-cart probe and disambiguate auto-create.** Promote the "`update_cart` with a stale `cart_id`" probe from AL-15's prose into the §8.1 command list and the step-7 checklist. The action/normalizer must distinguish "auto-created a new cart" from "updated the existing cart" so a silently orphaned cart is detectable, and §8.3 must exercise the expired-cart path explicitly.
5. **`update_cart` field name — resolve `lines` vs `add_items`.** Add an `update_cart` body to the §8 probe set and pin the real parameter name (`add_items` per the example vs `lines` per the prose) before writing the client. Make §0.5/§3.2/§3.3 internally consistent once confirmed.
6. **G1 — resolve the PDP-link/handle gap.** Decide and document how (or whether) `AssistantProductCard` links to the local PDP given catalog responses return a UPID and (apparently) no handle. Remove the unconditional "working PDP links" criterion from §8.3 until resolved.
7. **G2 — satisfy the Analytics Contract.** Either wire `<Analytics.ItemView>` with `firstVariantId` on assistant product cards, or document an explicit exemption in the plan. Silence is non-compliant with CLAUDE.md.

(Non-blocking: G4 logging-discipline note on `mcp.server.js`; consider keeping `callTool` endpoint-agnostic to ease a future surface-A→B cart swap per AL-3.)

APPROVE WITH CHANGES

---

## Re-review (revision 1)

Date: 2026-06-27. Re-read CLAUDE.md (no project AGENTS.md at root) before this pass. I re-read the full revised plan (§0–§8, all 20 Ambiguity Log entries, OQ-1..OQ-9) and re-verified the one newly load-bearing API claim I was uncertain about (the Analytics component name) against the Shopify Dev MCP, version 2026-04. The original seven required changes are addressed below; one introduced a new factual defect that must be corrected.

### Disposition of the original seven required changes

**#1 — AL-4 / G3 image de-mask — RESOLVED.**
§8.3 now carries a *positive* assertion: for a known-good product from `docs/dev-fixtures.md`, the card must render an `<img>`/`<Image>` with a non-empty `cdn.shopify.com`/recorded-host `src`; the no-image branch is accepted *only* for a genuinely media-less product (§8.3 first bullet; AL-4 verification path; §6 edge cases). §8.2 adds the no-CSP-violation console check. This genuinely de-masks: a wrong `media` field map yields `image === undefined` → no-image fallback → the positive assertion *fails* on a known-good product rather than passing as "graceful." The only residual dependency is that `docs/dev-fixtures.md` actually names a with-images product; that is correctly the Coder/QA's setup, and the plan points at the right artifact.

**#2 — AL-5 / AL-16 error-vs-empty de-mask — RESOLVED (with an acceptable, explicitly-documented residual).**
Error and empty are now genuinely distinct: §3.5 gives them different styling/affordances (empty = neutral, Send stays enabled; error = warning copy naming the failure class), §5.4 returns `error` only for genuine failures and `{products:[]}` (no error) for zero results, and §8.3 asserts a *visible* error state for the unreachable-profile case. §8.1 probe 7 (incompatible "empty capabilities" fixture) + 7b (unreachable URL) record which signal each produces. The revised forced-error scenario would now expose a misconfiguration for the common case (unset/unreachable `MCP_AGENT_PROFILE_URL` → visible error, not "No matches found").
The residual the architect flagged is real: an incompatible-but-loadable profile *might* return empty `products[]` (undocumented), which the empty state would still mask. The plan handles this honestly — §8.3 conditions the assertion on probe-7's recorded behavior and requires the masking limitation to be documented in impl notes if empty-products is what the platform returns. For a probe-gated implementation this residual is **acceptable to ship**, not blocking. One concrete de-masking lever the plan does not mention and the Coder should consider (non-blocking): the `search_catalog` response carries a `ucp` negotiation-metadata envelope (§0.2); if probe 7 shows the platform returns empty products for an incompatible profile, the action may be able to inspect the negotiated-capability set in that envelope to distinguish "negotiated to empty capabilities" from "genuine zero matches." Worth recording as a follow-up in impl notes, not a gate.

**#3 — AL-6 / AL-14 429 testability — RESOLVED.**
`callTool` takes an injectable `fetchImpl` (visible in the §3.3 skeleton), a new `app/lib/mcp.server.test.js` is in §4 and step 6, and §8.4 specifies `node --test` asserting `code === 'rate_limited'`, `retryAfterMs === 2000` (seconds→ms), plus a no-`Retry-After` default case. This is deterministic — the path no longer ships on un-triggerable runtime monitoring. Using built-in `node --test` (zero new dependency) with the `npm run test:unit` wrapper left as an operator decision is acceptable; it is a real, runnable harness. One mechanical note for the Coder (non-blocking): keep `mcp.server.js` free of import-time Remix/`@shopify/hydrogen` imports so the file loads under bare `node --test`; the skeleton already only uses platform globals and takes env via args (§4), so this holds as designed.

**#4 — AL-15 stale-cart probe + auto-create disambiguation — RESOLVED.**
The stale-`cart_id` probe is promoted to §8.1 probe 6 and into the step-7 checklist item 2(g). §5.4 sets `cartCreated:true` by comparing the returned cart id to the submitted `cartId` (or on a not-found signal), §3.5 surfaces a "started a new cart" note, and §8.3 exercises the expired-cart path and asserts that note. Silent cart-loss is now observable rather than passing a naive "add to cart works" check.

**#5 — `lines` vs `add_items` reconciliation — RESOLVED.**
The design sections are now internally consistent on a single shape: §0.5(A), §3.2 (sequence diagram line + the explicit "key `add_items` is probe-pending (AL-20)" note), and §3.3 all canonicalize on `add_items` as the probe-pending working assumption. The prior `lines:[…]` literal is gone from §3.2/§3.3; `lines` now appears only where it *should* — documenting the doc-internal contradiction in §0.5 and AL-20. §8.1 probe 5 captures a real `update_cart` body to pin the accepted key before coding, and AL-20 records the contradiction with a swap-and-reconcile instruction. Reconciled to one shape.

**#6 — G1 PDP-link/handle gap — RESOLVED.**
§3.5's PDP-link rule makes the `checkout_url`/`continue_url` handoff the primary destination and renders a local PDP `<Link>` *only* when a usable `handle`/`storefrontUrl` is present (no dead/placeholder link — Anti-Stubbing). The unconditional "working PDP links" criterion is removed from §8.3 and replaced with one conditioned on the §8.1 probe 3/4 outcome (assert a working destination if a field exists, else assert the link is omitted and checkout handoff is used). AL-18 and OQ-8 capture the decision and probe. The verification path now exposes the wrong assumption (it explicitly checks for link omission when no handle exists) rather than asserting a feature that can't work.

**#7 — G2 Analytics Contract — RESOLVED IN INTENT, but the named component is wrong (new defect; see required change below).**
The plan now addresses the contract everywhere it was silent (§3.5, §4 line 303, AL-19, OQ-9, §8.3, step 8): each `AssistantProductCard` is to feed an analytics view component a `firstVariantId` sourced from catalog `variants[0].id`, with a documented per-card exemption when no variant id is present, and the cards mount inside the root `<Analytics.Provider>` via `PageLayout`. The *intent* — wire `variantId` into an analytics view component, exempt with justification when absent — fully satisfies the CLAUDE.md Analytics Contract and is sound. **However, the plan hard-commits to `<Analytics.ItemView>`, which is not a real Hydrogen component.** See below.

### New blocking finding introduced by the revision

**N1 (blocking) — `Analytics.ItemView` does not exist in Hydrogen.**
I verified against the Shopify Dev MCP (Hydrogen, version 2026-04). The `Analytics` namespace exposes `Analytics.Provider`, `Analytics.ProductView` (publishes `product_viewed`, takes `data={{products:[{id, title, price, variantId, variantTitle, quantity, …}]}}`), `Analytics.CartView`, `Analytics.CollectionView`, `Analytics.SearchView`, and `Analytics.CustomView` — each with its own dedicated doc page. Two targeted searches (one general, one explicitly for `ItemView`) surfaced all of those and **never** surfaced an `Analytics.ItemView`. There is no such component.

CLAUDE.md's Analytics Contract names "`<Analytics.ProductView>` or `<Analytics.ItemView>`," so the hallucinated name is partly inherited from the project doc (and my own original G2/#7 echoed it — my error too). But the revision *acts* on it: §3.5, §4, AL-19, OQ-9, §8.3, and step 8 all instruct the Coder to render `<Analytics.ItemView>`. JSX referencing an undefined namespace member (`Analytics.ItemView` → `undefined`) throws "Element type is invalid … got: undefined" at render — an SSR/hydration crash on exactly the surface where cards render, not a clean build-time error the Coder would catch early. Because the Anti-Stubbing Rule forbids commenting out the component to get past the error, the Coder needs the plan to name the real one.

This is a one-concept correction (swap to `Analytics.ProductView`, or adopt a documented feature-level exemption), but it is wrong in the plan text in six places and would otherwise crash the rendering path, so it must be folded into the plan rather than left for the Coder to rediscover.

Two sub-points for whichever path is chosen (the Architect should decide, not me):
- If wiring `Analytics.ProductView` per card: note its semantic is a `product_viewed` event. Firing one per result in a conversational list is an impression-spam smell — Hydrogen's standard pattern puts `ProductView` on the PDP, and there is no per-card "impression" view component in the namespace. This strengthens the case for the **documented exemption** path (treat the in-chat card list as outside the analytics-view surface, justify in-plan) that CLAUDE.md's contract explicitly permits. Either is compliant; pick one and make the plan say it precisely.
- The `data` payload shape for `ProductView` is `{products: [ProductPayload]}` where `ProductPayload` carries `id`, `variantId`, `price`, `title`, `quantity`, etc. — not a bare `firstVariantId`. If the wire path is chosen, §5.3/§3.5 should reflect that the card maps its normalized fields into that payload.

### Ambiguity Log / OQ spot-check (AL-18, AL-19, AL-20, OQ-8, OQ-9)

- **AL-18 / OQ-8 (PDP handle)** — Sound. Correctly states catalog returns a UPID and (apparently) no handle, defers the final link decision to probe 3/4 + operator (OQ-8), recommends checkout handoff as the default, and forbids deriving a handle from the UPID. Not papering over anything — it explicitly conditions the §8.3 criterion on the probe outcome. Good.
- **AL-19 / OQ-9 (Analytics)** — The *reasoning* (wire when a variant id is present, exempt with justification when absent, verification gap = whether search payload reliably carries `variants[].id`, pinned by probe 3) is sound and honest. It is undermined only by the `ItemView` naming defect in N1; once the component name is corrected the entry stands. Not a hidden blocker beyond N1.
- **AL-20 (`lines` vs `add_items`)** — Sound. Accurately records the doc-internal contradiction, canonicalizes on the example-backed `add_items` as probe-pending, and routes the real decision through §8.1 probe 5. Good.

No new entry papers over an unresolved blocker; AL-19 is the only one touched by N1.

### Verdict rationale

All seven original required changes are genuinely addressed — the verification paths now expose wrong assumptions rather than mask them (image positive assertion, visible-error-state forced-failure with both failure modes probed, deterministic 429 unit test, promoted stale-cart probe with `cartCreated` disambiguation, reconciled cart key, conditioned PDP criterion). The AL-16 incompatible-profile residual is acceptable for a probe-gated build as documented. The single remaining blocker is the factual one the revision introduced: the plan instructs rendering a non-existent `Analytics.ItemView` component in six places, which would crash the card-render path. That is a small, well-scoped correction but must be made in the plan before `/implement`.

### Required change for revision 2

1. **N1 — replace `Analytics.ItemView`.** `Analytics.ItemView` is not a real Hydrogen component (verified, Dev MCP 2026-04: the namespace is `Provider`, `ProductView`, `CartView`, `CollectionView`, `SearchView`, `CustomView`). Across §3.5, §4, AL-19, OQ-9, §8.3, and step 8, either (a) use `<Analytics.ProductView>` with a proper `{products:[ProductPayload]}` `data` payload built from the card's normalized fields (and acknowledge the per-card `product_viewed` semantic), or (b) adopt the CLAUDE.md-permitted documented exemption — treat the in-chat conversational card list as outside the analytics-view surface, justified in the plan. Decide one and make every referencing section consistent. Do not leave `ItemView` in the plan for the Coder to import.

APPROVE WITH CHANGES

---

## Re-review (revision 2 — final clearance)

Date: 2026-06-27. Re-read the project `CLAUDE.md` before this pass (no project `AGENTS.md` at the repo root — only the global `~/.claude/CLAUDE.md` and this project file). This is the tight, N1-only clearance pass plus a fast regression scan. I re-verified the one load-bearing claim (the `Analytics.ProductView` payload shape) against the Shopify Dev MCP, version 2026-04, since it is the crux of the fix.

### 1. N1 fix in the plan — RESOLVED

I grepped the full plan for `ItemView`. Every remaining occurrence is intentional correction-documentation, NOT live usage:

- **Line 11** — revision-2 changelog entry describing the swap.
- **Line 296 (§3.5)** — `<Analytics.ProductView>` is the live directive; `ItemView` appears only inside the explanatory parenthetical ("there is no `ItemView`; `ProductView` is the correct per-product event").
- **Line 562 (Sources)** — namespace note listing the real components and explicitly "no ItemView; verified via Shopify Dev MCP, 2026-04."
- **Lines 732–735 (AL-19)** — entry retitled "CORRECTED in revision 2," Status marked SUPERSEDED-on-component-name, with a provenance/audit-trail note.
- **Line 756 (summary)** — records the correction across the plan.

Every **live USAGE** directive now reads `<Analytics.ProductView>` with the `data={{products: [ProductPayload]}}` payload: §3.5 (line 296), §4 line 308 (`AssistantProductCard`), §4 line 312 (`PageLayout` context note), §5.3 line 351 (view-model comment), §6 OQ-9 (line 426), §7 step 4 (line 444), §7 step 8 (line 448), §7 step 10 (line 450), §8.3 (line 525), and AL-19 Decision (line 739) / Verification path (line 741). No live `<Analytics.ItemView>` reference survives anywhere in the plan. The N1 finding is genuinely closed, not papered over.

**`firstVariantId` → `variantId` wiring is consistent.** §5.3 (line 351) sources `firstVariantId` from the UCP catalog `variants[0].id` (a `gid://shopify/ProductVariant/…`); §3.5, §4 line 308, AL-19 line 739, and step 8 (line 448) all feed that `firstVariantId` into the product payload's `variantId`, with the documented per-card exemption when no variant id is present. No dangling `firstVariantId`/`variantId` mismatch.

**Payload shape re-verified against Dev MCP (Hydrogen 2026-04).** `Analytics.ProductView` takes `props.data` of type `ProductsPayload` = `{ products: Array<ProductPayload> }`, and `ProductPayload` carries `id`, `price` (string), `title`, `variantId`, `variantTitle`, `quantity`, etc. The official example renders `<Analytics.ProductView data={{products: [{id, title, price, variantId, variantTitle, quantity}]}} />`. The plan's specified shape — a single-element `products` array whose `ProductPayload` carries `firstVariantId` as `variantId` plus `id`/`title`/`price` from the normalized model — matches the documented contract exactly. The component and payload are correct for Hydrogen 2026-04.

One non-blocking mapping nuance for the Coder (not a gate): `ProductPayload.price` is a **string** (the variant amount), whereas the normalized view-model `price`/`priceRange.min` is a `Money` object `{amount, currencyCode}`. "price from the normalized model" (line 296/739) is slightly loose — the card must pass the `amount` string (or `priceRange.min.amount`), not the Money object, into the analytics payload. This is a one-line mapping detail the Coder will handle; it does not block.

### 2. N1 fix in governance (CLAUDE.md) — CONFIRMED CORRECT

I read the project `CLAUDE.md` directly. The Analytics Contract is fixed in two places:

- **QA guidance (line 122)** now reads: confirm `<Analytics.ProductView>` receives a valid `variantId` "(inside its `{products: [...]}` payload) on product pages and product cards." No `ItemView`.
- **The Analytics Contract directive (lines 227–233)** now points to `<Analytics.ProductView>` only, via its `data={{products: [...]}}` payload, and adds an explicit namespace enumeration: "exposes exactly: `Provider`, `ProductView`, `CartView`, `CollectionView`, `SearchView`, and `CustomView`. There is **no** `Analytics.ItemView` — referencing it renders an undefined component and crashes the render path at SSR/hydration."
- **A dated correction note (line 233, 2026-06-27)** records that earlier revisions listed `<Analytics.ItemView>`, that the wording was inherited into this very plan, and that the Plan-Reviewer caught it via the Shopify Dev MCP. CLAUDE.md no longer presents `Analytics.ItemView` as a valid component anywhere.

The plan's AL-19 provenance note (line 735) correctly references this governance fix: it states the `ItemView` name was inherited verbatim from `CLAUDE.md`'s Analytics Contract and that "The erroneous `CLAUDE.md`/`AGENTS.md` Analytics-Contract text is being corrected **separately by the orchestrator** (outside this plan's `docs/plans/` write scope)." That provenance now matches the actual corrected CLAUDE.md. (I have read access to CLAUDE.md only and confirm it is correct; the claimed byte-identical `AGENTS.md` sync is outside what I can see from the plan and I take the orchestrator's report on that at face value — the operative grounding file every agent reads, CLAUDE.md, is correct.)

### 3. Regression scan — clean

Light pass over the previously-RESOLVED items #1–#6 and the OQ/AL cross-references to confirm revision 2 disturbed nothing:

- **#1 (image de-mask)** — §8.2/§8.3 positive image assertion intact.
- **#2 (error vs empty)** — §3.5/§5.4 distinction and §8.1 probe 7/7b intact.
- **#3 (429 unit test)** — `app/lib/mcp.server.test.js` (§4, step 6, §8.4) intact; `callTool` `fetchImpl` injection unchanged.
- **#4 (stale-cart)** — §8.1 probe 6 / step-7 item 2(g) / `cartCreated` disambiguation intact.
- **#5 (`add_items` vs `lines`)** — §0.5/§3.2/§3.3 still reconciled on `add_items`; AL-20 and §8.1 probe 5 intact.
- **#6 (PDP link)** — §3.5 conditional-link rule, AL-18, OQ-8, and the conditioned §8.3 criterion intact.

Cross-references hold: the summary (line 767) lists `N1↔AL-19`; OQ-9↔AL-19 and G2↔AL-19 are consistent; no OQ is orphaned (OQ-1..OQ-9 all still bound to their AL entries). The revision is a surgical component-name/payload correction localized to the Analytics thread; nothing outside that thread moved. No new inconsistency introduced.

### Verdict rationale

N1 is genuinely fixed in both the plan and the governance file. Every live `<Analytics.ItemView>` usage is gone, replaced by `<Analytics.ProductView>` with the `{products: [ProductPayload]}` payload that I re-verified is correct for Hydrogen 2026-04; `firstVariantId` correctly feeds the payload's `variantId`; the only surviving `ItemView` strings are intentional correction-documentation. CLAUDE.md no longer presents `Analytics.ItemView` as valid and carries a dated correction note that the plan's AL-19 provenance accurately references. The previously-resolved items #1–#6 are undisturbed and no cross-reference is orphaned. The residual probe-gated partial items (AL-16 incompatible-profile empty-vs-error, the live `media`/handle/cart-key shapes) were previously deemed acceptable for a probe-first implementation and remain non-blocking. No new blocker. The non-blocking `ProductPayload.price` string-vs-Money mapping note is a Coder detail, not a gate.

APPROVE

---

## Re-review (revision 3 — /api/mcp pivot clearance)

Date: 2026-06-27. Re-read the project `CLAUDE.md` (no project `AGENTS.md` at the repo root) before this pass. This pivot is grounded in **live probe data** (`docs/plans/mcp-shopping-assistant-impl-notes.md`, probes 1–6), which supersedes generic docs where they conflict — the docs describe the UCP endpoint; this design now targets the standard `/api/mcp` endpoint that the Coder actually reached. My job here is to confirm the plan faithfully matches the probed reality, that the re-architecture introduced no new inconsistencies, and that no requirement was quietly dropped. I read the full revised plan (§0–§8, AL-1..AL-22, all OQs) and the impl-notes in full, and grep-confirmed the stale-reference removals.

### 1. Endpoint pivot complete — CONFIRMED

Grepped the plan for every artifact of the old two-endpoint UCP design:

- `MCP_AGENT_PROFILE_URL` — appears only in the changelog (line 13), §5.2 "no new env var" (lines 355, 366), and AL-5 (line 578), all stating it is **removed**. No active directive references it. §4 "Not modified" and §5.2 both affirm the feature introduces **no new environment variable**.
- `meta["ucp-agent"].profile` / `ucp-agent` — appears only in the changelog line describing the removed plumbing. No active design path threads an agent profile.
- `/api/ucp/mcp` — appears only as out-of-scope/blocked (§0.1, §0.4, §2 non-goals, OQ-3, AL-1/AL-3, probe 1) and as a documented Next step (line 527). It is never an active design path. The Sources entry (line 547) explicitly tags the UCP Catalog doc "reference for the deferred Next-step migration, NOT this session's active design."
- `structuredContent` — appears only in the changelog and AL-12, both marking it **WRONG/removed**. The active envelope everywhere is `JSON.parse(result.content[0].text)` + `result.isError` (§3.3 skeleton lines 294–296, §0.2 lines 48–51, §0.3 line 92, §0.4 line 130).

The single-endpoint architecture is internally consistent across the trust-boundary diagram (§3.1), the sequence diagram (§3.2), the client helper (§3.3 `MCP_PATH = '/api/mcp'`), and §4. **Pivot is complete.**

### 2. Response envelope — CONFIRMED

`callTool` (§3.3) parses `result.content[0].text` as stringified JSON, checks `result.isError`, and explicitly ignores `content[1].text` (the deprecation notice). This matches probe 3 (impl-notes lines 83–89) and probe 5 (lines 239–278) exactly. No lingering `structuredContent` in any active path. The `tool_error` mapping carries `payload.errors` for the field/message inspection the stale-cart path relies on. Faithful to probed reality.

### 3. Tool names / args — CONFIRMED

- `get_product_details` with flat arg `product_id` (§0.3 lines 90–91, §3.3 line 307, step 5). Grep for `get_product` without the `_details` suffix → **zero matches**. The old `catalog.id` wrapper is explicitly negated (line 91). Matches probe 4 (impl-notes line 161, 167).
- `update_cart` line item is `product_variant_id`, not `merchandise_id` (§0.4 lines 126–127, AL-20). `merchandise_id` appears only in correction-documentation noting it errors. `add_items` is the confirmed array key. Matches probe 5 (impl-notes lines 224–237). Faithful.

### 4. Price-format divergence (AL-21) — CONFIRMED CONCRETE, NOT HAND-WAVED (highest-risk item)

This is the load-bearing new risk and the plan handles it concretely. §5.3 specifies an explicit **two-path** contract with named functions and per-source structural mapping, which I cross-checked against the three distinct probed Money shapes:

- **`search_catalog`** (probe 3): `price_range.min = {amount: 94995, currency}` — integer minor units, nested. Plan routes through `minorUnitsToDecimalString(amount, currencyCode)` with a zero-decimal-exponent guard (not a hardcoded /100), and explicitly forbids passing minor-unit integers to `<Money>`. Correct.
- **`get_product_details`** (probe 4): `price_range = {min: "949.95", max: "949.95", currency}` — note the decimal string is a **bare string** and `currency` is a **sibling** of `min`/`max`, not nested. The plan catches exactly this nuance: "Pass through as-is (no division); just attach `currencyCode` from the **sibling** `currency`" (§5.3). This subtle structural difference (sibling vs nested currency) is correctly captured — a real trap avoided.
- **Cart cost** (probe 5): `cost.total_amount = {amount: "949.95", currency}` — decimal string, nested. Plan references `.amount`/`.currency` and routes it through the decimal pass-through path. Correct.

The plan assigns each shape its own normalizer (`normalizeCatalogProduct` integer-path; `normalizeProductDetail`/`normalizeCart` decimal-path), renames `currency`→`currencyCode` on every path, and includes the explicit inverse-bug warning ("would render '$94,995.00' for a $949.95 item — the inverse of the catalog bug"). This is concrete and correct against all three probed shapes. The 100x-in-either-direction failure mode is the single most error-prone mapping, and the plan names it as such (§6 AL-21 risk). **Verdict: concrete, not hand-waved.**

De-masking check on the QA side: §8.3 asserts prices render as **formatted decimals (NOT minor-unit integers)** and exercises **both** a `search_catalog`-sourced card and a `get_product_details`-sourced view. Because the two tools return the same underlying $949.95 in different encodings (`94995` vs `"949.95"`), a cross-wired or single-path normalizer produces a visibly wrong rendered number on one path, which the dual-path assertion exposes. The QA scenario exposes rather than masks the divergence. Good.

One non-blocking sharpening (not a gate): §4 mentions a generic `toMoney(...)` helper alongside the per-source mappings. A naive `toMoney` expecting `{amount, currency}` would mis-handle `get_product_details.price_range.min` (bare string + sibling currency). §5.3 documents the sibling case, so the Coder has what they need, but I'd recommend the per-source normalizers own their extraction rather than funneling the structurally-divergent detail shape through a single `toMoney` signature. Also recommend **elevating the §8.4 normalizer unit test from optional to mandatory** — the normalizers are pure and trivially testable, and a direct unit test of both paths is cheaper insurance against the 100x bug than the integration assertion alone. Neither is blocking; the integration-level de-masking already covers the risk.

### 5. Image handling (AL-22) — CONFIRMED hydration-safe and Anti-Stubbing-compliant

MCP media provides `url` + `alt_text` and **no `width`/`height`** (probe 3, impl-notes lines 132–136). The plan (§5.3, AL-22) reconciles this with CLAUDE.md's "complete image payload" directive correctly: that directive binds **GraphQL queries**, not MCP JSON, and the plan honors its *spirit* by always supplying a real `cdn.shopify.com` URL + a non-empty `alt` (fallback to title) while never fabricating dimensions. The chosen render path — plain `<img loading="lazy" alt>` (or `<Image src aspectRatio>` with CSS-controlled sizing) — is genuinely hydration-safe: a dimensionless `<img>` renders identically on server and client, so no SSR/CSR DOM mismatch, and a CSS-controlled container addresses layout shift. (Minor imprecision: the plan's phrasing slightly conflates layout-shift with hydration mismatch, but the actual mitigation prevents both — non-blocking.) No fabricated `width`/`height` enters the code, so the Anti-Stubbing Rule is honored (omit the image if absent, keep the card; never stub).

Verification asserts a **real** image: §8.3 first bullet requires a rendered `<img>` whose `src` is a non-empty `cdn.shopify.com` URL for a known-with-image query (`"snowboard"`), accepting the no-image branch only for a genuinely media-less product. §8.2 adds the no-CSP-violation + no-hydration-warning console check (host `cdn.shopify.com` is within the default CSP allowlist — G3 resolved). De-masks a wrong `alt_text` field map (which would yield `image === undefined` → fallback → failed positive assertion). Faithful and de-masked.

### 6. PDP link dropped cleanly — CONFIRMED

`search_catalog` products carry no `handle`/`url`, and `get_product_details.url` is `null` (probes 3/4, impl-notes lines 138–143, 204–205). The plan drops the local PDP `<Link>` entirely (§3.5 line 329, §4 line 343 "No PDP `<Link>`", AL-18 RESOLVED, OQ-8 RESOLVED). No active conditional-link design survives. §8.3 (line 510) asserts the card **omits** any local PDP `<Link>` and exposes the `checkout_url` handoff — i.e. it asserts the no-PDP-link reality rather than the old "working PDP links." No dead/placeholder link (Anti-Stubbing honored). Clean drop.

### 7. Stale cart — CONFIRMED

Probe 6 (impl-notes lines 286–307) established the standard surface does **not** auto-create on a stale `cart_id`; it returns `isError:true` (format error or "does not exist"). The plan replaces the old `cartCreated` auto-create-disambiguation with a clear-and-retry (`cartReset`) design: the action catches the `cart_id` `isError`, clears the stored `cartId`, retries once without it (fresh cart), and sets `cartReset:true` (§3.3 line 309, §5.4 line 414, §3.5 line 330, AL-15). `cartCreated` survives only in correction-documentation. §8.3 (line 513) exercises the stale-cart path and asserts the "started a new cart" note rather than a silent failure. Matches probe 6. Faithful.

### 8. Analytics intact from revision 2 — CONFIRMED

`<Analytics.ProductView>` with `data={{products: [ProductPayload]}}`, `variantId` from `variants[0].id` (PROBED present for all store products, probe 3), `price` passed as the amount **string** (not the Money object) — all preserved (§3.5 line 331, §4 line 343, AL-19 line 651, OQ-9, step 8). No live `ItemView` reference (grep-confirmed: only changelog/Sources/AL-19 correction-documentation). The rev-2 fix is undisturbed by the pivot. The string-vs-Money `price` mapping nuance remains a documented non-blocking Coder detail.

### 9. AL / OQ reconciliation — CONFIRMED sound

- **AL-12/15/18/20** — all marked RESOLVED/CORRECTED/SUPERSEDED with explicit probe pointers (probe 3, 6, 3/4, 5 respectively). Accurate against impl-notes.
- **AL-5/AL-16** — both N/A-SUPERSEDED (no agent profile on `/api/mcp`; UCP negotiation absent). Correct — these were the UCP-only concerns and the pivot dissolves them.
- **AL-21/AL-22** — the two new pivot-introduced entries. Both sound, design-resolved, with verification paths (covered in §4 and §5 above).
- **OQ-3/OQ-4/OQ-8** — closed: single surface + accepted deprecation (OQ-3), no agent profile (OQ-4), PDP link dropped (OQ-8). All correctly closed against probes.
- **Remaining open OQs (OQ-1, OQ-2, OQ-5, OQ-6, OQ-7, OQ-9)** — genuinely still open, not papering over a blocker: OQ-1 (separate MCP cart vs unified `context.cart`) is a real architecture fork with a clear demo default + production Next-step; OQ-2 (Drawer vs bespoke panel) is a real UI choice, probe-informed toward bespoke; OQ-5 (rate budget) is unverifiable for `/api/mcp` but the conservative design holds; OQ-6 (currency coverage) is USD-only with a shipped zero-decimal guard; OQ-7 (LLM planner) deferred with a deterministic-switch default; OQ-9 (Analytics wiring) effectively decided (wire it, exemption as safety net). None blocks. §7 step 1 correctly gates OQ-1/OQ-2/OQ-9 (the code-shape-changing ones) on operator confirmation with a "write the question and stop" fallback — appropriate discipline.

No AL/OQ entry papers over an unresolved blocker. The reconciliation is honest and matches the impl-notes' own OQ dispositions (lines 382–398).

### 10. Verification adequacy — CONFIRMED, de-masking standard upheld

The five-check baseline is intact and adjusted for the removed plumbing: lint (§8.2.5), `npm run build` as the type gate (§8.2.4, explicitly "no separate typecheck"), `node --test` for the 429 branch (§8.4), HTTP smoke (§8.2.1), browser/CSP/hydration check (§8.2.2). Probe 7 (UCP incompatible-profile) is correctly marked N/A (no negotiation on `/api/mcp`); the old profile-failure test is replaced by an unreachable-host forced-error test (§8.3 line 512) that still asserts a **visible** error state distinct from the empty state. Applying my earlier de-masking standard to the two new risk paths:

- **Price divergence** — §8.3 dual-path assertion (formatted decimals on both a catalog-sourced and a detail/cart-sourced render) exposes a wrong/cross-wired normalizer branch (see §4 above). Exposes, not masks.
- **Image** — §8.3 positive assertion (real `cdn.shopify.com` `src` for a known-with-image query) exposes a wrong `alt_text` field map. Exposes, not masks.
- **Empty vs error** — `"shirt"` (PROBED 0 results) → neutral empty state, Send enabled; forced failure → visible error state. Distinct and individually asserted. Exposes, not masks.
- **Stale cart** — `cartReset` "started a new cart" note asserted rather than silent failure. Exposes, not masks.

Verification is adequate and upholds the de-masking discipline established in the prior passes.

### Regression scan — clean

The pivot is a substantive but well-localized re-architecture. The rev-2 Analytics fix, the trust boundary (§3.1), the `.server.js` boundary, the locale-guard-mirrors-newsletter rule (AL-17), the injectable `fetchImpl` 429 test (§8.4), and the no-new-env-var posture all survive intact. Cross-references in the AL summary (§ lines 678–684) hold: G1↔AL-18 (PDP dropped), G2↔AL-19, G3↔AL-4 (CSP resolved), G4↔§3.3 logging, plus the new AL-21/AL-22. No OQ is orphaned. Nothing outside the pivot thread moved unexpectedly.

### Verdict rationale

The revision-3 pivot faithfully matches the probed reality recorded in the impl-notes. The endpoint pivot is complete (no active `/api/ucp/mcp`, no agent-profile plumbing, no `MCP_AGENT_PROFILE_URL`, no `structuredContent`, no `merchandise_id`, no standalone `get_product` — all grep-confirmed as correction-documentation only). The response envelope, tool names/args, stale-cart recovery, and Analytics wiring all match probes 1–6. The two pivot-introduced risks are handled concretely: the highest-risk price-format divergence (AL-21) specifies a correct two-path normalizer that I cross-checked against all three distinct probed Money shapes — including the subtle sibling-vs-nested `currency` structural difference — with a dual-path QA assertion that exposes the 100x failure mode; the missing-image-dimensions reconciliation (AL-22) is hydration-safe, Anti-Stubbing-compliant, and verified by a positive real-image assertion. No requirement was quietly dropped, and no new inconsistency was introduced. The remaining open OQs are genuine and non-blocking. The two recommendations I surfaced (let per-source normalizers own extraction rather than a single generic `toMoney`; elevate the pure normalizer unit test from optional to mandatory) are strengthenings, not correctness gaps — the integration-level verification already covers the price risk. No genuine blocking correctness gap remains.

APPROVE
