# Project Standards: Hydrogen Storefront

This project uses the Claude Squad workflow. Agents at `~/.claude/agents/` and slash commands at `~/.claude/commands/` (global, shared across projects). Project-scoped agent overrides live in `.claude/agents/` within this repo. This file is the per-project context every agent reads at the start of work. `CLAUDE.md` (Claude Code) and `AGENTS.md` (OpenCode) are kept byte-identical for portability.

🚨 **Coder and Plan-Reviewer:** read this entire document before executing any code modifications. The architectural directives at the bottom are project-specific and non-negotiable.

---

## Project type and stack

- **Framework:** Shopify Hydrogen (Remix-based SSR React)
- **Language:** TypeScript
- **Storefront connection:** `theme-evolution-os2-hydrogen.myshopify.com` (separate dev store from the Liquid theme project at `theme-evolution-os2.myshopify.com`)
- **Repo location:** `~/Projects/Shopify/hydrogen-storefront`
- **State:** Greenfield — generated via `npm create @shopify/hydrogen@latest`
- **Deploy target:** Local development only for now (see "Deploy targets" section below)

---

## Run locally

```bash
cd ~/Projects/Shopify/hydrogen-storefront
npm install   # only on first run, or after pulling dependency changes
npm run dev
```

Dev server runs at `http://localhost:3000` by default.

Useful commands:

- `npm run dev` — start Vite + MiniOxygen development server
- `npm run build` — production build (TypeScript + Vite)
- `npm run preview` — serve the production build locally for verification
- `npm run typecheck` — run `tsc --noEmit` to verify TypeScript types
- `npm run lint` — ESLint
- `npm run codegen` — regenerate GraphQL types from the Storefront API schema
- `npm run test` — run Vitest unit tests (if any exist)

If any of these commands don't match what `package.json` actually provides, update this section to reflect reality — the `package.json` is source of truth.

---

## Deploy targets

⚠️ **No production deploy target is configured for this project yet.** The Hydrogen storefront runs locally only.

When a deploy target is chosen (Shopify Oxygen, Vercel, Cloudflare Workers, Netlify, etc.):

1. Document the target here with: environment name, deploy command, verification URL.
2. Update `.claude/agents/devops.md` (project-scoped) with the specific deploy procedure.
3. The `/ship` slash command will then become operational for this project.

Until then, the squad workflow terminates at `/qa` + operator sign-off. `/ship` will refuse with a clear message (the project-scoped DevOps agent is configured to refuse by design when no target is set).

---

## Verification

For local verification while developing:

1. **HTTP smoke test:** `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000` → expect 200.
2. **Browser check:** open `http://localhost:3000` in a browser. Confirm no React hydration warnings in the DevTools console.
3. **Product page check:** navigate to a product. Confirm GraphQL data renders correctly (images load, prices show, no empty fields).
4. **TypeScript check:** `npm run typecheck` returns clean.
5. **Build check:** `npm run build` completes without errors.

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

For bug fixes, see `docs/process/bug-fix-workflow.md` (copy from the theme-evolution-os2 project once that file is in place). Slug convention for bug fixes: prefix with `fix-` (e.g., `fix-cart-drawer-overflow`).

Audit-trail artifacts live in `docs/bugs/`, `docs/plans/`, `docs/reviews/`, `docs/qa/`. Each agent writes to its scoped subdirectory.

---

## Per-agent guidance for this project

### Architect

- Plans must respect the Hydrogen architectural directives at the bottom of this document.
- When proposing GraphQL changes, account for the data contracts (root vs variant scope, complete image payloads, `selectedOptions` requirements).
- Plans should specify which TypeScript types may need regeneration (`npm run codegen`) if the Storefront API schema is touched.

### Plan-Reviewer

- Apply adversarial scrutiny on Hydrogen-specific concerns: Anti-Stubbing Rule, hydration safety, the Analytics Contract.
- Demand that plans include TypeScript type considerations and `tsc --noEmit` as a verification step.

### Coder

- Use Shopify's `@shopify/hydrogen` helper components (`<Image>`, `<Link>`, `<Money>`, `<ProductProvider>`, `<Analytics.*>`) instead of plain HTML tags whenever possible.
- All GraphQL queries must request complete image payloads (`id`, `url`, `altText`, `width`, `height`).
- Follow the Anti-Stubbing Rule: never bypass TypeErrors by commenting out UI or stubbing data with empty values. Fix the underlying GraphQL fetch.
- After meaningful changes, run in order: `npm run typecheck`, `npm run lint`, `npm run build`. All three must pass before declaring done.
- Pre-save audit: remove duplicate function exports (e.g., two `loader` functions in one route), conflicting variable declarations, and unused/unresolved imports.
- TypeScript: use the generated types from `storefrontapi.generated.d.ts` and equivalents. Do not hand-write types the codegen would have produced.

### QA

- Dev server runs at `http://localhost:3000` — no Shopify storefront password gate (Hydrogen previews don't go through Shopify's password protection like Liquid themes do).
- Use Playwright MCP for browser tests:
  - Confirm pages render server-side (view source should contain rendered HTML, not just `<div id="root">`).
  - Check DevTools console for React hydration warnings — these are bugs, not warnings to ignore.
  - Verify GraphQL data populates correctly (images load, prices show, no empty arrays where data should be).
  - Confirm `<Analytics.ProductView>` / `<Analytics.ItemView>` receive a valid `variantId` on product pages.
- See `docs/dev-fixtures.md` for test product handles and any setup notes.

### DevOps

- Currently not operational for this project — no remote deploy target is configured (see "Deploy targets" above).
- The project-scoped DevOps agent at `.claude/agents/devops.md` refuses `/ship` invocations until a deploy target is chosen and documented.

### General

- For bug investigation via `/investigate`, follow the standard procedure from the global General agent prompt.
- For Hydrogen-specific investigations: when tracing React component issues, check for SSR/hydration mismatches first (the most common runtime issue class), then check GraphQL data shape against the route's `loader` function.

---

## What NOT to change

- **Generated GraphQL types** (`storefrontapi.generated.d.ts`, `customer-accountapi.generated.d.ts`, etc.) — regenerate via `npm run codegen` instead of hand-editing.
- **`package-lock.json`** — let npm manage it.
- **Build artifacts** (`dist/`, `build/`, `.cache/`, `node_modules/`) — never commit, never edit.
- **`.env` and `.env.local`** — these contain Storefront API tokens and other secrets. Never commit them; never edit them as part of a feature plan.
- **Hydrogen framework files** (`server.js`, `entry.server.tsx`, `entry.client.tsx`) — modify only when the plan explicitly requires.

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
│   └── entry.server.tsx# Server-side rendering entry point
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

When rendering product pages or product cards, ensure the `variantId` is correctly extracted from the GraphQL payload and passed to `<Analytics.ProductView>` or `<Analytics.ItemView>`. Missing IDs will break downstream tracking.

#### Code Quality & Pre-Save Audits

Immediately before saving any file, perform a full-file audit. Actively search for and remove duplicate function exports (e.g., two `loader` functions in one route), conflicting variable declarations, and unused/unresolved imports.

---

End of project context. Agents proceed from here.
