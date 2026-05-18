# OpenCode Agent Directives: Hydrogen Storefront

🚨 **MANDATORY: YOU MUST READ THIS ENTIRE DOCUMENT BEFORE EXECUTING ANY CODE MODIFICATIONS.**

This document defines the strict operational guardrails, architectural paradigms, and expected behaviors for all OpenCode AI agents interacting with this Headless Shopify repository.

---

## 1. Theme Architecture & Directory Structure

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

### `app/routes/`
* Contains standard Remix file-based routing logic. 
* Files prefixed with `($locale)` indicate internationalization routes. 
* **Loaders & Actions:** Every route file typically exports a `loader` (for server-side GET requests) and a default React component (for the UI).
* **Data Fetching:** Always use Shopify's `storefront.query()` inside the loader to fetch data securely on the server. Never fetch Storefront API data directly inside the React component.

### `app/components/`
* Pure, presentational React components. 
* They should receive their data via props passed down from the `useLoaderData()` hook inside the route files.
* Always use the official `@shopify/hydrogen` helper components (e.g., `<Image>`, `<Link>`, `<Money>`, `<ProductProvider>`) instead of standard HTML tags to ensure correct caching, routing, and formatting.

---

## 2. Mandatory Data Contracts & GraphQL Directives

You are strictly forbidden from writing "lazy" queries. Hydrogen relies on precise GraphQL typing. A missing field will cause 500 runtime errors or 404 boundary triggers.

### The Anti-Stubbing Rule
You must NEVER bypass ReferenceErrors or TypeErrors by commenting out UI components or stubbing missing data with empty variables (e.g., `const data = []`). You must fix the underlying GraphQL fetch.

### Product & Variant Queries
* **Root vs Variant Scope:** Verify the structural level of requested fields. Root-level product fields (e.g., `adjacentVariants`, `encodedVariantExistence`, `encodedVariantAvailability`) MUST be placed on the `Product` object, NEVER inside `ProductVariant` nodes.
* **SEO Requirements:** Every variant query MUST explicitly request `selectedOptions { name value }`. If omitted, the Hydrogen SEO utility will crash.
* **Option Values:** Ensure `options { name optionValues { name } }` is requested so the `getProductOptions` hook functions correctly.

### Image Payloads
Every query fetching collections, products, or recommendations MUST explicitly request complete image payloads: `id`, `url`, `altText`, `width`, and `height`. Do not fetch `altText` alone.

### Zero Hardcoding
Never hardcode assumed Shopify handles (e.g., `'freestyle'`, `'featured'`). Verify against the project context (e.g., `'frontpage'` for the homepage) or write logic to gracefully handle null data if a collection doesn't exist.

---

## 3. React & Performance Directives

### Component Hydration
* Ensure that components requiring browser APIs (`window`, `document`) are either lazy-loaded or wrapped in a `useEffect` to prevent SSR hydration mismatches.

### The Analytics Contract
* When rendering product pages or product cards, ensure the `variantId` is correctly extracted from the GraphQL payload and passed to `<Analytics.ProductView>` or `<Analytics.ItemView>`. Missing IDs will break downstream tracking.

### Code Quality & Pre-Save Audits
* Immediately before saving any file, perform a full-file audit.
* Actively search for and remove duplicate function exports (e.g., two `loader` functions in one route), conflicting variable declarations, and unused/unresolved imports.

---

## 4. Agent Roles

### Coder Agent
* **Role:** Senior Frontend React & Hydrogen Developer.
* **Focus:** UI execution, Storefront API integration, Remix data routing, and strict adherence to the GraphQL contracts defined above.

### QA Agent
* **Role:** Quality Assurance & Testing.
* **Focus:** DOM inspection, network payload verification, and identifying React hydration/runtime errors via Chrome DevTools MCP.