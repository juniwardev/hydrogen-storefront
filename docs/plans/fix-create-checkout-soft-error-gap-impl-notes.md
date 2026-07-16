# Implementation Notes: `fix-create-checkout-soft-error-gap`

**Slug:** `fix-create-checkout-soft-error-gap`
**Type:** Bug fix
**Plan:** `docs/plans/fix-create-checkout-soft-error-gap.md`
**Plan review verdict:** APPROVE — `docs/reviews/fix-create-checkout-soft-error-gap-review.md`
**Investigation:** `docs/bugs/create-checkout-soft-error-gap-investigation.md`
**Coder:** Implemented exactly per plan §4, §7, §11 checklist. No scope expansion.

---

## Files changed

| File                         | Reason                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/lib/mcp.server.js`      | `createCheckout()` return: guard `checkout` on `payload?.id` instead of bare `payload ?? null`, so a non-thrown soft-error envelope (`isError:false`, no `id`) yields `checkout: null` instead of a junk truthy object. Comment expanded to document the guard rationale, mirroring `updateCart`'s comment.                                                                                                       |
| `app/lib/mcp.server.test.js` | Added `createCheckout` to the existing import (line 28 area). Appended a new `describe('createCheckout — soft-error guard', ...)` block with 2 cases (success + soft-error), reusing `plainFetch`, `BASE_OPTS`, `UCP_AUTH_MODES`, `__resetForTests()`, and a locally-scoped `successFetch` helper (mirroring the cart block's pattern, since the cart block's `successFetch` is block-scoped and not importable). |

No other files touched. `git diff --stat` confirms only these two files changed by this task; the repo's other modified files (`app/lib/const.js`, `app/lib/mcp-normalize.js`, `app/lib/mcp-normalize.test.js`, `app/routes/($locale).api.assistant.jsx`) are pre-existing uncommitted work from other in-flight features (`ucp-no-auth-mode`, `ucp-cart-create-flat-shape`) and were left untouched, as instructed.

### Before/after — the edited expression (`app/lib/mcp.server.js`, `createCheckout()` return)

**Before:**

```js
const payload = await callTool(callOpts);
// Success: checkout fields are FLAT at structuredContent (id, status,
// messages, continue_url, totals[], line_items[]) — the same flat shape as
// the cart tools (create_cart / update_cart) and search_catalog. There is no
// .checkout wrapper to unwrap.
return {
  checkout: payload ?? null,
  messages: payload?.messages ?? [],
};
```

**After:**

```js
const payload = await callTool(callOpts);
// Success: checkout fields are FLAT at structuredContent (id, status,
// messages, continue_url, totals[], line_items[]) — the same flat shape as
// the cart tools (create_cart / update_cart) and search_catalog. There is no
// .checkout wrapper to unwrap. Guard on the checkout's identifying `id` so a
// NON-thrown soft business-outcome payload (isError:false with error
// messages[] and no checkout fields — top-level keys continue_url/messages/
// ucp, no id, PROBED live) yields checkout:null instead of a junk checkout,
// mirroring createCart/updateCart's identity guard.
return {
  checkout: payload?.id ? payload : null,
  messages: payload?.messages ?? [],
};
```

`messages` line: **unchanged**, confirmed already `payload?.messages ?? []` before this fix (per plan §4.3/AL-1). No route change, no `createCart`/`updateCart` change, no `normalizeCheckout` change, no nesting change (checkout was already flat).

---

## Bug fix verification approach

This mirrors the plan's §9 verification steps and the bug's "Steps to reproduce" basis (the investigation's live probe of `ashford-quantum.myshopify.com`, since a live `isError:false` soft-error is not reproducible on demand — all probed error cases returned `isError:true`, which throws before the return path).

1. **Unit test is the primary guard (per AL-2 / plan §9.4).** `app/lib/mcp.server.test.js`, new `describe('createCheckout — soft-error guard', ...)` block:
   - Case 1 (`FLAT_CHECKOUT_PAYLOAD`, carries `id`): asserts `result.checkout` is non-null, `result.checkout.id`/`continue_url` match the fixture, `result.messages` is `[]`. Passes both before and after the fix (checkout was already flat) — a contract guard, not the pin.
   - Case 2 (`SOFT_ERROR_CHECKOUT_PAYLOAD`, `isError:false`, top-level keys exactly `continue_url`/`messages`/`ucp`, no `id` — matching the investigation's live-captured soft-error shape): asserts `result.checkout === null` and `result.messages` deep-equals the fixture's error `messages[]`. **This is the pin** — it fails against the pre-fix `payload ?? null` and passes after `payload?.id ? payload : null`.
2. **Fails-before / passes-after proof (executed in this session, see below).** Ran `npm run test:unit` with the tests added but the fix NOT yet applied → case 2 failed as expected. Applied the one-line guard → re-ran → all green.
3. QA should treat this as a **unit-guarded, not live-reproduced** fix (see "Notes for QA" below) — there is no manual browser repro step for the soft-error path itself, since the live server never surfaces `isError:false` with a missing `id` on demand. QA's manual check (if desired) is limited to confirming the normal add-to-cart → checkout-fallback path still works when it fires (real-checkout path is byte-identical pre/post fix).

---

## Prove-the-pin: actual test output

### BEFORE the fix (tests added, `mcp.server.js` still had `payload ?? null`)

```
✖ failing tests:

test at app/lib/mcp.server.test.js:909:3
✖ 2. createCheckout soft-error payload (isError:false, no id) returns checkout:null (0.831583ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + {
  +   continue_url: 'https://ashford-quantum.myshopify.com/',
  +   messages: [
  +     {
  +       code: 'invalid',
  +       content: 'The merchandise with id gid://shopify/ProductVariant/99999999999999 does not exist.',
  +       severity: 'unrecoverable',
  +       type: 'error'
  +     }
  +   ],
  +   ucp: { status: 'error' }
  + }
  - null

ℹ tests 67
ℹ suites 15
ℹ pass 66
ℹ fail 1
```

Case 2 genuinely fails pre-fix, confirming the bug: the soft-error envelope (truthy, no `id`) passes through the bare `?? null` guard as a junk "checkout."

### AFTER the fix (`payload?.id ? payload : null` applied)

```
ℹ tests 67
ℹ suites 15
ℹ pass 67
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All 67 tests pass (the pre-existing 65 baseline + the 2 new `createCheckout` cases).

---

## Gate results

1. **`npm run test:unit`** — 67/67 pass (baseline was 65; +2 new `createCheckout` cases). See prove-the-pin above for before/after.
2. **`npm run lint`** — 72 pre-existing problems total across the repo (confirmed unchanged from baseline: `grep -i "mcp.server"` on the lint output returns zero lines — no lint errors on either touched file). No new problems introduced.
3. **`npm run build`** — exit code 0. Completes with the pre-existing "Bundle analyzer failed to analyze the bundle: TypeError: Invalid URL" notice and "Could not generate bundle analysis summary: ENOENT" message — these are pre-existing/unrelated to this change (no GraphQL/codegen touched by this fix; `storefrontapi.generated.d.ts` untouched).

---

## Notes for QA (from Plan-Reviewer advisories)

Both non-blocking advisories from `docs/reviews/fix-create-checkout-soft-error-gap-review.md` are recorded here so QA reads them at its step:

1. **The plan's prose (§4.1/AL-4) overstated live-capture grounding.** It claimed a real checkout _success_ (`isError:false`) was live-captured carrying `id`. In fact, per the investigation, **both** probed live cases returned `isError:true` (error cases that happened to carry `id`); a genuine `isError:false` success was never captured live. The discriminator (`id`) is still correct — it rests on `normalizeCheckout`'s structural dependence on `rawCheckout.id` (`mcp-normalize.js:240`), not on the probe. **QA should NOT expect a live-reproducible soft-error success case** for `createCheckout`; the unit test (case 2, built from an `isError:false` fixture matching the investigation's captured soft-error _shape_) is the primary guard for this fix, not a live repro. Nothing inaccurate shipped in the code comment itself — the "PROBED live" attribution in the code comment is scoped only to the soft-error envelope's top-level keys, which is accurate.

2. **Post-fix lateral UX state on the checkout fallback's soft-error path.** When `createCheckout` returns `checkout: null` (post-fix), the route's reply copy still references "checkout here" with no usable URL (`checkoutUrl` becomes `undefined`) — a dangling CTA. Pre-fix, the same path produced a bogus link to the store homepage instead. Both are degraded states; post-fix is a lateral move (no misleading homepage-as-checkout link) rather than a regression this fix introduces. This is tracked separately as its own bug: `docs/bugs/assistant-checkout-null-dangling-cta.md`. **QA should treat the dangling/dead-end CTA as a known, pre-scoped-out condition — not a FAIL for this fix.**

---

## Deviations from the plan

None. Implemented exactly per plan §4 (the one-line guard + comment), §7 (2 test cases, no optional 3rd thrown-`tool_error` case added — not required per plan, and the plan already treats it as optional/not required), and §11 checklist.

## Out-of-scope observations

None newly discovered during this task. (Pre-existing lint problems and the bundle-analyzer notice are already-known, unrelated baseline conditions — not introduced by this fix.)

## Base branch / commit

Working directory: `main` branch (no branch switch). Base commit at task start: `e6934a9` (per `git log`). No commit was created — per instructions, edits only (not requested to commit).
