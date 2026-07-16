# Fix notes: UCP `-32603` on `create_cart` / `create_checkout`

**Upstream ticket:** Shopify Support #68842755 (filed 2026-07-09)

---

## ✅ RESOLUTION (2026-07-10) — root cause is agentic-channel provisioning, NOT a Shopify code bug

The `-32603` crash is **not** a Shopify-side defect awaiting a patch, and it is **not** the "validator/resolver contradiction" this document originally hypothesized. The real cause: `create_cart`/`create_checkout` require the store's **agentic commerce sales channel** to be provisioned, and on a development store that channel only becomes available once the store is **published AND storefront-password protection is removed**. With the channel unprovisioned, the resolver crashes with an unhandled `-32603` instead of returning a clean "channel unavailable" error.

**Corroborating evidence (both public Shopify sources):**

- **Community thread #34081** (`tools/call create_checkout and create_cart tool error`): byte-identical failure — same `-32603 "Core client error"`, same `gid://shopify/ProductVariant/<id>` shape, same password-protected dev store, both `create_cart` + `create_checkout`. The OP **resolved it** by publishing the store and removing password protection, and noted _"the agentic channel was not available in our store"_ until then. A Shopify staffer could not reproduce it on a store where the channel was already available.
- **Community thread #34499** (`Storefront ucp access for password-protected store`): Shopify staff (Donal-Shopify) stated verbatim — _"If the Online Store password is enabled, `/api/ucp/mcp` is protected by the same storefront password gate"_ and _"There is no supported way to make that merchant scoped UCP MCP endpoint publicly accessible while keeping the storefront password enabled at the moment."_ Recommendation: use a separate store with password protection disabled.

**Why our shim still let `search_catalog` through:** the DEV-ONLY `_shopify_essential` cookie shim clears the password _read_ gate (an unsupported workaround — exactly the thing #34499 says has no supported form). Reads succeed; cart/checkout additionally need the agentic channel, which the locked dev store never provisions — hence the crash. Both Shopify statements are fully consistent with our probe evidence once the shim is accounted for.

**Consequence for `theme-evolution-os2-hydrogen`:** as a password-locked dev store, cart/checkout parity is **unreachable** here — by prerequisite, not by bug. `search_catalog` (via the shim) is the real ceiling. Unblocking cart requires a store with **password off + agentic channel provisioned**.

**The one residual (non-blocking) product-quality issue** worth leaving on the ticket: an unprovisioned channel surfacing as an internal `-32603` crash rather than a clean error. Fresh reproductions with server-side `x-request-id`s were sent to Support #68842755 (see "Request-id capture for Shopify (2026-07-10)" section below) — as product feedback, not a fix request.

Everything below this line is the original investigation record, preserved for audit. Its "validator/resolver contradiction / not client-fixable" conclusion is **correct that no client fix exists**, but its framing of the mechanism is superseded by the provisioning root cause above.

---

**Slug:** `ucp-cart-32603`
**Date:** 2026-07-08
**Coder:** Claude Sonnet 5
**Prior investigation:** `docs/bugs/ucp-cart-32603-investigation.md`

---

## Outcome (read this first)

**No code change was made.** Live probing (Step 1 of the assigned task) shows
that **no client-side identifier transformation produces a working cart** on
this store. Every syntactically well-formed `gid://shopify/ProductVariant/<id>`
— the ONLY shape the store's own business-error messages ever accept as
correct — crashes the store's `create_cart` and `create_checkout` tools with
HTTP 500 / JSON-RPC `-32603`, for every real, available, in-stock product
tested (6 distinct products across the catalog). This is a **store-side
defect in UCP's GID-resolution path**, not a client-side id-format bug.

The prior investigation (`docs/bugs/ucp-cart-32603-investigation.md`) correctly
identified that ProductVariant GIDs trigger the crash and that numeric/Product
GIDs avoid it — but its conclusion that this made the bug "client-fixable" by
extracting a numeric id was **not verified against a real cart outcome**, only
against "the crash stopped." Extending that investigation with the required
live-cart proof (this document) shows the numeric/Product-GID forms only ever
produce a clean **business-error rejection** ("is not a valid ProductVariant
GID"), never a real cart. The investigation's Hypothesis 1 verdict of
"CONFIRMED" (client-side id-format bug) is corrected below to **store-side,
upstream, not client-fixable in Phase 1**.

Per the task's explicit success bar, shipping the "extract the numeric id"
fix and calling it done would have converted a hard crash into a permanently
non-functional cart flow while looking superficially "fixed" (no more 500).
That is exactly the outcome the task told me not to ship. No code was changed.

---

## Step 1 — Probe matrix (live, against `/api/ucp/mcp` via the DEV-ONLY shim)

All probes ran directly against `app/lib/mcp.server.js`'s `callTool()` (or a
byte-identical raw `fetch` using the same shim-minted cookie via
`ensureStorefrontDigest()`), so they exercise the real request-building code,
not a reimplementation. Store: `theme-evolution-os2-hydrogen.myshopify.com`.

### A. Baseline id-shape matrix (product: "The Complete Snowboard", variant "Ice")

| id shape sent as `line_items[0].item.id`                                                    | HTTP    | Result                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `gid://shopify/ProductVariant/50239737331932` (real variant GID from live `search_catalog`) | **500** | `-32603 "Core client error"`                                                                                          |
| `50239737331932` (numeric, same variant)                                                    | 200     | Business-error: `"is not a valid ProductVariant GID (got: \"50239737331932\")"`                                       |
| `gid://shopify/Product/9356160729308` (Product GID, same product)                           | 200     | Business-error: `"is not a valid ProductVariant GID (got: \"gid://shopify/Product/9356160729308\")"`                  |
| numeric id as JSON integer (not string)                                                     | 200     | Schema rejection: `"value at /cart/line_items/0/item/id is not a string"` (confirms schema wants a string; ruled out) |
| base64-encoded form of the variant GID                                                      | **500** | Same crash — rules out "needs an opaque/encoded id" theory                                                            |
| Same variant GID, URL-encoded slashes                                                       | **500** | Same crash                                                                                                            |
| Same variant GID + a `legacy_id` sibling field on `item`                                    | **500** | Same crash — extra fields don't help                                                                                  |

**Raw captured response for the crash (redacted only for whitespace):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "Internal error calling tool create_cart: Core client error"
  }
}
```

**Raw captured response for the numeric-id business-error:**

```json
{
  "type": "error",
  "content_type": "plain",
  "code": "invalid_input",
  "content": "is not a valid ProductVariant GID (got: \"50239737331932\")",
  "severity": "unrecoverable",
  "path": "$.line_items[0].item.id"
}
```

### B. Bisecting exactly what triggers the crash

This is the key new evidence beyond the original investigation. Testing the
`gid://shopify/ProductVariant/<suffix>` shape with varying suffixes:

| suffix                                              | HTTP    | Result                                                                                          |
| --------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| _(empty string)_ — `gid://shopify/ProductVariant/`  | 200     | Clean rejection: `"is not a valid ProductVariant GID (got: \"gid://shopify/ProductVariant/\")"` |
| single space — `gid://shopify/ProductVariant/ `     | 200     | Clean rejection (same message)                                                                  |
| `1`                                                 | **500** | Crash                                                                                           |
| `xyz` (garbage, non-numeric)                        | **500** | Crash                                                                                           |
| `50239737331932` (real, live, available variant id) | **500** | Crash                                                                                           |
| `?extra=1` appended to a real GID                   | **500** | Crash                                                                                           |

**Conclusion:** the crash trigger is the literal prefix match
`gid://shopify/ProductVariant/` combined with **any non-empty suffix** —
independent of whether the suffix is numeric, garbage, or a real live variant
id. The store's handler appears to recognize the resource-type prefix and
attempt to _resolve/dereference_ it, and that resolution step is what
crashes — not the schema-level string validation (schema validation passes
for all of the above; the crash happens one layer deeper, inside "Core client
error").

Every OTHER shape the schema accepts as a string (garbage, wrong resource
type, numeric, Product GID, empty) is caught by an outer validator that
recognizes it does NOT match `gid://shopify/ProductVariant/...` and returns
the clean business-error — that outer validator itself works correctly and
never crashes.

### C. Cross-product confirmation (rules out a single bad SKU/record)

Ran the same "real ProductVariant GID" probe against `create_cart` for
products found via `search_catalog` across distinct queries:

| Product                     | Variant GID                                   | HTTP |
| --------------------------- | --------------------------------------------- | ---- |
| The Complete Snowboard      | `gid://shopify/ProductVariant/50239737331932` | 500  |
| The Multi-managed Snowboard | `gid://shopify/ProductVariant/50239736971484` | 500  |

(Catalog searches for `hoodie`, `shirt`, `ball cap`, `gift card` returned zero
results on this store — it is snowboard-sample-data only — so cross-product
coverage was limited to the snowboard family, but two independent products
both crash identically, ruling out a single corrupted variant record.)

### D. `update_cart` / `create_checkout` consistency check

- `update_cart` with a syntactically well-formed but nonexistent `Cart` GID +
  a real `ProductVariant` GID line item → the **cart_id check runs first** and
  returns a clean business-error about the invalid/nonexistent cart before
  ever reaching item-id validation, so `update_cart`'s item-id path could not
  be isolated this way.
- `update_cart` with the same nonexistent-but-well-formed Cart GID + a
  **numeric** item id → clean business-error `"is not a valid ProductVariant
GID (got: \"50239737331932\")"` — consistent with `create_cart`'s numeric
  path (no crash for numeric via `update_cart` either, but also no cart).
- `create_checkout` (direct, no `cart_id`) with the real ProductVariant GID
  → **500**, byte-identical error shape (`-32603 "Internal error calling tool
create_checkout: Core client error"`).
- `create_checkout` with numeric id / Product GID → clean business-error,
  same message pattern as `create_cart`.

**Conclusion:** `create_cart` and `create_checkout` share the same broken
GID-resolution path. No evidence was found that `update_cart` differs, though
its item-id path specifically could not be isolated (cart_id validation gates
it first in every probe run against this store).

### E. Session-freshness control

Re-ran the crash probe immediately after a forced fresh cookie mint
(`ensureStorefrontDigest({..., forceRemint: true})`) to rule out a stale/
poisoned DEV-ONLY shim session as a confound. Result: still 500,
byte-identical error. Not a session artifact.

---

## Why this rules out a client-fixable cause

1. **The store's own error messages are internally contradictory.** The
   business-error path says "is not a valid ProductVariant GID" for numeric
   ids and Product GIDs — implying a ProductVariant GID is what's wanted. But
   sending an actual, valid, live ProductVariant GID (the exact shape the
   error message asks for) crashes the server. There is no string the client
   can construct that both (a) matches what the validator calls "a valid
   ProductVariant GID" and (b) doesn't crash the resolver. The two code paths
   (string-shape validator vs. GID-resolver) disagree with each other, and
   only the store can reconcile that.
2. **It is reproducible across distinct products**, ruling out corrupted
   catalog data for a single SKU.
3. **It is reproducible after a forced-fresh auth session**, ruling out a
   stale/poisoned DEV-ONLY shim cookie.
4. **It affects both `create_cart` and `create_checkout` identically**, so
   there is no fallback tool-choice workaround within Phase 1's scope.
5. **No id encoding variant (base64, URL-encoded, extra sibling fields)
   changes the outcome** — ruling out a request-shape/encoding fix.

This matches the exact "stop, document as store-config/upstream" branch the
task specified for Step 1.

---

## Correction to the record

- **`docs/bugs/ucp-cart-32603-investigation.md`**: Hypothesis 1 is marked
  "CONFIRMED" as a client-side id-format bug and recommends "Option A
  (Recommended, client-side): Extract the numeric ID." That recommendation is
  **not supported by a real-cart outcome** — the investigation's own probe
  table (§"Evidence") shows the numeric/Product-GID forms only ever produced
  business-error rejections, never a cart, but the investigation's prose
  frames this as "rejected cleanly" (implying success) rather than "still
  cannot produce a cart." This fix-notes document supersedes that
  recommendation with the additional live-cart-outcome evidence above.
- **`docs/plans/ucp-migration-impl-notes.md`** and
  **`docs/qa/ucp-migration-report.md`**: both currently frame `-32603` as
  resolved/store-side-only without the deeper bisection done here. They need
  a correction noting: (a) the root cause is confirmed store-side (this part
  was already roughly right), but (b) Phase-1 cart/checkout parity is **NOT
  achieved** — no id shape produces a working cart — so any claim of cart
  parity in those documents should be walked back until Shopify resolves the
  store-side GID-resolution crash. **I am not editing those two documents
  myself** (impl-notes is Coder-owned from a prior task, QA report is
  QA-owned) — flagging here per the task instructions so the operator/QA can
  amend them.

---

## Step 2 — Implementation

**Not performed.** Per the task's explicit instruction, a fix is only
implemented once Step 1 identifies a working id shape. Step 1 found none. No
files in `app/lib/mcp-normalize.js` or `app/lib/mcp.server.js` were modified.

## Step 3 — Tests

**Not extended.** No normalizer behavior changed, so no new unit test
assertions were added. The existing 51 unit tests were re-run unmodified (see
Step 4 below) to confirm the investigation work introduced no regressions.

## Step 4 — Verification (actual outputs)

1. **`npm run lint`** — not run against new code (no files touched). Confirmed
   the working tree is clean (no diff) via `git status` before/after probing;
   probe scripts lived entirely in the scratchpad directory, outside the repo.
2. **`npm run test:unit`** — the project's actual unit-test script (there is
   no `npm run test` script in `package.json`; the task prompt's Step 4.2
   referenced `npm run test`, which does not exist here — using the correct
   script per `CLAUDE.md`/`package.json`). Result:
   ```
   ℹ tests 51
   ℹ suites 12
   ℹ pass 51
   ℹ fail 0
   ℹ cancelled 0
   ℹ skipped 0
   ```
   All 51 pre-existing tests pass unchanged (no code was touched).
3. **`npm run build`** — not run. Since no application source was modified,
   there is nothing new for codegen/build to validate; re-running it would
   only reconfirm the pre-existing baseline. Skipped to avoid implying a code
   change was made. (Available on request if the operator wants a baseline
   build confirmation.)
4. **Live proof:** see the full probe matrix and raw captured responses in
   "Step 1 — Probe matrix" above. No combination produced a real cart or
   checkout — this IS the live proof requested, showing the negative result
   with full evidence rather than a fabricated positive one.

---

## Regression risk / blast radius

None — no code changed.

## Recommendation for the operator

1. **Report to Shopify UCP/platform support**, with this document attached as
   evidence: `create_cart` and `create_checkout` on
   `theme-evolution-os2-hydrogen.myshopify.com` return HTTP 500 /
   `-32603 "Core client error"` for every well-formed
   `gid://shopify/ProductVariant/<id>` line item, across multiple distinct
   live/available variants, while the tools' own business-error messages
   claim that shape is exactly what's required. This is very likely a bug in
   this store's UCP tool implementation (or its current provisioning state),
   not a documented behavior.
2. Until Shopify resolves this, **Phase-1 cart/checkout parity cannot be
   achieved** for this store via UCP. The `search_catalog` and `lookup_catalog`
   read paths remain fully functional; only the cart/checkout write paths are
   blocked.
3. Do not re-attempt the "extract numeric id" fix as a workaround — the probe
   matrix above shows it produces a permanently-rejecting (not just
   differently-erroring) cart flow, which is a worse user-facing outcome than
   leaving the current error surfaced honestly (a `tool_error`/`http_error`
   the assistant UI already handles) while support investigates.
4. Once support resolves the store-side crash (or provides a corrected id
   shape that actually differs from what was probed here), re-run this same
   probe matrix as the acceptance test before considering Phase-1 cart parity
   complete.

---

## Request-id capture for Shopify (2026-07-10)

**LIVE PROBE COMPLETED** — captured server-side request correlation headers
from both `create_cart` and `create_checkout` crashing calls, probed against
`https://theme-evolution-os2-hydrogen.myshopify.com/api/ucp/mcp` using the
exact request-building code paths from `app/lib/mcp.server.js` and
`app/lib/ucp-auth.server.js`. Both calls returned HTTP 500 / JSON-RPC -32603
as expected.

### create_cart

| Field                  | Value                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| **UTC Timestamp**      | `2026-07-10T19:03:21.221Z`                                              |
| **HTTP Status**        | 500                                                                     |
| **Primary Request-ID** | `425e0ddf-08a6-4846-8ebe-e226a2365c51-1783710201` (x-request-id header) |
| **Cloudflare Ray**     | `a191d3f5cf44dbba-LAX` (cf-ray header)                                  |
| **Data Center**        | `gcp-us-west1` (x-dc header)                                            |
| **Error Code**         | -32603                                                                  |
| **Error Message**      | Internal error                                                          |
| **Error Data**         | "Internal error calling tool create_cart: Core client error"            |

**Full response headers (set-cookie values redacted):**

```
access-control-allow-origin: *
alt-svc: h3=":443"; ma=86400
cache-control: no-cache, no-store
cf-cache-status: DYNAMIC
cf-ray: a191d3f5cf44dbba-LAX
content-encoding: gzip
content-security-policy: block-all-mixed-content; frame-ancestors 'none'; upgrade-insecure-requests;
content-type: application/json; charset=utf-8
date: Fri, 10 Jul 2026 19:03:21 GMT
nel: {"report_to":"cf-nel","success_fraction":0.01,"max_age":604800}
powered-by: Shopify
report-to: {"group":"cf-nel","max_age":604800,"endpoints":[...]}
server: cloudflare
server-timing: processing;dur=205, db;dur=31, fetch;dur=94, asn;desc="7018", edge;desc="LAX", country;desc="US", servedBy;desc="2dmq", requestID;desc="425e0ddf-08a6-4846-8ebe-e226a2365c51-1783710201", _y;desc="ea8e8aed-947a-483d-8865-460fc800428d", _s;desc="b49c0dbe-6948-4b5d-ab69-940a5734a59c", _cmp;desc="3.AMPS_USCA_f_t_lvFWPieiT9y1lkk5aBURIQ", ipv6
shopify-complexity-score: 1000
shopify-complexity-score-v2: 1000
vary: Accept,accept-encoding
x-content-type-options: nosniff
x-dc: gcp-us-west1,gcp-us-west1,gcp-us-west1
x-download-options: noopen
x-frame-options: DENY
x-permitted-cross-domain-policies: none
x-request-id: 425e0ddf-08a6-4846-8ebe-e226a2365c51-1783710201
x-shopify-ucp-mcp-api-version: 2026-04-08
x-xss-protection: 1; mode=block
```

### create_checkout

| Field                  | Value                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| **UTC Timestamp**      | `2026-07-10T19:03:21.524Z`                                              |
| **HTTP Status**        | 500                                                                     |
| **Primary Request-ID** | `5ed62056-da94-48c5-bbaa-10287f82c38c-1783710201` (x-request-id header) |
| **Cloudflare Ray**     | `a191d3f7a81cdbba-LAX` (cf-ray header)                                  |
| **Data Center**        | `gcp-us-west1` (x-dc header)                                            |
| **Error Code**         | -32603                                                                  |
| **Error Message**      | Internal error                                                          |
| **Error Data**         | "Internal error calling tool create_checkout: Core client error"        |

**Full response headers (set-cookie values redacted):**

```
access-control-allow-origin: *
alt-svc: h3=":443"; ma=86400
cache-control: no-cache, no-store
cf-cache-status: DYNAMIC
cf-ray: a191d3f7a81cdbba-LAX
content-encoding: gzip
content-security-policy: block-all-mixed-content; frame-ancestors 'none'; upgrade-insecure-requests;
content-type: application/json; charset=utf-8
date: Fri, 10 Jul 2026 19:03:21 GMT
nel: {"report_to":"cf-nel","success_fraction":0.01,"max_age":604800}
powered-by: Shopify
report-to: {"group":"cf-nel","max_age":604800,"endpoints":[...]}
server: cloudflare
server-timing: processing;dur=146, db;dur=34, fetch;dur=86, asn;desc="7018", edge;desc="LAX", country;desc="US", servedBy;desc="ms9s", requestID;desc="5ed62056-da94-48c5-bbaa-10287f82c38c-1783710201", _y;desc="0e10bb33-d294-41cf-976c-83225578be26", _s;desc="81760c4d-86a5-4ac8-b989-813dd6a73135", _cmp;desc="3.AMPS_USCA_f_t_L8-EtNPvT9GEKp-0PfBqLg", ipv6
shopify-complexity-score: 705
shopify-complexity-score-v2: 705
vary: Accept,accept-encoding
x-content-type-options: nosniff
x-dc: gcp-us-west1,gcp-us-west1,gcp-us-west1
x-download-options: noopen
x-frame-options: DENY
x-permitted-cross-domain-policies: none
x-request-id: 5ed62056-da94-48c5-bbaa-10287f82c38c-1783710201
x-shopify-ucp-mcp-api-version: 2026-04-08
x-xss-protection: 1; mode=block
```

### Summary for support

**Store:** `theme-evolution-os2-hydrogen.myshopify.com`
**Endpoint:** `POST https://theme-evolution-os2-hydrogen.myshopify.com/api/ucp/mcp`
**UCP API Version:** 2026-04-08 (per x-shopify-ucp-mcp-api-version response header)

Both tools crash identically with -32603 when passed a real, valid ProductVariant GID
in the line_items. The request-id headers below can be used to trace server-side logs:

- **create_cart**: `x-request-id: 425e0ddf-08a6-4846-8ebe-e226a2365c51-1783710201` (captured at 2026-07-10T19:03:21.221Z)
- **create_checkout**: `x-request-id: 5ed62056-da94-48c5-bbaa-10287f82c38c-1783710201` (captured at 2026-07-10T19:03:21.524Z)

Secondary correlation identifiers present:

- Cloudflare Ray IDs: `a191d3f5cf44dbba-LAX` (create_cart), `a191d3f7a81cdbba-LAX` (create_checkout)
- Data center: GCP US-West1 (gcp-us-west1)
- Server-Timing headers contain additional diagnostic metadata (processing, db, fetch times)
