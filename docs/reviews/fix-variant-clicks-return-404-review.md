# Plan review: fix-variant-clicks-return-404 (Revision 2, re-review pass 3)

**Plan reviewed:** `docs/plans/fix-variant-clicks-return-404.md` (revision 2, 2026-05-18)
**Bug report:** `docs/bugs/variant-clicks-return-404.md`
**Investigation:** `docs/bugs/variant-clicks-return-404-investigation.md`
**Prior review:** this file (overwritten with the present pass)
**Reviewer:** Plan-Reviewer
**Date:** 2026-05-18

---

## 1. Summary

The prior review's single required change has landed cleanly. The stray prose mention of `en-us` on line 190 has been replaced with the correct, evidence-backed `en-ca` reference, and the file-pointer wording now correctly distinguishes between `app/data/countries.js` (the authoritative `countries` map, line 32 of which holds the `/en-ca` entry) and `app/lib/utils.js` (which merely imports it for `DEFAULT_LOCALE` derivation). A case-insensitive grep across the plan confirms zero remaining `en-us` references; the surviving single `app/lib/utils.js` mention on line 157 is correct in context (it documents where `DEFAULT_LOCALE` lives — line 241 of `utils.js` — not the `countries` map). The core fix mechanic, the Hydrogen-specific guardrails, the `npm run build` gate, and the scope guard around `preserveControl` remain unchanged from revision 2 and were clean in prior rounds. The plan is implementable as-is.

---

## 2. Strengths

- Both prior-round corrections landed cleanly and verifiably:
  - **`en-us` -> `en-ca`:** the stray "most likely candidate is `en-us`" prose on line 190 has been rewritten to "the canonical non-default example is `en-ca` (see line 32)", which matches `app/data/countries.js` line 32 (`'/en-ca': { label: 'Canada (CAD $)', ... }`). Confirmed reachable in `countries.js`.
  - **`app/lib/utils.js` vs `app/data/countries.js`:** line 190 now reads "Inspect `app/data/countries.js` (the authoritative `countries` map; `app/lib/utils.js` just imports it)" — this both points the Coder at the right file and explains why the two-file framing exists. The remaining `app/lib/utils.js` reference on line 157 is correctly scoped to `DEFAULT_LOCALE` (defined in `utils.js`, not in `countries.js`) and is factually correct.
- `/en-ca` is verified present at `app/data/countries.js` line 32 as `'Canada (CAD $)'`. The verification step exercises a real, reachable non-default-locale code path.
- The central fix mechanic (`to={{search: variantUriQuery}}` bypassing the `pathPrefix`-prepend branch via the `typeof to === 'string'` guard) is unchanged and remains correct against the actual `app/components/Link.jsx` wrapper behavior.
- All Hydrogen-specific concerns remain clean:
  - **Anti-Stubbing Rule:** no GraphQL stubbing, no commented-out UI.
  - **Hydration safety:** the change is a server- and client-stable object literal.
  - **Analytics Contract:** verification step 5 still checks `<Analytics.ProductView>` `variantId` updates after a swatch click.
  - **Complete image payloads:** untouched by the fix.
  - **`npm run build` gate:** verification step 2 still requires zero exit code plus zero codegen warnings.
- Scope guard around `preserveControl` (Section 3 + OQ2) is retained — the plan explicitly directs the Coder NOT to fix it in this pass.
- Section 4 step 1 (capture lint baseline) and the step-1/step-7 baseline-equality requirement remain in place.

---

## 3. Issues

None. The two corrections requested in the prior review have been applied correctly and no new issues surfaced on re-review.

---

## 4. Open questions

None. The plan is implementable end-to-end with no ambiguity.

---

## 5. Verdict

APPROVE
