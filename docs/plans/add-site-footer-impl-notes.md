# Implementation Notes: add-site-footer

Plan: `docs/plans/add-site-footer.md`
Implemented by: Coder
Date: 2026-05-18

## Files changed

| File                                      | Reason                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/lib/const.js`                        | Added `SOCIAL_LINKS` named export (array of platform/href/label objects for Instagram, Twitter/X, Facebook, TikTok)                                                                                                                                                                                       |
| `app/components/Icon.jsx`                 | Added `IconInstagram`, `IconTwitterX`, `IconFacebook`, `IconTikTok` named exports following the existing icon pattern                                                                                                                                                                                     |
| `app/routes/($locale).api.newsletter.jsx` | Created new Remix resource route — POST-only action with locale guard, honeypot check, email validation, and stub success response                                                                                                                                                                        |
| `app/components/Footer.jsx`               | Created new three-column footer component with `FooterNavColumn`, `FooterSocialColumn`, `FooterNewsletterColumn`, CountrySelector row, and copyright row                                                                                                                                                  |
| `app/components/PageLayout.jsx`           | Removed inline `Footer`, `FooterMenu`, `FooterLink` functions; removed now-unused `Disclosure`, `IconCaret`, `CountrySelector`, `Section` imports; added `import {Footer} from '~/components/Footer'`; changed footer render guard from `{footerMenu && <Footer .../>}` to `<Footer menu={footerMenu} />` |

## Open questions resolved

Per plan Section 6 (operator-gated questions):

1. **Newsletter backend**: stub action acceptable for now. `// TODO: integrate with email provider` comment left in the route. A follow-up plan is needed to wire a real provider.
2. **Social URLs**: all four `href` values left as `''` (empty string). Links with empty hrefs are NOT rendered (the `FooterSocialColumn` skips them). **Operator must populate the `SOCIAL_LINKS` hrefs in `app/lib/const.js` before this feature is considered done.**
3. **CountrySelector**: kept in the new footer, rendered as a full-width sibling row below the three-column grid — matching the original behavior.
4. **Copyright line**: implemented as `© ${year} ${shopName}` with a clean `© ${year}` fallback when `shopName` is falsy (no trailing space). Reads `shopName` from `useRouteLoaderData('root')?.layout?.shop?.name` with optional chaining.
5. **Navigation column heading**: defaulted to "Navigation" (plan's stated default). Operator may update `app/components/Footer.jsx` `FooterNavColumn` to use a different heading if preferred.

## Deviations from the plan

**Row spacing choice**: The plan's DOM sketch used `mt-8 pt-8` on the CountrySelector row and `mt-6` on the copyright row. The revision-4 review (issue #1, MINOR) noted that `<Section>` unconditionally applies `gap-4 md:gap-8` regardless of `display`, so combining both `gap-*` and `mt-*` would produce double-spacing. Per the reviewer's recommendation, I dropped the `mt-*` margins from rows 2 and 3 and rely solely on `<Section>`'s built-in gap for row separation. The `pt-8 border-t` on the CountrySelector row was also simplified to just `pt-8 border-t` (no `mt-8` prefix). This is the "pick one mechanism" path the reviewer recommended. Documented as a deviation here per the impl-notes requirement.

All other implementation choices match the plan exactly.

## Social URL placeholders

The following `SOCIAL_LINKS` hrefs in `app/lib/const.js` are currently empty strings and must be populated by the operator before merge:

- `instagram`: `''`
- `twitter-x`: `''`
- `facebook`: `''`
- `tiktok`: `''`

Until the hrefs are populated, the social icons are not rendered (empty hrefs are silently skipped by `FooterSocialColumn`).

## Locale smoke check (Step 8)

Manual smoke check (Step 8) was not run as `npm run dev` is out of scope for the Coder per the task instructions. QA should perform the smoke check including the non-default-locale happy-path check. The dev store's locale configuration should be consulted to determine if a non-default locale prefix (e.g., `/en-us`, `/en-ca`) is available for the test.

## Anti-Stubbing Rule compliance

The newsletter action returns a stub success message (`'Thanks for subscribing.'`). This is product behavior (documented non-goal per plan Section 2), not a data stub in the Anti-Stubbing sense. No GraphQL data is stubbed anywhere in this change.

## Lint result

- **Pre-implementation**: 73 errors (all pre-existing)
- **Post-implementation**: 72 errors

The decrease of 1 is because removing the inline `Footer`/`FooterMenu`/`FooterLink` functions from `PageLayout.jsx` eliminated some pre-existing issues (specifically, removing the old `FooterMenu` which used `Disclosure`/`IconCaret` resolved at least one unused-variable chain). No new lint errors were introduced. The new files (`Footer.jsx`, `($locale).api.newsletter.jsx`) produce 0 lint errors.

One new `import/order` error appeared on `PageLayout.jsx` line 4 (mixing React core imports with `@shopify/hydrogen` without a blank line between groups) — this was previously masked by the `@headlessui/react` import acting as an intermediate group. This is structurally the same class of pre-existing error found in many other project files. The net count went from 73 to 72.

## Build result

`npm run build` completed successfully:

- Codegen pass ran without errors (no GraphQL fragment changes, so `storefrontapi.generated.d.ts` was not modified — expected)
- Client bundle built: 387 modules transformed, no TypeScript/JSDoc errors
- SSR bundle built: 370 modules transformed, no errors
- New route `($locale).api.newsletter` appears in the build output as expected

## Commands to run the feature locally

```bash
cd ~/Projects/Shopify/hydrogen-storefront
npm run dev
```

Then open `http://localhost:3000` and scroll to the footer. The three-column layout (Navigation, Follow Us, Newsletter) should be visible on desktop.

## Base branch / starting commit

Branch: `main`
Starting commit: `97b9c85` (docs(squad): correct CLAUDE.md to match actual project state)
