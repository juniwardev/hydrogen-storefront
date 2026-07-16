# Bug: Assistant add-to-cart fails — `create_cart` success payload is flat, not nested under `.cart`

**Slug:** ucp-cart-create-flat-shape
**Reported:** 2026-07-15
**Reported by:** internal QA (ucp-no-auth-mode second pass)
**Severity:** High
**Affected scope:** Shopping-assistant add-to-cart path, all stores. Surfaced live on the public `ashford-quantum.myshopify.com` store — invisible until now because the previous dev store crashed `create_cart` upstream (`-32603`) and no successful response ever existed to observe.

## Steps to reproduce

1. Run the dev server against the public store (`PUBLIC_STORE_DOMAIN=ashford-quantum.myshopify.com`, `UCP_AUTH_MODE=none`).
2. Open the shopping assistant, search for a product (`search_catalog` returns real products).
3. Ask the assistant to add a product to the cart (drives the route action → `createCart()` in `app/lib/mcp.server.js`).

## Expected behavior

The assistant reports a cart was created and surfaces the cart/continue URL. The live UCP `create_cart` tool DOES create a real cart on this store (`isError: false`, real cart `id`, `line_items`, `continue_url`).

## Actual behavior

The assistant surfaces a generic `tool_error` and no cart. The underlying UCP call succeeds and returns a real cart, but `createCart()` returns `{cart: null}`, so the route treats it as a failure.

Screenshot: `docs/qa/screenshots/ucp-no-auth-mode-pass2-cart-tool-error.png`

## Hypothesis (starting point, not a constraint)

`createCart()` (`app/lib/mcp.server.js:386`) reads `payload.cart ?? null`, on the documented assumption (comment at lines 339–343, 381–384) that a successful `create_cart` nests the cart at `structuredContent.cart`. QA's live observation on the public store is that the success payload is **flat** — the cart fields (`id`, `line_items`, `continue_url`, `totals`) sit at the top level of `structuredContent`, same as `search_catalog`/`create_checkout` — so `payload.cart` is `undefined` and the `?? null` fallback fires on every success.

The "PROBED + Dev MCP" annotation on that comment is suspect: it was written against the old `theme-evolution-os2-hydrogen` store where `create_cart` always crashed (`-32603`), so no successful response was ever available to probe — the nested shape was likely inferred from the Dev MCP schema, not observed. This must be confirmed empirically against the live store before a fix is designed. `update_cart` (line 441) shares the identical `payload.cart ?? null` logic and is likely affected the same way.

## Suspected files

- `app/lib/mcp.server.js` — `createCart()` (~386), `updateCart()` (~441), and the response-shape comments (~339–343, ~381–384).
- `app/lib/mcp-normalize.js` — whatever produces the `payload` object `callTool()` returns (confirms what `payload` actually is: raw `structuredContent` vs. normalized).
- Route action in `app/routes/($locale).api.assistant.jsx` — consumes `{cart}` and maps a null cart to the surfaced error.

## Regression risk areas

(Filled in by the Architect during planning.)
