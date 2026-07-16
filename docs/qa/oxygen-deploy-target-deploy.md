# Deploy note — Shopify Oxygen (initial production deploy + target setup)

**Slug:** oxygen-deploy-target
**Date:** 2026-07-15
**Operator:** Junior Warner
**Target:** Shopify Oxygen · storefront `ashford-quantum-hydrogen` (`gid://shopify/HydrogenStorefront/1000158766`) · store `ashford-quantum.myshopify.com`
**Environment:** `production` (handle `production`, tracks branch `main`)
**Production URL:** `https://ashford-quantum-hydrogen-bb6261bdb9884381da1b.o2.myshopify.dev` (toggled to **Public** on the Basic plan's single public-env allowance)
**Deployed commit:** `main` @ `83326dc` (the four cart/checkout + no-auth changesets, the `.env.backup*` gitignore, and the store-switch runbook)

---

## What shipped

This is the first production deployment of the Hydrogen storefront to Oxygen, and the run that established the deploy target. The deployed build (`main` @ `83326dc`) contains this session's stack:

- `feat(assistant)` — `UCP_AUTH_MODE` (public-storefront no-auth mode)
- `fix(assistant)` — flat `create_cart`/`update_cart` payload unwrap
- `fix(assistant)` — `create_checkout` soft-error guard
- `fix(assistant)` — gate checkout CTA copy on a usable URL

(PR #7 — this deploy-target documentation, the operational DevOps agent, and the `deploy` npm script — is docs/config only and does not change the runtime bundle.)

## Pre-deploy gates (on `main` @ `83326dc`)

| Gate | Result |
| :--- | :--- |
| `npm run test:unit` | 67/67 pass |
| `npm run lint` | clean on touched files (72 pre-existing baseline errors in untouched files, unchanged) |
| `npm run build` | exit 0 (pre-existing bundle-analyzer "Invalid URL" notice only) |

## Deploy procedure used

Run interactively by the operator (the CLI's `Continue?` prompt has no non-interactive flag):

1. `shopify hydrogen env push --env production` — added the custom vars (`UCP_AUTH_MODE=none`, `PUBLIC_UCP_AGENT_PROFILE_URL`, `PUBLIC_CHECKOUT_DOMAIN`). Standard store vars were already auto-provisioned by Oxygen.
2. `SESSION_SECRET` rotated to a fresh value (the local dev value had been exposed).
3. `shopify hydrogen deploy --env production`.
4. Production environment toggled Public (Storefront settings → Environments and variables → Production → URL privacy).

`DEV_STOREFRONT_PASSWORD` was intentionally NOT set in production (it drives the DEV-ONLY cookie shim).

## Post-deploy verification (live, anonymous, Production public)

| Check | Result |
| :--- | :--- |
| Homepage `GET /` | `200`, SSR renders real catalog data |
| `GET /collections` | `200` |
| `POST /api/assistant intent=search` | real products returned, **no `config_error`** → `UCP_AUTH_MODE=none` active in prod |
| `POST /api/assistant intent=add` | **no `tool_error`**, real cart created: `https://ashford-quantum.myshopify.com/cart/c/hWNEX73…` |
| Reply copy (dangling-CTA fix) | "Added to your assistant cart — checkout here." (with a real URL behind it) |

The add-to-cart call exercised the full shipped stack — no-auth mode + the flat cart-payload fix + the checkout-CTA copy fix — and produced a real Shopify cart on the live deployment.

## Rollback

Oxygen retains prior deployments (immutable). Roll back by promoting a previous deployment in the Hydrogen channel (Storefront settings → Deployments) or re-deploying a previous commit. Env-var changes require a redeploy to take effect.

## Known follow-ups (not blocking)

- `ci.yml` is a PR-triggered workflow that runs a `typecheck` script this project does not have (plus a Hydrogen-monorepo manifest check) — would fail if it ran; worth a separate cleanup.
- GitHub continuous deployment is intentionally not wired; deploys are manual via `npm run deploy`.
