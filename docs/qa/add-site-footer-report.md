# QA Report: add-site-footer

**Plan:** `docs/plans/add-site-footer.md`
**Impl notes:** `docs/plans/add-site-footer-impl-notes.md`
**Date:** 2026-05-18
**MCP used:** Playwright (Chromium headless via node script, project's own playwright package)

---

## Summary verdict

**PASS WITH NITS**

The three-column footer renders correctly, SSR is clean, newsletter form submits and shows success/error messages, social icons render with correct hrefs, navigation links work, and the CountrySelector and copyright are present. One nit (social URLs are Shopify placeholders, not real store URLs) and one notable observation (invalid-locale POST yields 500 not 404 — confirmed pre-existing framework behavior, identical to the existing `countries` route).

---

## Check-by-check results

### a. HTTP smoke test

- Homepage `GET /` returns HTTP 200.
- PASS (Playwright + curl confirmed)

### b. Footer renders

- `<footer>` element present in DOM: YES
- Three column headings found: `["Navigation","Follow Us","Newsletter"]` (plus "Country" for the CountrySelector section heading).
- Navigation column: 2 links rendered — "Search" (`/search`) and "Your Privacy Choices" (`/pages/data-sharing-opt-out`). These are sourced from the Shopify footer menu in admin.
- Social column: all 4 icons render — Instagram, Twitter / X, Facebook, TikTok. All have non-empty `href` attributes (see Nit #1 below on placeholder URLs).
- Newsletter column: email input present, submit button present.
- CountrySelector: "United States (USD $)" visible below the three columns.
- Copyright: `© 2026 theme-evolution-os2-hydrogen` present.
- Three-column grid and row structure match the plan's DOM sketch.
- PASS

Screenshot: `/tmp/qa-footer-final.png`

### c. Newsletter form submission

**Hydration state:**
- SSR source contains `disabled=""` on both the email input and submit button — confirms `useIsHydrated` returns false during SSR.
- After hydration (2 s wait in headless browser), both input and button become enabled — confirms `useIsHydrated` flips correctly after mount.

**Valid email submission:**
- Fetcher sends `POST /api/newsletter?_data=routes%2F%28%24locale%29.api.newsletter`
- Server responds HTTP 200 with `{"ok":true,"message":"Thanks for subscribing."}`
- `<p role="status">Thanks for subscribing.</p>` appears in the footer after submit.
- No page reload (Remix fetcher pattern works as expected).
- PASS

**Invalid email submission (server-side validation):**
- Direct POST with `email=notvalid` returns HTTP 400 with `{"ok":false,"message":"Please enter a valid email address."}`
- When browser validation is bypassed, `<p role="alert">Please enter a valid email address.</p>` appears in the footer.
- PASS

**Honeypot:**
- POST with `_gotcha=I am a bot` returns HTTP 200 with the fake success message `{"ok":true,"message":"Thanks for subscribing."}`.
- PASS

**No raw JSON displayed to user:**
- The fetcher-based form never produces raw JSON output to the user.
- PASS

### d. Navigation link

- Clicked "Search" footer nav link (`href="/search"`).
- Page navigated to `http://localhost:3000/search` (client-side Remix navigation, no full reload).
- No 404.
- PASS

### e. Social link hrefs

- All 4 links have non-empty `href` values:
  - Instagram: `https://www.instagram.com/shopify`
  - Twitter / X: `https://x.com/shopify`
  - Facebook: `https://www.facebook.com/shopify`
  - TikTok: `https://www.tiktok.com/@shopify`
- All have `target="_blank" rel="noopener noreferrer"`.
- All include a `<span class="sr-only">` label for accessibility.
- PASS — but see Nit #1: these are Shopify corporate placeholder URLs, not the actual store's social profiles.

### f. No hydration warnings

- Zero React hydration warnings in browser console across all page navigations tested.
- No `did not match` or `hydration` strings in console.
- Two "Failed to load resource: 400" console errors appeared during the invalid-email submission test — these are the expected HTTP 400 responses from the server and are not errors in the UI layer.
- One pre-existing `Warning: React does not recognize the 'preserveControl' prop` on the product page — caused by `app/components/Link.jsx` and `app/routes/($locale).products.$productHandle.jsx`, not by this feature.
- One CORS error from `monorail-edge.shopifysvc.com` — pre-existing analytics CORS on localhost, not related to this feature.
- PASS (no hydration mismatches; console errors are either expected HTTP responses or pre-existing)

### g. Product page footer

- `GET /products/the-complete-snowboard` returns HTTP 200.
- Footer renders on the product page with the same three-column structure.
- Headings: `["Navigation","Follow Us","Newsletter","Country"]`
- PASS

### h. SSR check

- Raw HTML source (curl of homepage) contains:
  - `<footer` element
  - "Navigation" heading
  - "Follow Us" heading
  - "Newsletter" heading
  - All four social SVG icons with their hrefs
  - `<form method="post" action="/api/newsletter"` with `disabled=""` on input and button
  - `© 2026 theme-evolution-os2-hydrogen`
- Success message (`Thanks for subscribing.`) is NOT in SSR source (correct: it only appears post-submission via fetcher).
- The footer is fully server-rendered, not client-side-only.
- PASS

### i. Locale-prefix check (`/en-ca`)

- `GET /en-ca` returns HTTP 200.
- Footer renders with all three columns and the CountrySelector.
- Form `action` attribute on en-ca page: `/en-ca/api/newsletter` (locale prefix correctly applied via `useRouteLoaderData('root')?.selectedLocale?.pathPrefix`).
- Newsletter POST to `/en-ca/api/newsletter` returns `{"ok":true,"message":"Thanks for subscribing."}` (confirmed via curl).
- CountrySelector visible (shows "Country" heading).
- PASS

---

## Issues found

### NIT #1 (MINOR): Social URLs are Shopify corporate placeholders, not store-specific URLs

**Severity:** Minor / operator action required before merge  
**MCP:** Playwright (static code inspection confirmed)

The impl notes correctly document this, but it surfaces as a nit in QA because the plan's Definition of Done (Section 6 Open Question #2) states "Operator must populate the `SOCIAL_LINKS` hrefs in `app/lib/const.js` before this feature is considered done."

Current state in `app/lib/const.js`:
```js
{platform: 'instagram', href: 'https://www.instagram.com/shopify', ...}
{platform: 'twitter-x', href: 'https://x.com/shopify', ...}
{platform: 'facebook',  href: 'https://www.facebook.com/shopify', ...}
{platform: 'tiktok',    href: 'https://www.tiktok.com/@shopify', ...}
```

The impl notes claimed these were empty strings (`''`), but the actual file contains Shopify corporate URLs. The social icons DO render (empty-href suppression logic is bypassed by non-empty placeholder URLs), which is better than invisible icons — but these will need to be replaced with the store's own social profile URLs before production.

**Reproduction:** Inspect `app/lib/const.js` lines 5–11.

### OBSERVATION (not a bug): Invalid-locale POST returns HTTP 500 not 404

**Severity:** Observation only — pre-existing framework behavior  
**MCP:** curl

The plan (Step 8) says: "POST directly to `/xx-yy/api/newsletter` (invalid locale) via curl — expect 404."

Actual behavior: `POST /xx-yy/api/newsletter` returns HTTP 500.

The action's locale guard correctly `throw new Response(null, {status: 404})`, but the Hydrogen/Remix SSR layer converts this to a 500 when it fails to render the error layout (because the route has no default export loader and the framework tries to SSR the error boundary). This is identical behavior to the existing `($locale).api.countries.jsx` route — `POST /xx-yy/api/countries` also returns 500. It is a pre-existing framework behavior, not introduced by this feature.

The action logic itself is correct; only the HTTP status code surfaced to external callers (curl) differs from the plan's expectation. Clients using `fetcher.Form` with a valid locale are not affected.

### OBSERVATION: Dev server must be restarted to pick up the new route

**Severity:** Observation / developer workflow note  
**MCP:** Network manifest inspection via curl

During testing with an already-running dev server started before the newsletter route file was added, the `/__manifest?p=/api/newsletter` response did not include the newsletter route — causing the fetcher to silently skip the POST. After restarting `npm run dev`, the route was correctly registered and all form submissions worked.

This is expected Vite/Remix dev server behavior: route discovery happens at startup. The Coder's impl notes note that the smoke check was skipped with a fresh server; QA confirms the feature works correctly on a freshly started server. Any developer picking up this branch should start with `npm run dev` fresh rather than resuming a stale server session.

---

## Console errors and warnings

| Source | Type | Message | Caused by this feature? |
|--------|------|---------|------------------------|
| Product page | Warning | `React does not recognize 'preserveControl' prop on a DOM element` at `Link.jsx` / `ProductForm` | No — pre-existing |
| monorail-edge.shopifysvc.com | Error | CORS preflight blocked | No — pre-existing analytics CORS on localhost |
| Newsletter invalid-email test | Error | `Failed to load resource: 400` | No — expected HTTP 400 responses from newsletter action |

Zero hydration-related warnings observed on any page.

---

## Network failures and slow responses

- No network failures attributable to the footer feature.
- Pre-existing CORS failure on `https://monorail-edge.shopifysvc.com/v1/produce` (Shopify analytics telemetry — expected in local dev).
- All Storefront API calls succeeded; product page GraphQL data populated correctly.

---

## Accessibility observations

- All four social icon links include `<span class="sr-only">{label}</span>` — screen reader labels present.
- Each social SVG has a `<title>` element (e.g., `<title>Instagram</title>`).
- Honeypot input has `aria-hidden="true"` and `tabIndex={-1}` — correctly excluded from assistive tech.
- Newsletter success/error message uses `role="status"` and `role="alert"` respectively — correct ARIA live region semantics.
- No `role="contentinfo"` added to `<footer>` (correct — native `<footer>` element conveys the landmark implicitly).
- `<Section as="footer">` renders a real `<footer>` DOM element — landmark is preserved.

---

## Performance notes

- No lazy-loaded components or deferred data in the footer — renders synchronously on the server.
- Social SVGs are inline (not network-fetched) — no additional image requests.
- Footer does not add new GraphQL queries — consistent with the plan's "no GraphQL changes" directive.

---

## Screenshots

- `/tmp/qa-footer-final.png` — Homepage scrolled to footer, showing three-column layout with Navigation, Follow Us (social icons), and Newsletter columns, plus CountrySelector and copyright row. Footer renders in dark background with white text as intended.

---

## Verdict

**PASS WITH NITS**

All functional requirements are met on a freshly started dev server. The one nit (social URLs are Shopify corporate placeholders rather than empty strings as documented in the impl notes) requires operator action before merge but does not block QA sign-off — the feature renders correctly and the impl notes already flag that operator must update the URLs. The invalid-locale 500 behavior is pre-existing and not caused by this feature.
