# Runbook: Switching the Hydrogen storefront between stores

**Purpose:** Flip local development between the two Shopify stores this storefront
targets, without losing env keys or misreading expected capability differences.

This is an **operator / env-only** procedure — no code changes. It exists because
the two stores need different auth strategies (introduced by the `UCP_AUTH_MODE`
work, `docs/plans/ucp-no-auth-mode.md`) and because the stores differ in what the
UCP cart/checkout path can do.

> **Secrets:** `.env`, `.env.local`, and `.env.backup*` are gitignored and hold
> tokens/passwords. Never commit them; never paste their values into docs, PRs, or
> chat. This runbook references variable **names** and public **domains** only.

---

## The two store profiles

| | **ashford-quantum** (current) | **theme-evolution-os2-hydrogen** |
| :--- | :--- | :--- |
| `PUBLIC_STORE_DOMAIN` | `ashford-quantum.myshopify.com` | `theme-evolution-os2-hydrogen.myshopify.com` |
| `PUBLIC_CHECKOUT_DOMAIN` | `ashford-quantum.myshopify.com` | `theme-evolution-os2-hydrogen.myshopify.com` |
| Storefront password | **disabled** (public, Basic plan) | **enabled** (password-gated dev store) |
| `UCP_AUTH_MODE` | `none` | `dev-cookie` |
| `DEV_STOREFRONT_PASSWORD` | not needed / absent | **required**, must be in `.env` |
| Agentic commerce channel | provisioned | **not** provisioned |
| UCP `search_catalog` | ✅ works | ✅ works (via dev-cookie shim) |
| UCP `create_cart` / `create_checkout` | ✅ works (real cart + checkout) | ❌ blocked — see [Capability note](#capability-note-cartcheckout) |

The full store-specific env values live in the env files, not here:
- **ashford-quantum** → the current `.env`.
- **theme-evolution-os2-hydrogen** → `.env.backup-pre-ashford` (the snapshot taken
  before the ashford switch).

---

## `UCP_AUTH_MODE` in one paragraph

`UCP_AUTH_MODE` (read by `app/routes/($locale).api.assistant.jsx`, validated in
`app/lib/mcp.server.js`) selects the credential strategy:

- **`none`** — public storefront. No shim, no cookie. Use for ashford-quantum.
- **`dev-cookie`** — password-gated dev store. Mints the `_shopify_essential`
  cookie from `DEV_STOREFRONT_PASSWORD` via the DEV-ONLY shim. Use for
  theme-evolution-os2-hydrogen. **This is the default when the var is unset**, but
  set it explicitly — an unset value is a config smell, not an intent.
- **`signed`** — Phase-2 seam, not implemented (throws `signed_mode_not_implemented`).

A mismatch fails loud, not silently: e.g. `dev-cookie` with no password throws
`config_error reason=dev_storefront_password_missing`; `none` against a still-gated
store throws `auth_mode_none_but_store_gated`. Check the dev-server log for the
`[mcp] config_error reason=<token>` line if a switch misbehaves.

---

## ⚠️ The backup predates the no-auth work — do NOT blindly `cp`

`.env.backup-pre-ashford` was captured **before** the `UCP_AUTH_MODE` feature and
before some later keys were added. Compared with the current `.env`, the backup:

- **lacks** `UCP_AUTH_MODE` (so a raw restore leaves it unset → defaults to
  `dev-cookie`, which is correct for the gated store — but set it explicitly), and
- **lacks** `PUBLIC_STOREFRONT_ID`, `PRIVATE_STOREFRONT_API_TOKEN`, and
  `PUBLIC_CUSTOMER_ACCOUNT_API_URL`, which the current `.env` carries.

So a naive `cp .env.backup-pre-ashford .env` would **silently drop** those three
keys. Treat the backup as the source for the *store-specific* values
(domains, tokens, password), and carry forward any newer keys the app now expects.
When in doubt, diff the **key sets** (not the values):

```bash
# Compare which VARIABLES each file defines (values redacted) — never print values
diff <(sed -n 's/=.*//p' .env | sort) \
     <(sed -n 's/=.*//p' .env.backup-pre-ashford | sort)
```

Reconcile any key present in one but not the other before starting the dev server.

---

## Switch A → B: ashford-quantum (public) → theme-evolution-os2-hydrogen (gated)

1. **Snapshot the current (ashford) env first**, so you can switch back:
   ```bash
   cp .env .env.backup-pre-ashford   # gitignored via .env.backup*
   ```
   (Overwriting the existing backup is fine — it captures today's, more complete key set.)
2. **Restore the gated-store values** into `.env`: set `PUBLIC_STORE_DOMAIN` and
   `PUBLIC_CHECKOUT_DOMAIN` to `theme-evolution-os2-hydrogen.myshopify.com`, and set
   every store-specific token/ID (`PUBLIC_STOREFRONT_API_TOKEN`, `SHOP_ID`,
   `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID`, etc.) to that store's values (from the
   old backup, if that's the store it was for).
3. **Set the auth mode and password** in `.env` (NOT `.env.local` — see gotcha below):
   ```
   UCP_AUTH_MODE=dev-cookie
   DEV_STOREFRONT_PASSWORD=<the gated store's storefront password>
   ```
4. **Restart** the dev server (`npm run dev`) — env is read at boot, not on file change.
5. **Verify** (see [checklist](#verification-checklist)). Expect search to work and
   **add-to-cart to degrade gracefully** — that's expected on this store, not a bug.

## Switch B → A: theme-evolution-os2-hydrogen (gated) → ashford-quantum (public)

1. Snapshot current env if it's not already backed up.
2. Restore ashford values into `.env`: domains → `ashford-quantum.myshopify.com`,
   plus ashford's tokens/IDs and the newer keys (`PUBLIC_STOREFRONT_ID`,
   `PRIVATE_STOREFRONT_API_TOKEN`, `PUBLIC_CUSTOMER_ACCOUNT_API_URL`).
3. Set `UCP_AUTH_MODE=none`. `DEV_STOREFRONT_PASSWORD` is not needed — remove it or
   leave it; `none` never reads it.
4. Restart `npm run dev`.
5. Verify — search **and** add-to-cart should both work end-to-end.

---

## Capability note: cart/checkout

On **theme-evolution-os2-hydrogen**, UCP `create_cart` / `create_checkout` crash
upstream (`HTTP 500 / JSON-RPC -32603 "Core client error"`) because the store's
**agentic commerce sales channel is not provisioned** — a prerequisite that, on a
dev store, requires publishing the store and removing storefront-password
protection. This is **not** a client bug and there is no client-side fix; the
assistant degrades gracefully on the add-to-cart path. Full account:
`docs/bugs/ucp-cart-32603-fix-notes.md` and
`docs/bugs/ucp-cart-create-flat-shape-investigation.md`.

So when you switch back to the gated store and add-to-cart stops producing a real
cart, that is **expected**, not a regression of the cart/checkout fixes. Search
(`search_catalog`) continues to work via the dev-cookie shim.

---

## Gotchas

- **`DEV_STOREFRONT_PASSWORD` must live in `.env`, not `.env.local`.** MiniOxygen /
  the Hydrogen CLI does not merge `.env.local` into `context.env` the way Vite does,
  so a password sitting only in `.env.local` never reaches `callTool()` and you'll
  get `config_error reason=dev_storefront_password_missing` even though it "looks"
  set. (Verified during the ucp-no-auth-mode QA pass.)
- **`PUBLIC_CHECKOUT_DOMAIN` must match the active store.** A stale value pointing
  at the other store surfaces a 401 on every page load. Keep it equal to
  `PUBLIC_STORE_DOMAIN` unless the store uses a distinct custom checkout domain.
- **Restart after any env edit** — the values are injected at dev-server boot.
- **The shim is DEV-ONLY.** `dev-cookie` mode and `DEV_STOREFRONT_PASSWORD` must
  never ship to production; production auth is the (unimplemented) `signed` tier.

---

## Verification checklist

Run after every switch (baseline from `CLAUDE.md` → "Verification"):

1. `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000` → `200`.
2. Homepage + a product page load; no React hydration warnings in the console.
3. Assistant `search_catalog` returns real products for the active store.
4. Dev-server log shows **no** unexpected `[mcp] config_error reason=<token>` line
   for the mode you set (e.g. no `dev_storefront_password_missing` on `dev-cookie`,
   no `auth_mode_none_but_store_gated` on `none`).
5. Add-to-cart: **works** on ashford-quantum; **degrades gracefully** on
   theme-evolution-os2-hydrogen (expected — see capability note).
6. `npm run build` exits 0; `npm run lint` clean.

---

## Related

- `docs/plans/ucp-no-auth-mode.md` — the `UCP_AUTH_MODE` design and two-tier auth model.
- `docs/bugs/ucp-cart-32603-fix-notes.md` — the agentic-channel provisioning root cause.
- `CLAUDE.md` → "Required environment variables" and "Verification".
