# Project Standards: Hydrogen Storefront

This project uses the Claude Squad workflow. Agents at `~/.claude/agents/` and slash commands at `~/.claude/commands/` (global, shared across projects). Project-scoped agent overrides live in `.claude/agents/` within this repo. This file is the per-project context every agent reads at the start of work. `CLAUDE.md` (Claude Code) and `AGENTS.md` (OpenCode) are kept byte-identical for portability.

🚨 **Coder and Plan-Reviewer:** read this entire document before executing any code modifications. The architectural directives at the bottom are project-specific and non-negotiable.

---

## Project type and stack

- **Framework:** Shopify Hydrogen (Remix-based SSR React)
- **Language:** JavaScript (`.jsx`) with JSDoc annotations referencing generated TypeScript declarations (`storefrontapi.generated.d.ts`). Do NOT convert files to native TypeScript (`.tsx`) as drive-by work — that's a separate architectural decision.
- **Storefront connection:** `theme-evolution-os2-hydrogen.myshopify.com` (separate dev store from the Liquid theme project at `theme-evolution-os2.myshopify.com`)
- **Repo location:** `~/Projects/Shopify/hydrogen-storefront`
- **State:** Greenfield-ish — generated via `npm create @shopify/hydrogen@latest`, with some early development already in place
- **Deploy target:** Shopify Oxygen — storefront `ashford-quantum-hydrogen`, environment `production` (see "Deploy targets" section below)

---

## Run locally

```bash
cd ~/Projects/Shopify/hydrogen-storefront
npm install   # only on first run, or after pulling dependency changes
npm run dev
```

Dev server runs at `http://localhost:3000` by default.

Available scripts (from `package.json`):

- `npm run dev` — start Hydrogen dev server (Vite + MiniOxygen). The `--codegen` flag auto-regenerates GraphQL types on schema changes.
- `npm run build` — production build. Includes codegen pass. This is the effective type-validation step — there is no separate `typecheck` script.
- `npm run preview` — runs `build`, then serves the production build locally for verification.
- `npm run lint` — ESLint over `.js`, `.ts`, `.jsx`, `.tsx` files.
- `npm run format` — Prettier auto-format all files.
- `npm run format:check` — Prettier check without writing changes.
- `npm run e2e` — Playwright end-to-end tests.
- `npm run e2e:ui` — Playwright with UI mode for interactive debugging.

If you find yourself wanting a script that doesn't exist (e.g., `typecheck`, `codegen`), check whether the existing scripts cover it (often they do — codegen is bundled into `dev`/`build`). Add new scripts only when there's a clear gap.

---

## Deploy targets

**Target: Shopify Oxygen** (native Hydrogen hosting). Configured 2026-07-15.

| Field | Value |
| :--- | :--- |
| Platform | Shopify Oxygen |
| Store | `ashford-quantum.myshopify.com` (Ashford Quantum Solutions) |
| Hydrogen storefront | `ashford-quantum-hydrogen` (`gid://shopify/HydrogenStorefront/1000158766`) |
| Environment | **Production** (handle `production`, tracks branch `main`) |
| Production URL | `https://ashford-quantum-hydrogen-bb6261bdb9884381da1b.o2.myshopify.dev` (private by default — see privacy note) |
| Deploy command | `npm run deploy` → `shopify hydrogen deploy --env production` |

### Deploy procedure

1. Ensure `main` is committed and green: `npm run lint`, `npm run build`, `npm run test:unit`.
2. Run `npm run deploy` (or `shopify hydrogen deploy --env production`). **Requires an interactive terminal** — the CLI asks a `Continue?` confirmation and has no `--yes`/non-interactive flag, so it CANNOT run headlessly (it errors with "Failed to prompt"). Answer `yes`.
3. Verify at the Production URL (see privacy note).

### Environment variables (Oxygen)

Oxygen auto-provisions the standard store vars (read-only): `PUBLIC_STORE_DOMAIN`, `PUBLIC_STOREFRONT_API_TOKEN`, `PRIVATE_STOREFRONT_API_TOKEN`, `PUBLIC_STOREFRONT_ID`, `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID`, `PUBLIC_CUSTOMER_ACCOUNT_API_URL`, `SESSION_SECRET`. This app additionally needs these **custom** vars, which are NOT auto-provisioned and must be set in Oxygen: `UCP_AUTH_MODE=none`, `PUBLIC_UCP_AGENT_PROFILE_URL`, `PUBLIC_CHECKOUT_DOMAIN`. **`DEV_STOREFRONT_PASSWORD` must NEVER be set in production** (it drives the DEV-ONLY cookie shim). Push local `.env` with `shopify hydrogen env push --env production` (interactive). Oxygen deployments are **immutable** — env-var changes only take effect on the next deploy.

### Verification-URL privacy note

Oxygen environments are **private by default** — the URL 302-redirects to Shopify login. On the Basic plan you get **1 public** environment. To make the storefront publicly reachable: Storefront settings → Environments and variables → Production → URL privacy → **Public**. Until then, verify while logged into the store or via an authenticated browser session.

### Rollback

Oxygen retains prior deployments. Roll back by promoting a previous deployment in the Hydrogen channel (Storefront settings → Deployments), or by re-deploying a previous commit.

### `/ship`

`/ship` is operational via the project-scoped DevOps agent (`.claude/agents/devops.md`). GitHub continuous deployment is intentionally NOT wired, and the `shopify hydrogen deploy` confirmation is interactive, so `/ship` runs pre-deploy verification and post-deploy checks while the deploy confirmation itself is operator-run.

---

## Verification

For local verification while developing:

1. **HTTP smoke test:** `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000` → expect 200.
2. **Browser check:** open `http://localhost:3000` in a browser. Confirm no React hydration warnings in the DevTools console.
3. **Product page check:** navigate to a product. Confirm GraphQL data renders correctly (images load, prices show, no empty fields).
4. **Build check:** `npm run build` completes without errors. Hydrogen build includes codegen + type validation; passing build is the type-correctness signal.
5. **Lint check:** `npm run lint` returns clean.

These five checks form the baseline verification any feature or fix should pass before being marked complete.

---

## Multi-agent workflow

This project uses the squad workflow with file-based handoffs. Conventions:

```
/plan <feature>              → docs/plans/<slug>.md (Architect)
/review-plan <path>          → docs/reviews/<slug>-review.md (Plan-Reviewer)
/implement <plan-path>       → code changes + docs/plans/<slug>-impl-notes.md (Coder)
/qa <slug>                   → docs/qa/<slug>-report.md (QA)
touch docs/qa/<slug>.approved → operator sign-off
/ship <slug>                 → not yet operational (no deploy target configured)
```

For bug fixes, see `docs/process/bug-fix-workflow.md`. Slug convention for bug fixes: prefix with `fix-` (e.g., `fix-cart-drawer-overflow`).

Audit-trail artifacts live in `docs/bugs/`, `docs/plans/`, `docs/reviews/`, `docs/qa/`. Each agent writes to its scoped subdirectory.

---

## Per-agent guidance for this project

### Architect

- Plans must respect the Hydrogen architectural directives at the bottom of this document.
- When proposing GraphQL changes, account for the data contracts (root vs variant scope, complete image payloads, `selectedOptions` requirements).
- Plans should specify whether `npm run build` will need to regenerate types (any GraphQL fragment or query change triggers this automatically via the `--codegen` flag).

### Plan-Reviewer

- Apply adversarial scrutiny on Hydrogen-specific concerns: Anti-Stubbing Rule, hydration safety, the Analytics Contract.
- Demand that plans include `npm run build` as a verification step (this is the type-check + production-build gate; no separate `typecheck` exists).

### Coder

- Use Shopify's `@shopify/hydrogen` helper components (`<Image>`, `<Link>`, `<Money>`, `<ProductProvider>`, `<Analytics.*>`) instead of plain HTML tags whenever possible.
- All GraphQL queries must request complete image payloads (`id`, `url`, `altText`, `width`, `height`).
- Follow the Anti-Stubbing Rule: never bypass TypeErrors by commenting out UI or stubbing data with empty values. Fix the underlying GraphQL fetch.
- After meaningful changes, run in order: `npm run lint`, `npm run build`. Both must pass before declaring done. The build step includes codegen and effectively validates types.
- Pre-save audit: remove duplicate function exports (e.g., two `loader` functions in one route), conflicting variable declarations, and unused/unresolved imports.
- JSDoc + TypeScript declarations: use `@type` and `@param` JSDoc annotations referencing types from `storefrontapi.generated.d.ts` (and equivalents) rather than hand-writing types. The generated declarations are the source of truth.
- Files use the `.jsx` extension with JSDoc annotations, not native TypeScript `.tsx`. Do not convert files to `.tsx` as a drive-by improvement.

### QA

- Dev server runs at `http://localhost:3000` — no Shopify storefront password gate (Hydrogen previews don't go through Shopify's password protection like Liquid themes do).
- Use Playwright MCP for browser tests:
  - Confirm pages render server-side (view source should contain rendered HTML, not just `<div id="root">`).
  - Check DevTools console for React hydration warnings — these are bugs, not warnings to ignore.
  - Verify GraphQL data populates correctly (images load, prices show, no empty arrays where data should be).
  - Confirm `<Analytics.ProductView>` receives a valid `variantId` (inside its `{products: [...]}` payload) on product pages and product cards.
- Project also has Playwright end-to-end tests at the codebase level: `npm run e2e` runs them. For feature verification, browser MCP testing is usually sufficient; reach for `npm run e2e` when you specifically need to update the long-running test suite.
- See `docs/dev-fixtures.md` for test product handles and any setup notes.

### DevOps

- Operational for this project — the deploy target is **Shopify Oxygen** (see "Deploy targets" above).
- The project-scoped DevOps agent at `.claude/agents/devops.md` runs `/ship`: pre-deploy verification, the operator-confirmed `shopify hydrogen deploy --env production`, then post-deploy verification against the Production URL.

### General

- For bug investigation via `/investigate`, follow the standard procedure from the global General agent prompt.
- For Hydrogen-specific investigations: when tracing React component issues, check for SSR/hydration mismatches first (the most common runtime issue class), then check GraphQL data shape against the route's `loader` function.

---

## What NOT to change

- **Generated GraphQL types** (`storefrontapi.generated.d.ts`, `customer-accountapi.generated.d.ts`, etc.) — regenerated automatically by `npm run dev` and `npm run build` (both use the `--codegen` flag). Do not hand-edit; if types need updating, run `npm run build` to refresh them.
- **`package-lock.json`** — let npm manage it.
- **Build artifacts** (`dist/`, `build/`, `.cache/`, `node_modules/`) — never commit, never edit.
- **`.env` and `.env.local`** — these contain Storefront API tokens and other secrets. Never commit them; never edit them as part of a feature plan.
- **Hydrogen framework files** (`server.js`, `entry.server.jsx`, `entry.client.jsx`) — modify only when the plan explicitly requires.

---

## Required environment variables

Local development requires the following variables in `.env` (or `.env.local`). These are loaded automatically into MiniOxygen during `npm run dev`:

| Variable | Purpose |
| :--- | :--- |
| `SESSION_SECRET` | Encrypts session cookies. |
| `PUBLIC_STOREFRONT_API_TOKEN` | Public access token for the Storefront API. |
| `PUBLIC_STORE_DOMAIN` | The `myshopify.com` domain of the Shopify store. |
| `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID` | Client ID for the Customer Account API. |
| `PUBLIC_CHECKOUT_DOMAIN` | The domain used for the checkout process. |
| `SHOP_ID` | The unique identifier for the Shopify shop. |

The `.env` and `.env.local` files are gitignored and contain secrets. Never commit them. Never edit them as part of a feature plan — environment changes are an operator concern.

---

## Hydrogen architectural directives

The remainder of this document preserves the original Hydrogen project directives. Read carefully before any code modification.

### 1. Theme Architecture & Directory Structure

**Key Principles: Focus on Remix SSR, GraphQL data contracts, and modular React components.**

```text
.
├── app
│   ├── components      # Reusable React UI components (e.g., ProductCard, Layout)
│   ├── data            # GraphQL queries and fragments
│   ├── lib             # Utility functions, SEO setup, and generic helpers
│   ├── routes          # Remix file-based routing and server-side loaders
│   ├── styles          # Tailwind or standard CSS stylesheets
│   └── entry.server.jsx# Server-side rendering entry point
├── public              # Static assets (favicons, manifest)
└── server.js           # MiniOxygen local development server entry
```

#### `app/routes/`

- Contains standard Remix file-based routing logic.
- Files prefixed with `($locale)` indicate internationalization routes.
- **Loaders & Actions:** Every route file typically exports a `loader` (for server-side GET requests) and a default React component (for the UI).
- **Data Fetching:** Always use Shopify's `storefront.query()` inside the loader to fetch data securely on the server. Never fetch Storefront API data directly inside the React component.

#### `app/components/`

- Pure, presentational React components.
- They should receive their data via props passed down from the `useLoaderData()` hook inside the route files.
- Always use the official `@shopify/hydrogen` helper components (e.g., `<Image>`, `<Link>`, `<Money>`, `<ProductProvider>`) instead of standard HTML tags to ensure correct caching, routing, and formatting.

### 2. Mandatory Data Contracts & GraphQL Directives

You are strictly forbidden from writing "lazy" queries. Hydrogen relies on precise GraphQL typing. A missing field will cause 500 runtime errors or 404 boundary triggers.

#### The Anti-Stubbing Rule

You must NEVER bypass ReferenceErrors or TypeErrors by commenting out UI components or stubbing missing data with empty variables (e.g., `const data = []`). You must fix the underlying GraphQL fetch.

#### Product & Variant Queries

- **Root vs Variant Scope:** Verify the structural level of requested fields. Root-level product fields (e.g., `adjacentVariants`, `encodedVariantExistence`, `encodedVariantAvailability`) MUST be placed on the `Product` object, NEVER inside `ProductVariant` nodes.
- **SEO Requirements:** Every variant query MUST explicitly request `selectedOptions { name value }`. If omitted, the Hydrogen SEO utility will crash.
- **Option Values:** Ensure `options { name optionValues { name } }` is requested so the `getProductOptions` hook functions correctly.

#### Image Payloads

Every query fetching collections, products, or recommendations MUST explicitly request complete image payloads: `id`, `url`, `altText`, `width`, and `height`. Do not fetch `altText` alone.

#### Zero Hardcoding

Never hardcode assumed Shopify handles (e.g., `'freestyle'`, `'featured'`). Verify against the project context (e.g., `'frontpage'` for the homepage) or write logic to gracefully handle null data if a collection doesn't exist.

### 3. React & Performance Directives

#### Component Hydration

Ensure that components requiring browser APIs (`window`, `document`) are either lazy-loaded or wrapped in a `useEffect` to prevent SSR hydration mismatches.

#### The Analytics Contract

When rendering product pages or product cards, ensure the `variantId` is correctly extracted from the GraphQL (or MCP catalog) payload and passed to `<Analytics.ProductView>` via its `data={{products: [...]}}` payload. Missing IDs will break downstream tracking.

The Hydrogen `Analytics` namespace (verified against Hydrogen 2026-04 via the Shopify Dev MCP) exposes exactly: `Provider`, `ProductView`, `CartView`, `CollectionView`, `SearchView`, and `CustomView`. There is **no** `Analytics.ItemView` — referencing it renders an undefined component and crashes the render path at SSR/hydration. Use `Analytics.ProductView` for both product pages and product cards.

> **Correction note (2026-06-27):** Earlier revisions of this contract listed `<Analytics.ItemView>` as an alternative. That component does not exist in the Hydrogen Analytics namespace; the wording was inherited verbatim into a feature plan (`docs/plans/mcp-shopping-assistant.md`) and caught by the Plan-Reviewer agent, which verified the real namespace via the Shopify Dev MCP. Corrected here so the error does not propagate to future features that read this file as their grounding source.

#### Code Quality & Pre-Save Audits

Immediately before saving any file, perform a full-file audit. Actively search for and remove duplicate function exports (e.g., two `loader` functions in one route), conflicting variable declarations, and unused/unresolved imports.

---

End of project context. Agents proceed from here.
