# Implementation notes: fix-variant-clicks-return-404

**Plan:** `docs/plans/fix-variant-clicks-return-404.md` (Revision 2)
**Review verdict:** APPROVE — `docs/reviews/fix-variant-clicks-return-404-review.md`
**Implemented:** 2026-05-18
**Base branch/commit:** main @ 97b9c85

---

## Files changed

| File                                               | Reason                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `app/routes/($locale).products.$productHandle.jsx` | Two `to`-prop edits at the two `<Link>` call sites that pass `variantUriQuery`. |

No other files were modified.

---

## Exact before/after diffs

### Change 1 — Listbox option `<Link>` (line 274)

Before:

```jsx
<Link
  to={value.variantUriQuery}
  preventScrollReset
  prefetch="intent"
```

After:

```jsx
<Link
  to={{search: value.variantUriQuery}}
  preventScrollReset
  prefetch="intent"
```

### Change 2 — Swatch grid `<Link>` (line 299)

Before:

```jsx
<Link
  key={name}
  to={variantUriQuery}
  preserveControl
```

After:

```jsx
<Link
  key={name}
  to={{search: variantUriQuery}}
  preserveControl
```

---

## Pre-fix lint baseline

Ran `npm run lint` before any edits.

**Result:** 73 errors, 0 warnings.

Full error list includes pre-existing prettier/prettier and import/order violations across multiple files. No errors in `($locale).products.$productHandle.jsx` beyond the pre-existing prettier formatting issues on lines 296–310 (swatch grid block) and line 589.

---

## Post-fix lint result

Ran `npm run lint` after both edits were applied.

**Result:** 73 errors, 0 warnings.

Error count matches the baseline exactly. The two prop-value changes (`to={value.variantUriQuery}` → `to={{search: value.variantUriQuery}}` and `to={variantUriQuery}` → `to={{search: variantUriQuery}}`) do not introduce any new ESLint violations. The pre-existing prettier errors on the surrounding lines in the swatch grid (lines 296–310, line 589) are unchanged in content — the object literal form `{search: variantUriQuery}` did not alter or add to those pre-existing formatting complaints.

---

## Post-fix build result

Ran `npm run build`.

**Exit code:** 0 (success).

**Codegen warnings:** Zero. The build output contains no codegen warnings of any kind. The build ran the `--codegen` flag (via `shopify hydrogen build --codegen`) and completed without any schema or fragment-level warnings.

Relevant build output summary:

- Client bundle: 384 modules transformed, built in 2.49s
- SSR bundle: 368 modules transformed, built in 1.84s
- `dist/client/assets/(_locale).products._productHandle-BOXjzZbZ.js` — 22.71 kB (gzip: 8.34 kB), confirming the route bundle was included and compiled
- The only non-zero-exit warning during the full run was the pre-existing Vite CJS deprecation notice and the Remix `v3_singleFetch` future-flag advisory — both pre-existing, neither codegen-related.

---

## Commands to run the feature locally

```bash
cd ~/Projects/Shopify/hydrogen-storefront
npm run dev
# Open http://localhost:3000/products/the-complete-snowboard
# Click a non-selected Color swatch
# Verify URL becomes ?Color=<value> (not /products/.../Color=<value>)
# Verify HTTP 200 in Network tab
```

---

## Deviations from the plan

None. The implementation followed the plan exactly:

- Two single-prop edits, one file, no other files touched.
- `preserveControl` prop was left in place as directed.
- Lint baseline captured before edits (73 errors); post-fix lint equals baseline (73 errors).
- Build exits zero with zero codegen warnings.

Note: the plan's Section 4 checklist also includes steps 9–11 (dev server startup, manual browser verification, locale-prefix regression check). Those steps require a running dev server and browser interaction; they are the QA agent's responsibility per the squad workflow. This impl-notes file covers steps 1–8 (the Coder's mechanical verification gate) as instructed by the task prompt.

---

## Out-of-scope observations

**`preserveControl` prop (OQ2 from plan):** The swatch `<Link>` at line 300 passes a `preserveControl` prop that is not a recognized Remix or Hydrogen `<Link>` prop and is not destructured in `app/components/Link.jsx`. It falls through into `...resOfProps` and becomes a DOM attribute on the underlying `<a>`. This is pre-existing and unrelated to this bug. A separate `cleanup-` ticket should address it.

**Pre-existing prettier errors in product route:** Lines 296–310 and line 589 of `($locale).products.$productHandle.jsx` have pre-existing `prettier/prettier` formatting errors in the swatch grid block. These are unrelated to the variant-click bug and are in scope for a separate formatting cleanup.

---

## Bug fix verification approach

To confirm the bug is resolved (reference: `docs/bugs/variant-clicks-return-404.md` "Steps to reproduce"):

1. Start the dev server: `npm run dev`
2. Open `http://localhost:3000/products/the-complete-snowboard`
3. Open the browser Network tab (filter: Fetch/XHR or All)
4. Click a Color swatch that is NOT currently selected (e.g., "Dawn")
5. **Expected (post-fix):** URL bar shows `?Color=Dawn` appended as a query string; Network tab shows a loader request to `/products/the-complete-snowboard?Color=Dawn` returning HTTP 200; page re-renders with the Dawn variant's price, images, and swatch selection indicator.
6. **Was broken (pre-fix):** URL bar showed `/products/the-complete-snowboard/Color=Dawn` (path segment); Network tab showed HTTP 404; page rendered an error boundary.

For the Listbox dropdown path (options > 7 values), the same test applies: open the Listbox, select a non-active option, verify URL becomes `?<OptionName>=<Value>` and returns HTTP 200.
