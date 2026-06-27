# Implementation Notes: `mcp-shopping-assistant`

Author: Coder
Date: 2026-06-27
Status: **PROBE STOP — feature code NOT written**

---

## Probe stop condition triggered

The plan's §8.1 probe sequence was executed IN FULL before any feature code was written. Multiple probes produced findings that contradict plan assumptions. Per explicit task and plan instructions:

> "If ANY probe surfaces a finding that contradicts the plan's assumptions, STOP and report the discrepancy in impl-notes and to me. Do NOT improvise around it or stub it out. A contradicted assumption is a re-plan trigger, not a code-around."

No feature files were created. This document records all probe results for use in re-planning.

---

## Probe results (§8.1 probes executed in order)

### Probe 1 — UCP catalog tools/list (`/api/ucp/mcp`) — FAIL / STOP CONDITION

**Command run:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://theme-evolution-os2-hydrogen.myshopify.com/api/ucp/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1,"params":{}}'
```

**Result:** `302` redirect to `https://theme-evolution-os2-hydrogen.myshopify.com/password`

The store's Liquid storefront has a **storefront password** enabled. The `/api/ucp/mcp` endpoint is subject to this password redirect. Tried with and without:
- `Accept: application/json` header
- `X-Shopify-Storefront-Access-Token` header
- Various hosted profile fixture URLs in the body

All returned `302` regardless of any headers or profile URLs.

**Contradiction to plan (AL-1):** The plan assumed `/api/ucp/mcp` is accessible as the primary catalog endpoint. It is NOT accessible on this store. This is the hardest stop condition.

**Implication:** `MCP_AGENT_PROFILE_URL` env var is not usable because the UCP endpoint is blocked. The entire §3.1 two-endpoint architecture cannot be built as designed.

---

### Probe 2 — Standard cart/policies tools/list (`/api/mcp`) — PASS

**Command run:**
```bash
curl -s -X POST https://theme-evolution-os2-hydrogen.myshopify.com/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1,"params":{}}'
```

**Result:** HTTP 200, tools returned:
- `search_catalog`
- `get_cart`
- `update_cart`
- `search_shop_policies_and_faqs`
- `get_product_details` (**NOTE:** NOT `get_product` as the plan assumed)

The `/api/mcp` endpoint bypasses the storefront password and is fully accessible.

**Every tool the feature needs is present on `/api/mcp`.** This is the viable single-endpoint path.

**Additional finding:** Each `update_cart` and `search_catalog` response includes a DEPRECATION NOTICE:
```
"DEPRECATION NOTICE: This tool is served by the Storefront MCP server at /api/mcp and will no longer be accessible after August 31, 2026. Migrate to the UCP-conforming Cart MCP tools at /api/ucp/mcp."
```
This appears in `result.content[1].text` and can be ignored in production code.

---

### Probe 3 — Real `search_catalog` response (AL-4 media fields, AL-18 handle/variants, AL-19 variant ids)

**Verified command (text query + context required):**
```bash
curl -s -X POST https://theme-evolution-os2-hydrogen.myshopify.com/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"search_catalog","arguments":{"catalog":{"query":"snowboard","context":{"address_country":"US"}}}}}'
```

**Response envelope (AL-12 confirmed WRONG):**
The plan assumed `data.result.structuredContent`. The actual envelope is:
```
data.result.content[0].text  → stringified JSON → parse → { ucp, products[], pagination, messages, instructions }
data.result.isError          → boolean
```
`result.structuredContent` does NOT appear in the response.

**Actual first product shape:**
```json
{
  "id": "gid://shopify/Product/9356161155292",
  "title": "The Inventory Not Tracked Snowboard",
  "description": {
    "html": "Engineered with sustainable Graphene-infused Tech Silk..."
  },
  "price_range": {
    "min": { "amount": 94995, "currency": "USD" },
    "max": { "amount": 94995, "currency": "USD" }
  },
  "variants": [
    {
      "id": "gid://shopify/ProductVariant/50239738609884",
      "title": "Default Title",
      "description": { "html": "..." },
      "price": { "amount": 94995, "currency": "USD" },
      "availability": { "available": true },
      "options": [{ "name": "Title", "label": "Default Title" }],
      "media": [
        {
          "type": "image",
          "url": "https://cdn.shopify.com/s/files/1/0830/7726/7676/files/snowboard_purple_hydrogen.png?v=1778121249"
          // NOTE: No alt_text on variant-level media
        }
      ]
    }
  ],
  "options": [{ "name": "Title", "values": [{ "label": "Default Title" }] }],
  "media": [
    {
      "type": "image",
      "url": "https://cdn.shopify.com/s/files/1/0830/7726/7676/files/snowboard_purple_hydrogen.png?v=1778121249",
      "alt_text": "Top and bottom view of a snowboard..."
    }
  ],
  "tags": ["Accessory", "Sport", "Winter"]
}
```

**AL-4 CONFIRMED — media field names:**
- Product-level `media[]`: `{type, url, alt_text}` — field name is `alt_text` NOT `altText`
- Variant-level `media[]`: `{type, url}` only — no `alt_text` at variant level
- NO `width` or `height` fields in any media object
- Media URL host: `cdn.shopify.com` (within default CSP allowlist — G3 concern resolved)

**AL-18 CONFIRMED — no `handle` field:**
- Products have `id` (GID format `gid://shopify/Product/...` NOT the UPID `gid://shopify/p/...` the plan expected)
- NO `handle` field on any product
- NO `url` field on any product from `search_catalog`
- PDP link cannot be constructed from search data (plan's AL-18 prediction correct)

**AL-19 CONFIRMED — `variants[].id` present:**
- `variants[0].id` = `"gid://shopify/ProductVariant/50239738609884"` — PRESENT and usable
- This serves as `firstVariantId` for Analytics and add-to-cart

**Price format:** Integer minor units: `{amount: 94995, currency: "USD"}` = $949.95 USD
`currency` field name (not `currencyCode`) — requires rename for `<Money>` component.

**Text search behavior:**
- Text queries without context return results (bare "snowboard" → 10 products)
- Text queries for terms not in store return 0 results ("shirt", "gift" → 0, store has no such products)
- Store has 15 products, all snowboard-related (Shopify sample data)
- Always include `context.address_country` for best results

---

### Probe 4 — Real `get_product` response (AL-18 handle/url) — CONFIRMED WITH DEVIATIONS

**Tool name:** `get_product_details` (NOT `get_product` as the plan assumed — tool-name mismatch)

**Command run:**
```bash
curl -s -X POST https://theme-evolution-os2-hydrogen.myshopify.com/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"get_product_details","arguments":{"product_id":"gid://shopify/Product/9356161155292"}}}'
```

**Actual response shape** (under `JSON.parse(result.content[0].text).product`):
```json
{
  "product_id": "gid://shopify/Product/9356161155292",
  "title": "The Inventory Not Tracked Snowboard",
  "description": "Engineered with sustainable Graphene-infused...",
  "url": null,
  "image_url": "https://cdn.shopify.com/s/files/...",
  "images": [
    {
      "url": "https://cdn.shopify.com/s/files/...",
      "alt_text": "Top and bottom view of a snowboard..."
    }
  ],
  "options": [{ "name": "Title", "values": ["Default Title"] }],
  "total_variants": 1,
  "price_range": {
    "min": "949.95",
    "max": "949.95",
    "currency": "USD"
  },
  "selectedOrFirstAvailableVariant": {
    "variant_id": "gid://shopify/ProductVariant/50239738609884",
    "title": "Default Title",
    "price": "949.95",
    "currency": "USD",
    "image_url": "...",
    "image_alt_text": "...",
    "available": true,
    "selected_options": [{ "name": "Title", "value": "Default Title" }]
  }
}
```

**AL-18 CONFIRMED — `url` is null:**
The `url` field exists but is `null`. No handle is provided. PDP link cannot be constructed from `get_product_details` either. Checkout handoff is the only destination.

**Price format divergence (CRITICAL):**
`get_product_details` returns prices as DECIMAL STRINGS (`"949.95"`) with `currency` separately. This is DIFFERENT from `search_catalog` which returns INTEGER MINOR UNITS (`94995`). Two different formats in the same feature.

**Field name differences from plan's `getProduct` model:**
- `product_id` not `id`
- `selectedOrFirstAvailableVariant.variant_id` not `variants[0].id`
- `images[]` not `media[]` at product level
- `price_range.min` is a decimal string, not `{amount, currency}`

---

### Probe 5 — Real `update_cart` request/response body (AL-20 `add_items` vs `lines`) — CONFIRMED WITH DEVIATIONS

**Command run (with actual variant ID from probe 3):**
```bash
curl -s -X POST https://theme-evolution-os2-hydrogen.myshopify.com/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"update_cart","arguments":{"add_items":[{"product_variant_id":"gid://shopify/ProductVariant/50239738609884","quantity":1}]}}}'
```

**AL-20 CONFIRMED — `add_items` is the correct key.** Sending `add_items` with `merchandise_id` produced:
```
"Invalid arguments: object at `/add_items/0` is missing required properties: product_variant_id"
```

**CRITICAL FIELD NAME DEVIATION:** The actual field is `product_variant_id` NOT `merchandise_id` as both the plan's §0.5 and the docs example showed.

The confirmed inputSchema:
```json
"add_items": [{ "product_variant_id": "gid://shopify/ProductVariant/...", "quantity": 1 }]
```

**Successful `update_cart` response structure:**
```json
// result.content[0].text → parse → 
{
  "instructions": "...",
  "cart": {
    "id": "gid://shopify/Cart/hWNDolz1YzpVe4NxumHFovrE?key=...",
    "created_at": "2026-06-27T09:12:30.177Z",
    "updated_at": "...",
    "lines": [
      {
        "id": "gid://shopify/CartLine/84ec826d-...?cart=...",
        "quantity": 1,
        "cost": {
          "total_amount": { "amount": "949.95", "currency": "USD" },
          "subtotal_amount": { "amount": "949.95", "currency": "USD" }
        },
        "merchandise": {
          "id": "gid://shopify/ProductVariant/50239738609884",
          "title": "Default Title",
          "product": {
            "id": "gid://shopify/Product/9356161155292",
            "title": "The Inventory Not Tracked Snowboard"
          }
        }
      }
    ],
    "delivery": {},
    "discounts": {},
    "gift_cards": [],
    "cost": {
      "total_amount": { "amount": "949.95", "currency": "USD" },
      "subtotal_amount": { "amount": "949.95", "currency": "USD" }
    },
    "total_quantity": 1,
    "checkout_url": "https://theme-evolution-os2-hydrogen.myshopify.com/cart/c/hWNDolz1YzpVe4NxumHFovrE?key=..."
  },
  "errors": []
}
```

**Cart cost format:** DECIMAL STRINGS `"949.95"` with `currency` (not `currencyCode`) — same as `get_product_details`.

**`checkout_url` is present at the cart level** — usable for the checkout handoff, but NOT on individual variants in `search_catalog`.

---

### Probe 6 — Stale/invalid `cart_id` behavior (AL-15) — CONFIRMED, BEHAVIOR DIFFERENT FROM PLAN

**Invalid format test:**
```bash
cart_id: "gid://shopify/Cart/does-not-exist"
```
Result: `isError: true`, text: `"Invalid cart_id format. Expected a Shopify Cart GID (e.g., 'gid://shopify/Cart/Z212345?key=123456789')."`

**Valid format but non-existent:**
```bash
cart_id: "gid://shopify/Cart/nonexistentcartabc?key=deadbeefdeadbeef"
```
Result:
```json
{ "isError": true, "errors": [{"field": ["cart_id"], "message": "The specified cart does not exist."}] }
```

**AL-15 DEVIATION FROM PLAN:** The plan assumed the stale cart might silently auto-create a new cart. The actual behavior is:
- Invalid format → `isError: true`, format error
- Valid format but non-existent → `isError: true`, "does not exist" error

**The standard `/api/mcp` `update_cart` does NOT auto-create a new cart on a stale `cart_id`.** It returns an explicit error. The `cartCreated` disambiguation in the plan (§5.4) is not needed for this surface. Instead, the action must handle the `isError: true` + `errors[0].message` path and offer to create a new cart.

---

### Probe 7 — Incompatible/unreachable profile vs `/api/ucp/mcp`

**CANNOT EXECUTE.** The `/api/ucp/mcp` endpoint returns `302` regardless of request body. No profile URL testing was possible.

---

## Summary: contradictions to plan assumptions

| # | Plan assumption | Actual finding | Severity |
|---|----------------|----------------|----------|
| 1 | `/api/ucp/mcp` is the primary catalog endpoint | Returns 302 redirect to /password — inaccessible | **STOP CONDITION** |
| 2 | `MCP_AGENT_PROFILE_URL` env var required | Not applicable (UCP endpoint blocked) | **STOP CONDITION** |
| 3 | Response envelope: `data.result.structuredContent` | `data.result.content[0].text` (stringified JSON) | Requires code change |
| 4 | `update_cart` field: `merchandise_id` | Actual field: `product_variant_id` | Requires code change |
| 5 | Tool name: `get_product` | Actual tool name: `get_product_details` | Requires code change |
| 6 | Media field: `altText` | Actual field: `alt_text` | Requires code change |
| 7 | Media fields: `width`, `height` present | NOT present in actual response | Requires code change |
| 8 | Stale cart auto-creates new cart (AL-15) | Returns explicit error; does NOT auto-create | Changes design |
| 9 | `get_product_details` prices: minor unit integers | Actually decimal strings: `"949.95"` | Requires code change |
| 10 | `search_catalog` products have `handle` | NO `handle` field; `url` is `null` in `get_product_details` too | Confirmed AL-18 |
| 11 | `checkout_url` per variant in catalog response | NOT present in catalog variants | Affects UX flow |

---

## What IS confirmed and viable

The following building blocks are CONFIRMED working:

1. **Endpoint:** `/api/mcp` (single endpoint for everything — catalog + cart)
2. **Tools available:** `search_catalog`, `get_cart`, `update_cart`, `search_shop_policies_and_faqs`, `get_product_details`
3. **No auth required** (no agent profile, no storefront token for MCP calls)
4. **`search_catalog` works** with text queries + `context.address_country` — returns real products
5. **`variants[].id` present** in `search_catalog` results — usable for add-to-cart and Analytics
6. **Media URL host** is `cdn.shopify.com` — within default CSP allowlist
7. **Cart `checkout_url`** present on `update_cart` and `get_cart` responses — usable for handoff
8. **`add_items` key** confirmed correct for `update_cart`
9. **Store has 15 products** (all snowboard-related — Shopify sample data)

---

## What needs to change in the plan to proceed

The re-plan needs to address these specific items:

1. **Endpoint architecture:** Replace the two-endpoint design with a single `/api/mcp` endpoint for ALL tools. Remove all references to `/api/ucp/mcp` as the catalog endpoint. Remove `MCP_AGENT_PROFILE_URL` env var requirement from §5.2.

2. **Response parsing:** Across `callTool`, change `data.result.structuredContent` to `JSON.parse(data.result.content[0].text)`. Add `isError` check from `data.result.isError`. Ignore `content[1].text` (deprecation notice).

3. **`update_cart` field name:** Replace `merchandise_id` with `product_variant_id` throughout the plan.

4. **Tool name:** Replace `get_product` with `get_product_details` throughout the plan, and update the argument from `catalog.id` to `product_id`.

5. **Media field name:** Replace `altText` with `alt_text` in `normalizeCatalogProduct`. Accept no `width`/`height` from MCP; use Hydrogen `<Image src=...>` external URL form or `<img>` fallback.

6. **Price format divergence:**
   - `search_catalog`: `price_range.min.amount` is INTEGER MINOR UNITS + `currency` field → needs `minorUnitsToDecimalString()` conversion and `currency` → `currencyCode` rename
   - `get_product_details` price: already DECIMAL STRING + `currency` field → skip division, just rename `currency` → `currencyCode`
   - Cart cost: already DECIMAL STRING + `currency` field → same as above

7. **Stale cart behavior:** Remove `cartCreated` detection logic. Instead: when `isError: true` and error field is `cart_id`, return an error asking the user to try adding to cart again (a new cart will be created). On `add` intent with no `cart_id`, `update_cart` creates a fresh cart automatically.

8. **PDP link:** Already addressed in plan (AL-18 confirmed no handle) — no changes needed.

9. **No UCP negotiation failure testing:** Probe 7 was impossible; skip the incompatible-profile test from §8.3. Update the impl-notes (here) to document this gap.

10. **`get_product_details` response model:** The product detail response has a completely different shape from what `search_catalog` returns. The normalizer for `get_product_details` needs its own mapping (field names: `product_id`, `selectedOrFirstAvailableVariant.variant_id`, `images[]`, decimal price strings, etc.).

---

## Open questions requiring operator decision before re-plan

**OQ-1 (cart architecture):** Confirmed path is separate MCP cart with checkout handoff (plan default). Unified cart integration remains a next step. No change needed.

**OQ-2 (UI host):** `Drawer.jsx` API inspected: `{heading, open, onClose, openFrom, children}` via `useDrawer()`. It uses a full-screen Dialog overlay with backdrop. A lightweight bespoke panel is recommended for the chat assistant (the Drawer is designed for the cart/menu pattern; a chat panel benefits from a fixed-position sidebar that doesn't cover all content).

**OQ-3 (cart tool surface):** Confirmed: `/api/mcp` `update_cart` is the only accessible surface. The UCP Cart MCP at `/api/ucp/mcp` is blocked. Aug 31 2026 deprecation risk remains; no workaround available until storefront password is removed or UCP endpoint becomes accessible.

**OQ-4 (agent profile):** Not applicable — UCP endpoint blocked.

**OQ-5 (rate budget):** Cannot verify for `/api/mcp`. The conservative design (one call/turn, `limit=8`) still stands.

**OQ-6 (currency coverage):** Dev store is USD-only. Minor-unit guard for JPY/KRW still recommended as good practice but not tested.

**OQ-7 (LLM planner):** Confirmed deterministic switch for v1.

**OQ-8 (PDP link):** Confirmed no `handle`, `url` is `null`. OQ-8 resolved: PDP link is dropped entirely. Checkout handoff is the sole destination.

**OQ-9 (Analytics):** `variants[0].id` IS present in `search_catalog` results. Wire `<Analytics.ProductView>` when `firstVariantId` is present. No per-card exemption needed for this store (all products have variants with ids).

---

## Deviations from plan

- No feature code written (probe stop condition)
- All four §8.1 probes executed
- Probes 1, 3 (partial), 4, 5, 6 surfaced contradictions to plan assumptions
- Probe 7 could not be executed (UCP endpoint blocked)
- This file is the primary output of this Coder invocation

---

## Files changed

None. No application code was written. This impl-notes file is the only output.

---

## Out-of-scope observations

1. The store's storefront password gates the `/api/ucp/mcp` endpoint. Removing the storefront password may unblock the UCP endpoint for future feature work, enabling the richer UCP-format responses (with `result.structuredContent`, `handle`, `checkout_url` per variant, etc.).

2. The standard `/api/mcp` `search_catalog` tool returns a UCP response envelope inside the text content (capabilities include `dev.ucp.shopping.catalog.search`), meaning it IS implementing the UCP spec at the data level — just the endpoint auth/access is older-style. The UCP catalog capability negotiation shows `"dev.ucp.shopping.catalog.search"` in the response.

3. The DEPRECATION NOTICE in `result.content[1].text` says these standard tools will be removed August 31, 2026. The feature should be planned with a migration path in mind (once the UCP endpoint is accessible, the richer response shape and proper structured content are available).

---

## Build phase

Date: 2026-06-27
Author: Coder
Status: **COMPLETE — build, unit tests, and lint all pass**

### OQ resolutions recorded at build time

- **OQ-1 (cart architecture):** Used separate MCP cart with checkout handoff (plan default). The UI explicitly labels it "Assistant cart" and surfaces the `checkout_url`. Unified cart integration remains a documented Next step.
- **OQ-2 (UI host):** Bespoke lightweight panel (`fixed bottom-24 right-6 z-50`, 480px height). The existing `Drawer` is a full-screen Dialog overlay with backdrop — too heavy for a persistent chat sidebar.
- **OQ-9 (Analytics wiring):** `<Analytics.ProductView>` rendered per card when `firstVariantId` is present. All 15 store products (snowboard sample data) carry `variants[0].id`, so no per-card exemption was needed; exemption retained as a safety net.

### Files created or modified

| File | Reason |
| :--- | :--- |
| `app/lib/const.js` | Added `ASSISTANT_RESULT_LIMIT = 8` and `MCP_TIMEOUT_MS = 10_000` |
| `app/lib/mcp-normalize.js` | New — pure normalizers. Two-path price contract: `normalizeCatalogProduct` uses integer minor-units path; `normalizeProductDetail` and `normalizeCart` use decimal-string path. All paths rename `currency`→`currencyCode`. Image mapping uses probed `alt_text` field; no fabricated dimensions. |
| `app/lib/mcp.server.js` | New — server-only MCP client. `callTool` with injectable `fetchImpl`, 10s timeout, 429/Retry-After handling (seconds→ms). `searchCatalog`, `getProductDetails`, `updateCart`, `getCart` exports. `.server.js` suffix enforces trust boundary. |
| `app/lib/mcp.server.test.js` | New — 22 unit tests (Node built-in `node:test`). Covers: 429/rate-limit (MANDATORY), no-Retry-After default, http_error, success parse, tool_error. Two-path normalizer tests (MANDATORY): catalog integer path; detail decimal-string path; cross-path isolation. Cart normalizer tests. |
| `app/routes/($locale).api.assistant.jsx` | New — Remix resource route (action only). Locale guard mirrors `api.newsletter.jsx`. Intent switch: `search`→`searchCatalog`, `detail`→`getProductDetails`, `add`→`updateCart`. Empty results: `{products:[]}` + no error (required change #2). Stale-cart: clear cartId + retry → `cartReset:true` (required change #4). |
| `app/components/AssistantProductCard.jsx` | New — renders one normalized MCP product. `<img loading="lazy">` (no dimensions, AL-22). `<Money data={priceRange.min}>`. No PDP `<Link>` (AL-18). `<Analytics.ProductView>` when `firstVariantId` present (required change #7). |
| `app/components/ChatAssistant.jsx` | New — floating launcher + bespoke chat panel. Gated by `useIsHydrated`. `useFetcher` → `${pathPrefix}/api/assistant` (plain string, no `<Link>`). `processedDataRef` prevents double-processing. Distinct empty vs error states. Rate-limit cool-down. Cart summary + `checkout_url` handoff. "started a new cart" note on `cartReset`. |
| `app/components/PageLayout.jsx` | Modified — added single `<ChatAssistant />` render after `<Footer>`, within the `<Analytics.Provider>` subtree (root.jsx wraps PageLayout). Single import added. |

### Verification results (actual output)

**Unit tests** (`node --test app/lib/mcp.server.test.js`):
```
ℹ tests 22
ℹ suites 6
ℹ pass 22
ℹ fail 0
ℹ duration_ms ~52ms
```
All 22 tests pass including:
- 429 branch with and without `Retry-After` header (mandatory)
- Two-path normalizer (mandatory): catalog 94995 → "949.95" ✓; detail "949.95" → "949.95" ✓
- Cross-path isolation confirmed (no 100x mis-render in either direction)

**Lint** (`npm run lint`):
- My new files: **0 errors, 0 warnings** (confirmed via `npx eslint` on individual new files)
- Pre-existing errors in other codebase files (AccountAddressBook.jsx, CountrySelector.jsx, Drawer.jsx, etc.) remain from before this feature; they are out of scope and not caused by my changes.

**Build** (`npm run build`):
```
✓ 391 modules transformed.  [client]
✓ 375 modules transformed.  [SSR]
✓ built in 1.07s / 1.16s
```
Build exits zero. Codegen ran (no GraphQL changes so no type diff). Production build passes.

**Trust boundary verification:**
- `grep -l "mcp.server\|/api/mcp\|mcpEndpoint\|callTool\|McpError" dist/client/assets/*.js` → **no matches** — MCP client code is absent from all client bundles.
- `dist/client/assets/(_locale).api.assistant-*.js` is 0.05 kB — matches the size of `api.newsletter` and `api.countries` (only the `null` default export in the client chunk). Confirms the action function stays server-side.

### Deviations from plan

1. **No deviations from the probed shapes.** All implementation is against the PROBED field names, envelope structure, and price formats from probes 1–6.
2. **`data.cartReset` in `useEffect`:** The empty `if (data.cartReset) { ... }` block (plan §3.5: "clear the stored cartId") has no explicit clear because the new `cart.id` from the response is set via `setCartId(data.cart.id)` in the block above — no separate clear needed. Code comment explains this.
3. **Pre-existing rollup optional dependency error:** First `npm run build` failed with `Cannot find module @rollup/rollup-darwin-arm64`. Fixed by running `npm install` (matching the npm bug guidance in the error). No code change required.
4. **Pre-existing lint errors in codebase:** The project has pre-existing `prettier/prettier` and `import/order` errors in files like `CountrySelector.jsx`, `Drawer.jsx`, `Grid.jsx`, etc. These were present before this feature and are out of scope per the guardrail. My new files are 0 errors.
5. **`react/no-array-index-key`:** Fixed proactively with a `msgIdRef` counter on messages instead of array index keys.

### Commands to run the feature locally

```bash
# Start dev server
cd ~/Projects/Shopify/hydrogen-storefront
npm run dev

# Open browser
open http://localhost:3000

# The floating chat button appears bottom-right after hydration.
# Type "snowboards" and click Send to search.
# Click "Add to cart" on a result to test the cart flow.

# Unit tests (no dev server needed)
node --test app/lib/mcp.server.test.js
```

### Out-of-scope observations (new)

4. `mcp.server.test.js` uses `node --test` (Node 20+ built-in). The `npm run lint` command picks up the test file; adding an `npm run test:unit` script wrapping `node --test` would be a clean improvement — flagged, not implemented (not in plan scope).
