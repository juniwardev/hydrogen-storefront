# Bug report — UCP `create_cart` / `create_checkout` return `-32603` for valid ProductVariant GIDs

**Prepared for:** Shopify UCP / platform support
**Date:** 2026-07-09
**Store:** `theme-evolution-os2-hydrogen.myshopify.com` (Partner dev store, snowboard sample data)
**Surface:** UCP MCP endpoint `POST /api/ucp/mcp`
**Agent profile:** `https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json` (Shopify-hosted test fixture)
**Severity:** High — the cart/checkout write path is completely unusable on this store; read paths are unaffected.

---

## ✅ RESOLVED (2026-07-10) — provisioning prerequisite, not a code defect

**Status: closed.** Root cause identified and corroborated by two public Shopify community threads: the `-32603` crash occurs because the store's **agentic commerce sales channel is not provisioned**, which on a development store requires the store to be **published and storefront-password protection removed**.

- **Thread #34081** — byte-identical failure; OP resolved it by publishing + removing password, noting *"the agentic channel was not available in our store"* until then. Shopify staff could not reproduce on a channel-provisioned store.
- **Thread #34499** — Shopify staff: *"There is no supported way to make that merchant scoped UCP MCP endpoint publicly accessible while keeping the storefront password enabled at the moment."*

So there is **no client-side or Shopify-side fix pending** — cart/checkout on a password-locked dev store is blocked by prerequisite. The report below stands as the reproduction record. Its "open questions" are answered: (Q1) `gid://shopify/ProductVariant/<id>` *is* the right shape — it just can't resolve without the channel; (Q2) provisioning/state, not a code defect — but the unhandled `-32603` crash (vs. a clean "channel unavailable" error) remains worth flagging as product-quality feedback; (Q3) the required config is: published store + password off → agentic channel available. Fresh 2026-07-10 reproductions with server-side `x-request-id`s were provided to Support #68842755 for that error-handling feedback (see fix-notes).

---

## Summary

`create_cart` and `create_checkout` crash with **HTTP 500 / JSON-RPC `-32603 "Core client error"`** whenever the `line_items[].item.id` is a well-formed `gid://shopify/ProductVariant/<id>` — including real, live, in-stock variant IDs returned moments earlier by `search_catalog` on the same store.

The contradiction: the tools' **own validation error messages demand that exact shape**. Sending a bare numeric ID or a Product GID is cleanly rejected with `"is not a valid ProductVariant GID"`, but sending an actual valid ProductVariant GID crashes the resolver. There is no identifier a client can send that both satisfies the validator and survives the resolver. This points to a defect in the store's UCP GID-resolution path (or its current provisioning state), not to client request-shape.

## Environment / preconditions

- Requests reach `/api/ucp/mcp` successfully (transport, MCP framing, and the required `params.arguments.meta.ucp-agent.profile` wrapper are all accepted — `search_catalog` works and returns real products).
- Reproduced against the live store, not a mock.

## Steps to reproduce

1. Call `search_catalog` (e.g. query `"snowboard"`). Observe products returned with variant IDs in ProductVariant GID form, e.g. `gid://shopify/ProductVariant/50239737331932`.
2. Call `create_cart` with that variant GID as the line item:
   ```json
   {
     "jsonrpc": "2.0", "id": 1, "method": "tools/call",
     "params": {
       "name": "create_cart",
       "arguments": {
         "line_items": [
           { "item": { "id": "gid://shopify/ProductVariant/50239737331932" }, "quantity": 1 }
         ],
         "meta": { "ucp-agent": { "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json" } }
       }
     }
   }
   ```
3. Observe **HTTP 500**:
   ```json
   {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error","data":"Internal error calling tool create_cart: Core client error"}}
   ```

## Expected vs. actual

- **Expected:** a created cart containing the line item (the variant GID is the shape the tool's own error messages say is required), or — if the id is somehow wrong — a clean recoverable business-error like every other id shape produces.
- **Actual:** the resolver crashes internally (`-32603 "Core client error"`), returning no cart and no actionable error.

## Evidence — what triggers the crash (suffix bisection)

Holding the resource-type prefix `gid://shopify/ProductVariant/` fixed and varying only the suffix:

| `item.id` value | HTTP | Result |
|---|---|---|
| `gid://shopify/ProductVariant/` (empty suffix) | 200 | Clean rejection: `"is not a valid ProductVariant GID (got: \"gid://shopify/ProductVariant/\")"` |
| `gid://shopify/ProductVariant/ ` (single space) | 200 | Clean rejection (same message) |
| `gid://shopify/ProductVariant/1` | **500** | `-32603 "Core client error"` |
| `gid://shopify/ProductVariant/xyz` (non-numeric garbage) | **500** | `-32603 "Core client error"` |
| `gid://shopify/ProductVariant/50239737331932` (real live variant) | **500** | `-32603 "Core client error"` |

**Interpretation:** schema-level string validation passes for all of the above; the crash occurs one layer deeper, in the step that resolves/dereferences the GID. The prefix `gid://shopify/ProductVariant/` + **any non-empty suffix** enters that resolution path and crashes — regardless of whether the suffix identifies a real variant.

## Evidence — every non-crashing shape is rejected as invalid (never yields a cart)

| `item.id` value | HTTP | Result |
|---|---|---|
| `50239737331932` (bare numeric) | 200 | Business-error: `"is not a valid ProductVariant GID (got: \"50239737331932\")"` |
| `gid://shopify/Product/9356160729308` (Product GID) | 200 | Business-error: `"is not a valid ProductVariant GID (got: \"gid://shopify/Product/...\")"` |
| numeric as JSON integer (not string) | 200 | Schema rejection: `"...id is not a string"` |
| base64-encoded variant GID | **500** | Same crash |
| URL-encoded slashes in the variant GID | **500** | Same crash |
| variant GID + extra `legacy_id` sibling field | **500** | Same crash |

Raw business-error envelope (numeric id case):
```json
{"type":"error","content_type":"plain","code":"invalid_input",
 "content":"is not a valid ProductVariant GID (got: \"50239737331932\")",
 "severity":"unrecoverable","path":"$.line_items[0].item.id"}
```

## Scope of impact (controls run)

- **Cross-product:** identical `-32603` crash on ≥2 distinct live products (`The Complete Snowboard` variant `50239737331932`; `The Multi-managed Snowboard` variant `50239736971484`) — rules out a single corrupted variant record. (Store carries snowboard sample data only, so coverage is within that product family.)
- **`create_checkout`:** byte-identical crash (`-32603 "Internal error calling tool create_checkout: Core client error"`) for the ProductVariant GID; clean business-error for numeric/Product GID — same broken resolution path as `create_cart`.
- **Fresh session:** reproduced immediately after a forced fresh auth session — not a stale-session artifact.
- **Read paths unaffected:** `search_catalog` / `lookup_catalog` work correctly throughout.

## What would confirm a fix

Re-running the reproduction above should return a **created cart containing the line item** (HTTP 200, no `-32603`) for a real ProductVariant GID from `search_catalog`, and `create_checkout` should then return a usable checkout URL.

## Open questions for Shopify

1. Is `gid://shopify/ProductVariant/<id>` the intended `line_items[].item.id` shape for `create_cart` on UCP? (The validator's error messages imply yes.) If not, what shape should a client derive from a `search_catalog` result, and why does the validator reject the alternatives?
2. Is this a code defect in the UCP tool implementation, or a provisioning/state issue specific to this dev store (e.g., missing payments/markets/sales-channel publishing) surfacing as an unhandled `-32603` rather than a clean error?
3. If provisioning-related, what is the minimum store configuration required for `create_cart`/`create_checkout` to succeed?

## Reference

Full internal probe matrix, raw responses, and analysis: `docs/bugs/ucp-cart-32603-fix-notes.md` (attach if sharing internally).
