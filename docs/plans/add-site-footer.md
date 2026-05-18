# Add Site Footer

Plan slug: `add-site-footer`
Status: revised after plan review (`docs/reviews/add-site-footer-review.md`, revision 3 — APPROVE WITH CHANGES)
Owner: Architect

## Revision summary

Revision 4 folds in the four operator-required changes flagged on the revision-3 review (`docs/reviews/add-site-footer-review.md`). All four are accuracy / clarity nits — none change the overall design:

- **Required change 1 (`parseMenu` returns `null`, not `undefined`)** — Section 6 Edge cases bullet 1 now states "if `parseMenu` returns `null` or the menu is missing entirely (`undefined`)." Verified against `app/lib/utils.js` line 197 (`return null` on missing/empty menu) and `app/root.jsx` line 314 (`data?.footerMenu ? parseMenu(...) : undefined`). Both `null` and `undefined` are reachable; the plan's `menu?.items` optional chain handles both. The reviewer's wording fix is applied verbatim.
- **Required change 2 (`<Section>` default styles)** — Step 4 now explicitly documents that `<Section>` from `~/components/Text` defaults to `display="grid"` and `padding="all"`. **Preferred choice stated:** pass `display="flex"` on the outer `<Section as="footer">` so its three direct child rows stack naturally without colliding with the inner three-column grid. This is the chosen path, not an option list — the Coder must not leave the default `display="grid"` in place because the outer grid's auto-flow against a nested grid produces inconsistent spacing.
- **Required change 3 (`fetcher.Form` action URL — no `<Link>` wrapping)** — Step 4 now contains a PITFALL callout next to the form sketch: the `action` prop must be a plain string path (`` `${pathPrefix}/api/newsletter` ``). It must NEVER be run through `~/components/Link` or any Hydrogen `<Link>` helper, because `Link.jsx` already applies the locale prefix internally, which would produce `/en-ca/en-ca/api/newsletter`.
- **Required change 4 (Newsletter route handles POST only)** — Step 3 now clarifies that the resource route's default-exported component returns `null` (matching `($locale).api.countries.jsx`), so direct `GET` navigation to `/api/newsletter` renders nothing inside the layout. This is intentional and expected — documented so the Coder does not chase it as a no-op bug.

Prior revisions (1–3) folded in: the no-GraphQL-changes conclusion (Section 5), the verification five-check baseline, the DOM structure, `SOCIAL_LINKS` constant, copyright fallback, locale guard in the action, `useIsHydrated` import from `~/hooks/useIsHydrated` (NOT `~/lib/utils`), honeypot via off-screen positioning, optional-chaining coding notes on `useRouteLoaderData('root')`, removal of explicit `role="contentinfo"`, removal of unconditional `console.log` in the action, and the non-default-locale POST smoke check in Step 8. None of those are altered in this revision.

---

## 1. Problem statement and goals

The Hydrogen storefront currently renders a footer that is driven entirely by the Shopify `footer` menu (see `Footer` and `FooterMenu` inside `app/components/PageLayout.jsx`). It auto-expands columns based on how many menu items are present and pairs them with a `CountrySelector`. There is no dedicated social-channel section and no newsletter capture.

We want a deliberate three-column site footer with predictable content:

1. **Navigation** — links sourced from the existing Shopify `footer` menu (so merchandisers retain control), rendered as a single column of links (no nested disclosures).
2. **Social** — fixed list of icon links to social channels (Instagram, Twitter/X, Facebook, TikTok).
3. **Newsletter signup** — email input plus submit button, posting to a Remix `action` on a dedicated resource route. The form requires JavaScript (the submit button is disabled until hydration completes); see Section 3 for the no-JS handling rationale.

Goals:

- Replace the current `Footer` implementation in `PageLayout.jsx` with a three-column layout that respects the design directives.
- Keep the existing GraphQL `footerMenu` fetch in `app/root.jsx` (no GraphQL changes required — see Section 5).
- Introduce a Remix resource route that handles newsletter `POST` requests, returning a structured JSON response that the form consumes via `useFetcher`.
- Use `@shopify/hydrogen` helpers (`<Link>`) and the project's existing `<Link>` wrapper at `app/components/Link.jsx` (which internally uses Hydrogen) for internal links. External social links remain `<a>` tags (consistent with the existing `FooterLink` external-URL branch).
- Keep all files as `.jsx` with JSDoc — no native TypeScript.

Non-functional:

- No new runtime dependencies. Social SVGs are added inline to `app/components/Icon.jsx` following the existing icon convention.
- The footer must SSR cleanly (no `window`/`document` access at render time). The success message after newsletter submit only appears once the fetcher returns data, which is already client-mediated by Remix.

## 2. Non-goals

- **No third-party newsletter integration** in this change (Klaviyo, Mailchimp, Shopify Customer API). The `action` validates input and returns a stubbed success response. Wiring to a real provider is a follow-up plan — see Open Questions.
- **No CMS-driven social links.** Social URLs are configured in code (a `SOCIAL_LINKS` named export in `app/lib/const.js`). Making these CMS-driven is out of scope.
- **No redesign of the existing header** or `PageLayout` outer shell. Only the `Footer` function (and helpers it owns) inside `PageLayout.jsx` change, plus extracted components.
- **No removal of the `CountrySelector`**. The current footer composes a `<CountrySelector />`; the new footer will continue to render it below the three columns so locale switching is preserved.
- **No analytics events for newsletter submission** in this change. The Analytics Contract (per `CLAUDE.md`) governs `ProductView`/`ItemView`; newsletter tracking is a separate concern.
- **No i18n of the footer copy.** Column headings and the newsletter placeholder are hard-coded English strings, matching the rest of the codebase today.
- **No progressive-enhancement (no-JS) form submission.** This is an explicit non-goal of this change. See Section 3 for the rationale and the chosen UX.

## 3. Proposed design

### Component composition

```mermaid
flowchart TD
    Root[app/root.jsx loader] -->|footerMenu via LAYOUT_QUERY| PageLayout
    PageLayout -->|<Footer menu={footerMenu} />| Footer
    Footer --> FooterNavColumn
    Footer --> FooterSocialColumn
    Footer --> FooterNewsletterColumn
    Footer --> CountrySelector
    Footer --> CopyrightRow
    FooterNewsletterColumn -->|useFetcher.Form POST| NewsletterRoute[($locale).api.newsletter.jsx]
    NewsletterRoute -->|json({ok, message})| FooterNewsletterColumn
```

### DOM structure (concrete)

The footer's DOM layout is specified up front so the Coder has no structural ambiguity:

```jsx
<Section as="footer" display="flex" className="bg-primary dark:bg-contrast text-contrast dark:text-primary flex-col">
  {/* Row 1: three equal columns. The grid contains exactly these three children. */}
  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
    <FooterNavColumn menu={menu} />
    <FooterSocialColumn />
    <FooterNewsletterColumn />
  </div>

  {/* Row 2: full-width sibling row for the CountrySelector. NOT inside the grid above. */}
  <div className="mt-8 pt-8 border-t border-contrast/20">
    <CountrySelector />
  </div>

  {/* Row 3: full-width sibling row for the copyright line. */}
  <div className="mt-6 text-sm opacity-70">
    {shopName ? `© ${year} ${shopName}` : `© ${year}`}
  </div>
</Section>
```

Key points:

- The CSS grid contains exactly the three columns. CountrySelector and copyright are **siblings of the grid**, not grid children with `col-span-3`. This avoids any ambiguity about how Tailwind's grid auto-flow places them.
- The wrapper element type is `<Section as="footer">` from `~/components/Text` so we inherit the site's spacing tokens (matching the existing footer). **The outer `<Section>` is passed `display="flex"` explicitly** to override its default `display="grid"` — see "`<Section>` default styles" below and Step 4 for the rationale.
- **No explicit `role="contentinfo"`.** The native `<footer>` element already conveys the `contentinfo` landmark when it is a top-level child of `<body>` (not nested inside `<article>` / `<section>`). Adding the explicit role is redundant and is flagged by axe / `eslint-plugin-jsx-a11y` as a smell. The Coder must additionally verify that `<Section as="footer">` renders a real `<footer>` element at the top of the resulting DOM (i.e., not a `<div>` wrapping a nested `<footer>`); if the rendered element is not a `<footer>`, the landmark is lost and the structure must be revisited.
- All color/spacing classes shown are illustrative; the Coder may adjust to match the existing footer's visual weight, but the three-row sibling structure is fixed.

### `<Section>` default styles (PITFALL)

`<Section>` from `app/components/Text.jsx` (lines 119–166) defaults to:

- `display="grid"` — renders as `display: grid` with `gap-4 md:gap-8` and no explicit `grid-template-columns`. If left as the default for the footer's outer wrapper, the three sibling rows (column grid, CountrySelector, copyright) become grid items in the outer grid, which produces inconsistent spacing once the column grid inside Row 1 is itself a grid.
- `padding="all"` — renders as `p-6 md:p-8 lg:p-12`. This is the desired footer padding and should stay.

**Chosen approach for this plan: pass `display="flex"` on the outer `<Section as="footer">`** so the three rows stack vertically as flex items and the inner column grid is the only `display: grid` element in the subtree. The accompanying `flex-col` className keeps the rows vertical. This is the path the DOM sketch above and Step 4 specify; do NOT leave the default `display="grid"` in place.

Alternatives that are explicitly rejected:

- Using a plain `<footer>` element instead of `<Section>` — loses the site's spacing tokens and requires re-implementing the padding scale.
- Using a `<div>` instead of `<footer>` — loses the `contentinfo` landmark.
- Adding `role="contentinfo"` to a `<div>` — the whole point of revision 3's role removal was to avoid the redundant role; recreating the problem on a non-`<footer>` element undoes that.

### Newsletter flow

1. **Form mechanics.** The form is a `<fetcher.Form method="post" action={newsletterActionPath}>` where `newsletterActionPath` is derived from `useRouteLoaderData('root')?.selectedLocale?.pathPrefix` (see "Locale-prefix derivation" below). This is the canonical pathPrefix source — the same one `app/components/Link.jsx` uses — so we do not introduce a second derivation.

2. **Action validation.** The route's `action` performs, in order:
   - Validate `params.locale` matches the storefront's i18n config (404 on mismatch). This mirrors `app/routes/($locale)._index.jsx` lines 36–43.
   - Read the honeypot field `_gotcha`. If non-empty, return a fake success response without further processing (defangs the obvious bot vector).
   - Read `email` from `formData`. If missing or fails a basic regex, return `json({ok: false, message: '...'}, {status: 400})`.
   - Otherwise return `json({ok: true, message: 'Thanks for subscribing.'})`. Add a `// TODO: integrate with email provider` comment.

3. **UI feedback.** The component reads `fetcher.data` and `fetcher.state` to swap the button label to "Submitting..." while in flight and render a `<p role="status">` (or `role="alert"` for errors) once a response is back. Because `fetcher.data` is `undefined` on first render in both SSR and the client, no hydration mismatch is possible.

4. **No-JS handling (explicit non-goal).** The form submits via `useFetcher`, which requires JS to render the response inline. Without JS, the browser would post directly to the endpoint and render the raw JSON response. To avoid that broken state:
   - The form's submit button is gated on hydration via the existing `useIsHydrated` hook at `app/hooks/useIsHydrated.jsx` (already imported by `PageLayout.jsx` line 22 and used by the `Badge` component). Do NOT duplicate this helper into `app/lib/utils.js`.
   - The submit button is rendered with `disabled={!isHydrated || fetcher.state !== 'idle'}` and the input is also `disabled` while not hydrated. Visually we may render a "Loading newsletter form..." placeholder when `!isHydrated`, OR simply render the disabled controls — the Coder may choose; document the choice in impl notes.
   - Result: no-JS users see a non-interactive newsletter form (visually present, not submittable). This is a worse experience than full progressive enhancement, but it is **not the broken JSON-on-white-page** outcome the original plan would have produced.
   - This is explicitly called out as a non-goal in Section 2.

### Locale-prefix derivation (canonical pattern)

The original plan used `useParams()` to derive the locale prefix. The reviewer flagged this as inconsistent with `app/components/Link.jsx`, which uses `useRouteLoaderData('root')?.selectedLocale?.pathPrefix`. We switch to the canonical pattern:

```jsx
const rootData = useRouteLoaderData('root');
const pathPrefix = rootData?.selectedLocale?.pathPrefix ?? '';
const newsletterActionPath = `${pathPrefix}/api/newsletter`;
```

- When the user is on the default locale, `pathPrefix` is `''` and the action resolves to `/api/newsletter`.
- When on a non-default locale, `pathPrefix` is e.g. `/en-ca` and the action resolves to `/en-ca/api/newsletter`.
- This matches exactly what `Link.jsx` does for `to`, so the two derivations cannot drift.

### Coding notes (apply throughout `Footer.jsx`)

The following rules apply to every read off the root route loader inside `Footer.jsx` and its column helpers. Surface here so the Coder cannot lose them on subsequent additions:

- **Optional chaining on `useRouteLoaderData('root')` is required.** Every dereference must use `?.` all the way through, e.g.:
  - `useRouteLoaderData('root')?.selectedLocale?.pathPrefix`
  - `useRouteLoaderData('root')?.layout?.shop?.name`
  - Any future field: `useRouteLoaderData('root')?.foo?.bar`
- Rationale: on the very first transitional SSR render, the root loader's data may be `undefined`. A bare `rootData.selectedLocale` would throw `TypeError: Cannot read properties of undefined`. The optional chain plus a nullish-coalescing fallback (`?? ''` or `?? false`) is the only safe pattern.
- If a fourth read of `rootData` is added later (locale code, currency code, customer state, etc.), apply the same pattern. The Plan-Reviewer flagged that a Coder is most likely to forget this on a field they add late in the implementation — keep the rule visible.

### Social icons

- Add `IconInstagram`, `IconTwitterX`, `IconFacebook`, `IconTikTok` to `app/components/Icon.jsx`.
- The reviewer confirmed `app/components/Icon.jsx` lines 8–15: the `<svg>` element has `viewBox="0 0 20 20"` (line 10) **before** `{...props}` (line 11). Therefore a `viewBox` prop on the social-icon component overrides the default. **The Coder must pass `viewBox="0 0 24 24"` when instantiating each social icon** (most brand glyphs ship on a 24x24 grid). No change to the `Icon` shell is required.

### File ownership

The existing `Footer` and `FooterMenu` functions inside `PageLayout.jsx` are tightly coupled to `PageLayout`. Two options:

- **Option A (chosen):** Extract the new footer into `app/components/Footer.jsx` and import it from `PageLayout.jsx`. This keeps `PageLayout.jsx` focused on the header/layout shell and matches the broader project convention (each `app/components/*.jsx` is a single concern). Smaller diffs in `PageLayout.jsx`; easier to test the footer in isolation later.
- **Option B (rejected):** Edit the existing `Footer`/`FooterMenu` in place inside `PageLayout.jsx`. Rejected because the three-column footer is a meaningfully different shape from the current menu-driven N-column footer and the disclosure/`FooterLink` helpers are not needed.

Going with Option A. The `FooterLink` helper and the old `FooterMenu` disappear; replace `FooterMenu`'s "all items at top level become columns" behavior with "all items at top level become individual links in the single Navigation column."

## 4. Affected files and modules

### New files

- `app/components/Footer.jsx` — the new three-column footer plus its `FooterNavColumn`, `FooterSocialColumn`, `FooterNewsletterColumn` helpers. Owns the JSDoc typedef for its props.
- `app/routes/($locale).api.newsletter.jsx` — Remix resource route exporting an `action` that validates the locale, checks the honeypot, validates email, and returns JSON. Exports a `default` no-op component (matches `($locale).api.countries.jsx` shape).

### Modified files

- `app/components/PageLayout.jsx` — remove the inline `Footer`, `FooterMenu`, and `FooterLink` functions; import the new `Footer` from `~/components/Footer` and render it the same way the old one was rendered.
- `app/components/Icon.jsx` — add `IconInstagram`, `IconTwitterX`, `IconFacebook`, `IconTikTok` exports. No change to the `Icon` shell itself (reviewer-confirmed: prop spread overrides default `viewBox`).
- `app/lib/const.js` — add a named export `SOCIAL_LINKS` (array of `{platform, href, label}`). The icon component for each platform is mapped inside `Footer.jsx` (keeping `const.js` data-only).

### Not modified

- `app/root.jsx` — no change needed. The existing `LAYOUT_QUERY` already fetches `footerMenu` with id/title/url/items, which is exactly what the Navigation column needs.
- `app/components/Link.jsx` — used as-is.
- `app/components/Text.jsx` — used as-is.
- `app/lib/utils.js` — **NOT modified.** The `useIsHydrated` hook is NOT to be added here. Import it from the existing `app/hooks/useIsHydrated.jsx` instead.
- `app/hooks/useIsHydrated.jsx` — used as-is. Already exports `useIsHydrated`. Already imported by `PageLayout.jsx` (line 22) and `Badge` (line 362). No edits required.
- Generated GraphQL declaration files — untouched; no fragment changes.

## 5. Data model and API changes

### GraphQL

**No GraphQL changes required.** The Navigation column consumes the `footerMenu: EnhancedMenu` already produced by `LAYOUT_QUERY` in `app/root.jsx` and parsed by `parseMenu` in `app/lib/utils.js`. We read only `id`, `title`, `to`, `target` from each top-level menu item — all already in the fragment.

Therefore:

- No fragment edits.
- No `storefrontapi.generated.d.ts` regeneration triggered by this change.
- `npm run build` will still run the codegen pass; it just won't produce a diff in the generated declaration file. The build remains the type-check gate.

### New Remix endpoint

`POST /api/newsletter` (and locale-prefixed equivalents via `($locale)` route matching).

Request body (form-encoded):

```
email: string
_gotcha: string   // honeypot — must be empty for a real submission
```

Response (JSON):

```
{ ok: true, message: string }    // 200 (real success or honeypot-tripped fake success)
{ ok: false, message: string }   // 400 (invalid email) or 500 (server error)
```

The `action` validates the locale up front and 404s on mismatch (same behavior as other `($locale)` routes). No persistence in this change; the action validates and returns. Add a `// TODO: integrate with email provider` comment so the Coder does not infer a backend integration is silently expected.

## 6. Risks, edge cases, and open questions

### Risks

- **Locale validation in the `action`**: if omitted, `POST /xx-yy/api/newsletter` for any garbage locale string would succeed and return a 200. Step 3 includes the validation block; Coder must not drop it.
- **Locale-prefixed action URL drift**: the form `action` must be derived from `useRouteLoaderData('root')?.selectedLocale?.pathPrefix`, not `useParams()`. Step 4 specifies this; do not change it. The `action` string also must not be wrapped in `~/components/Link` — see Step 4 PITFALL.
- **CountrySelector regression**: the old footer rendered `<CountrySelector />`. The new layout continues to render it as a full-width sibling row below the grid. Easy to forget during extraction.
- **Hydration**: the newsletter component uses `useFetcher`, which is SSR-safe. The form must NOT read `fetcher.data` to render anything that differs between SSR and first client render — `fetcher.data` is `undefined` on first render in both environments, so we are safe as long as the success/error `<p>` is conditionally rendered only when `fetcher.data` exists. The submit button's `disabled` attribute depends on `useIsHydrated()`, which returns `false` during SSR and on first client render (before `useEffect` fires), so SSR and first client render agree (`disabled` is true in both). After the `useEffect` flips the state, React re-renders and the button enables. This is the standard pattern and is hydration-safe.
- **CSP / nonce**: the project uses `useNonce()` in `root.jsx`. No inline scripts are introduced by this change, so no CSP impact.
- **Anti-Stubbing Rule**: there is no GraphQL data being stubbed here. The newsletter action returning a stub success message is product behavior, not data stubbing — call this out in the impl notes so QA does not flag it.
- **Bot abuse vector**: the `action` is open to bots. The honeypot field (`_gotcha`) is a cheap, zero-dependency mitigation but it is NOT a complete bot defense. Even with off-screen positioning rather than `display: none`, well-engineered bots routinely render layout and skip off-screen fields. Real rate limiting and provider integration are follow-ups; the honeypot is meant only to filter the easiest-to-defeat bots until that follow-up lands.

### Edge cases

- Empty `footerMenu`: if `parseMenu` returns `null` or the menu is missing entirely (`undefined`) — both are reachable per `app/lib/utils.js` line 197 (`return null` on invalid input) and `app/root.jsx` line 314 (`data?.footerMenu ? parseMenu(...) : undefined`) — the new `Footer` renders an empty Navigation column (heading only) while the Social and Newsletter columns continue to render. The `menu?.items` optional chain handles both shapes uniformly. The guard in `PageLayout` changes from `{footerMenu && <Footer ... />}` to `<Footer menu={footerMenu} />` so social + newsletter remain visible even without a Shopify menu.
- **Unresolved root loader on transitional renders**: every read off `useRouteLoaderData('root')` inside `Footer.jsx` must use optional chaining (`?.`) all the way through plus a fallback (`?? ''` or `?? false`). This applies to `pathPrefix`, `shopName`, and any field added later. The "Coding notes" block in Section 3 is the authoritative restatement of this rule; this bullet is the reminder that surfaces it under risks/edge cases as well.
- Invalid email submitted: action returns 400 + message; component shows error message; input retains the value so the user can correct it (Remix re-renders preserve form state when using `fetcher.Form`).
- Submit with empty email: validation catches it and returns 400. The browser-native `required` attribute on the input plus `type="email"` provides client-side first-pass validation as well.
- Double-submit: while `fetcher.state !== 'idle'`, disable the submit button.
- External vs internal nav links: the existing `FooterLink` distinguished `http`-prefixed URLs (external `<a>` with `rel="noopener noreferrer"`) from internal ones (`<Link>`). The new `FooterNavColumn` must preserve that distinction.
- Honeypot tripped: the action returns `{ok: true, message: 'Thanks for subscribing.'}` without recording anything, so the bot sees a normal-looking success and the genuine signup flow is unaffected.
- No-JS user: the form is rendered but the submit button is disabled (`useIsHydrated` returns `false`). User cannot submit; this is the documented trade-off, not a bug.

### Open questions

These must be resolved by the operator BEFORE the Coder runs the implementation step. The Coder must not silently fall back to defaults on items 2–4.

1. **Newsletter backend**: should this plan provision a real provider integration (Klaviyo, Shopify Customer marketing consent, Mailchimp, etc.) or is a stubbed action acceptable for now? Recommendation: stub for now, file a follow-up.
2. **Social channels list and URLs**: the feature description names Instagram, Twitter/X, Facebook, TikTok. The operator must provide the actual URLs (e.g., `https://www.instagram.com/<handle>`) before this change is considered done. The Coder may use `''` (empty string) placeholders in `SOCIAL_LINKS` during initial development, but the impl notes MUST flag that operator URLs are required before merge.
3. **CountrySelector**: keep it in the new footer (current behavior) or move/remove it? Recommendation: keep it, render below the three columns spanning full width. The DOM structure in Section 3 reflects "keep." Confirm before implementation.
4. **Copyright line**: the current footer renders Hydrogen attribution. We replace it with `© ${year} ${shopName}` (with a clean `© ${year}` fallback when `shopName` is empty — no trailing space). Confirm the new text and fallback before implementation.
5. **Navigation column heading text**: default is "Navigation". Operator may prefer "Shop", "Links", "Menu", or the previous merchandiser-chosen behavior. Confirm before implementation.

## 7. Step-by-step implementation checklist for the Coder

Execute in order. Run `npm run lint` after step 2 and again at the end. Run `npm run build` at the end. Do not skip the pre-save audit (CLAUDE.md, Coder section).

### 1. Add social URL constants in `app/lib/const.js`

Add a named export:

```js
// app/lib/const.js
export const SOCIAL_LINKS = [
  {platform: 'instagram', href: '', label: 'Instagram'},
  {platform: 'twitter-x', href: '', label: 'Twitter / X'},
  {platform: 'facebook',  href: '', label: 'Facebook'},
  {platform: 'tiktok',    href: '', label: 'TikTok'},
  // TODO: operator must populate `href` values before this feature is considered done.
];
```

Keep `const.js` data-only — do not import the icon components here. The mapping from `platform` -> Icon component is done in `Footer.jsx`.

The Coder records in impl notes that operator-provided URLs are still required, and lists the four placeholders left at `''`.

### 2. Add social icons to `app/components/Icon.jsx`

- Add `IconInstagram`, `IconTwitterX`, `IconFacebook`, `IconTikTok` as named exports, following the existing `IconBag`/`IconSearch` pattern.
- **Pass `viewBox="0 0 24 24"` on every social icon's `<Icon>` element.** Confirmed by review: lines 8–15 of `Icon.jsx` spread `...props` before the local `fill`/`stroke`, so the prop override takes effect. No edits to the `Icon` shell are required.
- Include a `<title>` element inside each icon for accessibility, matching the existing pattern.

Sketch:

```jsx
export function IconInstagram(props) {
  return (
    <Icon {...props} viewBox="0 0 24 24">
      <title>Instagram</title>
      <path d="..." />
    </Icon>
  );
}
```

### 3. Create the newsletter resource route at `app/routes/($locale).api.newsletter.jsx`

Required structure:

```jsx
import {json} from '@shopify/remix-oxygen';

/** @typedef {import('@shopify/remix-oxygen').ActionFunctionArgs} ActionFunctionArgs */

/**
 * @param {ActionFunctionArgs}
 */
export async function action({request, params, context}) {
  // 1. Locale guard — same shape as ($locale)._index.jsx lines 36–43.
  const {language, country} = context.storefront.i18n;
  if (
    params.locale &&
    params.locale.toLowerCase() !== `${language}-${country}`.toLowerCase()
  ) {
    throw new Response(null, {status: 404});
  }

  const formData = await request.formData();

  // 2. Honeypot check — if a bot filled `_gotcha`, return a fake success.
  const honeypot = String(formData.get('_gotcha') ?? '');
  if (honeypot.trim() !== '') {
    return json({ok: true, message: 'Thanks for subscribing.'});
  }

  // 3. Validate email.
  const email = String(formData.get('email') ?? '').trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!email || !emailOk) {
    return json(
      {ok: false, message: 'Please enter a valid email address.'},
      {status: 400},
    );
  }

  // TODO: integrate with email provider.
  // NOTE: Do NOT add unconditional `console.log` here. If you need debug
  // observability during QA, wrap it explicitly:
  //
  //   if (process.env.NODE_ENV !== 'production') {
  //     console.log('[newsletter] submission accepted');
  //   }
  //
  // Even then, treat any such logging as a temporary dev/QA aid that should
  // be removed (or migrated to a proper logger) when the real provider
  // integration lands. Never log the email itself (PII).
  return json({ok: true, message: 'Thanks for subscribing.'});
}

export default function NewsletterApiRoute() {
  return null;
}
```

Notes:

- **This route handles `POST` only.** No `loader` is exported. The default-exported component returns `null` — matching the `($locale).api.countries.jsx` shape — so a direct browser `GET` to `/api/newsletter` (or `/en-ca/api/newsletter`, etc.) will render nothing inside the layout (an apparent no-op page). This is intentional and expected behavior; the Coder should not chase the empty `GET` response as a bug, and QA should not flag it. The route exists to be POSTed to by `fetcher.Form` and for nothing else.
- The previous revision included a top-level `console.log('[newsletter] submission accepted')` as QA observability. That line has been removed. Any debug logging must be wrapped in `if (process.env.NODE_ENV !== 'production')` (see the inline comment in the sketch above) and is intended only as a short-lived dev aid. Do not ship logging to production from this action.

### 4. Create `app/components/Footer.jsx`

Required structure (see Section 3 "DOM structure (concrete)" for the row layout):

- `export function Footer({menu})` — outer `<Section as="footer" display="flex" className="... flex-col">` (no explicit `role="contentinfo"`; the `<footer>` landmark is implicit). Inside: the three-column grid (Section 3), followed by a full-width row containing `<CountrySelector />`, followed by a full-width row containing the copyright line. The CountrySelector and copyright are **siblings of the grid**, not grid children.

  **`<Section>` defaults — required override:** `<Section>` from `~/components/Text` defaults to `display="grid"` (with `gap-4 md:gap-8`) and `padding="all"` (with `p-6 md:p-8 lg:p-12`). The `padding="all"` default is fine and should stay. The `display="grid"` default WILL fight the three-row sibling structure because the outer grid would treat each of the three rows as a grid item with no `grid-template-columns` set, producing inconsistent spacing once the inner column grid in Row 1 is itself a `display: grid` element.

  **Preferred choice (use this, not a class override):** pass `display="flex"` explicitly on the outer `<Section as="footer">`, and add `flex-col` to its `className` so the three sibling rows stack vertically as flex items. This is the path the DOM sketch in Section 3 uses. Do NOT leave the default `display="grid"` in place, and do NOT swap the outer element for a `<div>` (would lose the `<footer>` landmark — see Section 3) or for a plain `<footer>` (would lose the site's spacing tokens).

- `FooterNavColumn({menu})` — heading "Navigation" (or whichever heading the operator confirms — see Open Questions item 5), then a `<nav>` containing a `<ul>` of top-level menu items. Render each item with the same internal/external branching the old `FooterLink` had: `item.to.startsWith('http')` -> `<a href={...} target={...} rel="noopener noreferrer">{item.title}</a>`, else `<Link to={...} target={...} prefetch="intent">{item.title}</Link>` (use `~/components/Link`). If `menu?.items` is empty, render the heading only (keeps the three-column grid stable).

- `FooterSocialColumn()` — heading "Follow Us"; maps `SOCIAL_LINKS` to a horizontal flex of icon links. Each link is `<a href={href} target="_blank" rel="noopener noreferrer">` wrapping the matching icon and a `<span className="sr-only">{label}</span>`. The platform-to-icon mapping lives here (`{instagram: IconInstagram, 'twitter-x': IconTwitterX, ...}`). If a link's `href` is `''`, skip rendering it (so empty placeholders are not visible as broken links).

- `FooterNewsletterColumn()` — heading "Newsletter"; brief description (`<Text>...</Text>`); a `useFetcher`-based form. Required behavior:

  ```jsx
  import {useFetcher, useRouteLoaderData} from '@remix-run/react';
  import {useIsHydrated} from '~/hooks/useIsHydrated';

  function FooterNewsletterColumn() {
    const fetcher = useFetcher();
    // NOTE: optional chaining is mandatory on every dereference of rootData.
    // See Section 3 "Coding notes" — the root loader may be undefined on the
    // first transitional render.
    const pathPrefix = useRouteLoaderData('root')?.selectedLocale?.pathPrefix ?? '';
    const action = `${pathPrefix}/api/newsletter`;
    const isHydrated = useIsHydrated();
    const submitting = fetcher.state !== 'idle';

    return (
      <div>
        <Heading as="h3" size="lead">Newsletter</Heading>
        <Text>Subscribe for updates.</Text>
        <fetcher.Form method="post" action={action}>
          {/*
            Honeypot — visually hidden via off-screen positioning (NOT
            display:none). Keeping the field in the rendered layout means
            bots that respect `display:none` still encounter it. This is a
            basic trap, not a complete bot defense — see Section 6 Risks.
          */}
          <input
            type="text"
            name="_gotcha"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{position: 'absolute', left: '-9999px', width: '1px', height: '1px'}}
          />
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            disabled={!isHydrated || submitting}
          />
          <Button type="submit" disabled={!isHydrated || submitting}>
            {submitting ? 'Submitting...' : 'Subscribe'}
          </Button>
        </fetcher.Form>
        {fetcher.data ? (
          <p role={fetcher.data.ok ? 'status' : 'alert'}>
            {fetcher.data.message}
          </p>
        ) : null}
      </div>
    );
  }
  ```

  **PITFALL — `fetcher.Form` action URL must be a plain string. Do NOT wrap it in `<Link>`.**

  The `action` prop on `<fetcher.Form>` is a plain string path (`` `${pathPrefix}/api/newsletter` ``). It MUST NOT be passed through `~/components/Link` or any Hydrogen `<Link>` helper, and it MUST NOT be constructed by any helper that applies the locale prefix on its own. Reason: `app/components/Link.jsx` already prepends `selectedLocale.pathPrefix` to every `to` it receives. If the Coder gets clever and runs the action string through `<Link to={action} />` or a similar helper, the result is `/en-ca/en-ca/api/newsletter` — the prefix double-applies and every POST 404s under non-default locales.

  The manual derivation `` `${pathPrefix}/api/newsletter` `` is the complete, final URL. Use it directly as `action="..."` on `<fetcher.Form>` and nowhere else.

  Key requirements:
  - Action URL is derived from `useRouteLoaderData('root')?.selectedLocale?.pathPrefix`. Do NOT use `useParams()`. Use optional chaining all the way through, every time — see Section 3 "Coding notes".
  - The action prop is a plain string. NEVER routed through `~/components/Link` or any locale-prefixing helper — see PITFALL above.
  - Hidden `_gotcha` honeypot input is present and uses **off-screen positioning** (inline style with `position:'absolute'; left:'-9999px'`), NOT `className="hidden"` (which Tailwind compiles to `display: none` and which bots that respect CSS will skip). Document in the JSX as shown.
  - `disabled={!isHydrated || submitting}` on both the input and the button — this is what gates no-JS users out of an interactive form that would otherwise produce a JSON-on-white-page.
  - The success/error `<p>` is conditionally rendered only when `fetcher.data` is defined, so SSR and first client render agree.

- **`useIsHydrated`** — import the existing hook from `app/hooks/useIsHydrated.jsx`:

  ```js
  import {useIsHydrated} from '~/hooks/useIsHydrated';
  ```

  This hook already exists, is already imported by `PageLayout.jsx` (line 22) and `Badge` (line 362), and is the canonical location for it. **Do NOT add a duplicate to `app/lib/utils.js`.** Do NOT modify `app/lib/utils.js` as part of this plan.

- **Copyright row** — render `© ${year} ${shopName}` where `shopName = useRouteLoaderData('root')?.layout?.shop?.name`. If `shopName` is falsy, render `© ${year}` (no trailing space). Concretely:

  ```jsx
  const rootData = useRouteLoaderData('root');
  const year = new Date().getFullYear();
  const shopName = rootData?.layout?.shop?.name;
  const copyright = shopName ? `© ${year} ${shopName}` : `© ${year}`;
  ```

  (Note the optional chain on `rootData?.layout?.shop?.name` — mandatory per the coding notes in Section 3.)

- **JSDoc typedef** at the bottom for `FooterProps` (matches the existing pattern at the bottom of `PageLayout.jsx`).

- **Imports needed**: `useFetcher`, `useRouteLoaderData` from `@remix-run/react`; `Link` from `~/components/Link`; `Heading`, `Text`, `Section` from `~/components/Text`; `Button` from `~/components/Button`; `CountrySelector` from `~/components/CountrySelector`; `IconInstagram`, `IconTwitterX`, `IconFacebook`, `IconTikTok` from `~/components/Icon`; `SOCIAL_LINKS` from `~/lib/const`; **`useIsHydrated` from `~/hooks/useIsHydrated`** (NOT from `~/lib/utils`).

### 5. Update `app/components/PageLayout.jsx`

- Remove the inline `Footer`, `FooterMenu`, and `FooterLink` function definitions.
- Remove now-unused imports: `Disclosure` from `@headlessui/react` (if not used elsewhere in the file — verify), `IconCaret` (likewise verify). Note: `Heading` and `Section` from `~/components/Text` are still used by `MobileHeader`/`DesktopHeader`; do NOT remove them.
- Confirm `Disclosure` and `IconCaret` are imported but not re-exported from `PageLayout.jsx` — removing the imports cannot break consumers (a quick grep across `app/` for `from '~/components/PageLayout'` and `import {Disclosure, IconCaret}` will confirm).
- Add `import {Footer} from '~/components/Footer';`.
- Change the guard from `{footerMenu && <Footer menu={footerMenu} />}` to `<Footer menu={footerMenu} />` so social + newsletter still render when the Shopify menu is missing. Coder records this decision in impl notes.
- Do NOT touch the existing `import {useIsHydrated} from '~/hooks/useIsHydrated'` on line 22 — it remains used by other code in the file.
- Run the pre-save audit: confirm no duplicate function names, no unresolved imports, no stray references to `FooterMenu`/`FooterLink`.

### 6. Run `npm run lint`. Fix any issues.

### 7. Run `npm run build`. Confirm:
- Codegen pass completes without errors.
- No TypeScript-via-JSDoc errors surface.
- The production build succeeds.

### 8. Manual smoke check (start `npm run dev`, then):

- Load `http://localhost:3000` — footer renders with three columns on desktop, single column on mobile.
- Inspect view-source — confirm the footer is server-rendered (links and headings visible in raw HTML; success message `<p>` should NOT be in source).
- Confirm the submit button is disabled in view-source (no-JS state) and becomes enabled after hydration.
- Submit the newsletter form with an invalid email — error message appears via `role="alert"`.
- Submit with a valid email — success message appears via `role="status"`, button is disabled during submit. (No `[newsletter] submission accepted` log line is expected in the terminal in this revision — the unconditional `console.log` has been removed.)
- Submit with the honeypot field populated (use DevTools to set its value before submit) — success response returned but no logging.
- POST directly to `/xx-yy/api/newsletter` (invalid locale) via `curl` — expect 404.
- **Non-default-locale happy path**: if the dev store exposes a locale prefix (e.g., `/en-us`, `/en-ca`), navigate to that locale (`http://localhost:3000/en-us`) and submit the form. Confirm the form's `action` URL resolves to the locale-prefixed path (visible via DevTools Network tab) and the response is `{ok: true, message: 'Thanks for subscribing.'}`. If the dev store only has the default locale configured, document that in impl notes; do not skip the check silently.
- Click each social icon — opens the placeholder URL in a new tab (if `href` is populated; empty hrefs do not render).
- Click a navigation link — internal links use client navigation; external links open with the right `rel`.
- DevTools console — no React hydration warnings.
- Inspect the rendered DOM at the bottom of the page — confirm there is a real `<footer>` element wrapping the footer content (not a `<div>` with the footer inside it). This validates that `<Section as="footer">` actually produced the landmark element.

### 9. Write `docs/plans/add-site-footer-impl-notes.md` capturing:

- The decision made on each Open Question (per Section 6).
- Whether social URL placeholders are still empty (and a reminder that operator must populate them before merge).
- Whether the dev store exposed a non-default locale for the Step 8 happy-path check, and the result if so.
- Any deviation from this plan.
- Confirmation of the lint and build commands passing.

## Verification (matches CLAUDE.md five-check baseline)

1. **HTTP smoke test**: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000` -> expect `200`.
2. **Browser check**: open `http://localhost:3000`; confirm footer renders three columns desktop / one column mobile; no React hydration warnings in DevTools console.
3. **Product page check**: navigate to any product (see `docs/dev-fixtures.md` for test handles); confirm the footer renders identically there (it's in the global layout) and product GraphQL data still populates correctly (Analytics Contract intact — `<Analytics.ProductView>` not affected by this change).
4. **Build check**: `npm run build` completes without errors (codegen + production build pass).
5. **Lint check**: `npm run lint` returns clean.

If any of the five fail, the Coder fixes before declaring done — do not paper over.
