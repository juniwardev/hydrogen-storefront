# Plan Review: `fix-create-checkout-soft-error-gap`

**Reviewer:** Plan-Reviewer (adversarial pass)
**Date:** 2026-07-15
**Plan under review:** `docs/plans/fix-create-checkout-soft-error-gap.md`
**Investigation:** `docs/bugs/create-checkout-soft-error-gap-investigation.md`
**Stub:** `docs/bugs/create-checkout-soft-error-gap.md`
**Sibling (approved) fix:** `fix-ucp-cart-create-flat-shape`

I did not write this plan and treated its citations as unverified. I read the real
code and confirmed every line reference before settling the two questions that
actually matter for this fix.

---

## Citation verification (all confirmed against the real code)

| Plan claim                                                                                   | Real code                                                                     | Verdict |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| `createCheckout` returns `checkout: payload ?? null` at ~520                                 | `app/lib/mcp.server.js:520` — exact                                           | ✓       |
| `messages: payload?.messages ?? []` at :521 (no change needed)                               | `mcp.server.js:521` — exact                                                   | ✓       |
| Comment at :515–518 describes flat shape, says nothing about soft-error                      | `mcp.server.js:515–518` — exact                                               | ✓       |
| `callTool` throws `empty_result` on falsy payload                                            | `mcp.server.js:246–248` and `:262–264`                                        | ✓       |
| `callTool` throws `tool_error` on `result.isError`                                           | `mcp.server.js:267–271`                                                       | ✓       |
| `createCart`/`updateCart` already use `payload?.id ? payload : null`                         | `mcp.server.js:450–453`                                                       | ✓       |
| Route gates on `if (checkoutResult.checkout)` at :189–191                                    | `($locale).api.assistant.jsx:189–191`                                         | ✓       |
| `normalizeCheckout` keys on `rawCheckout.id`                                                 | `mcp-normalize.js:240` (`id`), `:241` (`continue_url`)                        | ✓       |
| Harness `plainFetch`/`withPasswordShim`/`BASE_OPTS`/`UCP_AUTH_MODES`/`__resetForTests` exist | test file lines 44, 76, 83, 27, 29 (module scope)                             | ✓       |
| `successFetch` is scoped INSIDE the cart `describe` (not reusable)                           | `mcp.server.test.js:742` — confirmed local                                    | ✓       |
| Import line 28 lacks `createCheckout`; zero coverage today                                   | `mcp.server.test.js:28` — `{callTool, createCart, updateCart, McpError}` only | ✓       |

The plan's self-awareness that `successFetch` is block-scoped and must be
re-declared (or `plainFetch` reused) in the new block is correct and is the kind
of detail that usually gets missed. Credit where due.

---

## The two load-bearing questions — settled firmly

### (a) Is `id` the correct discriminator? YES.

`normalizeCheckout` (`mcp-normalize.js:238–243`) structurally reads
`rawCheckout.id` to build its `id` field. A payload without `id` is _definitionally_
useless downstream — it would produce `{id: undefined, checkoutUrl: <fallback>}`.
Guarding on `id` is therefore self-consistent with the existing normalize contract,
not an arbitrary choice: any payload the guard rejects is a payload `normalizeCheckout`
could never have turned into a real checkout anyway. It also mirrors the already-approved
cart guard exactly. The investigation's live probe confirms the soft-error envelope's
top-level keys are `["continue_url","messages","ucp"]` with no `id`, and AL-4 correctly
rejects `continue_url` as a discriminator (the soft-error envelope carries a fallback
`continue_url` too). `payload?.id ? payload : null` is right. No failure mode survives
scrutiny: the only theoretical case that breaks it — a _real_ checkout success with no
`id` — is already broken in `normalizeCheckout` today, so filtering it to `null` is
strictly correct rather than a regression.

### (b) Is `checkout: null` genuinely safe in the route? YES — traced end to end.

This is the one real difference from the cart fix, so I traced it rather than trusting
the plan.

1. `($locale).api.assistant.jsx:180` — reaching the `createCheckout` fallback at :184
   _requires_ `cart.checkoutUrl` to have been falsy (the truthy branch returns at :181).
2. `:189–191` — with `checkoutResult.checkout === null`, the ternary short-circuits;
   `normalizeCheckout` is **not** called, so no `{id: undefined}` object is produced.
   `checkout = null`. No crash.
3. `:193–196` — `cart: {...cart, checkoutUrl: checkout?.checkoutUrl}` → optional chaining
   yields `undefined`. Because `cart.checkoutUrl` was **already falsy** at this point,
   overwriting it with `undefined` preserves the status quo — nothing is lost. The
   response serializes cleanly.

`null` cleanly no-ops. The route needs no change; AL-3's decision to keep the route
untouched is correct. The client already has to tolerate a cart with no `checkoutUrl`
(that is precisely the condition that triggers this fallback), so `undefined` is a
pre-existing, handled state — not a new one.

---

## Bug-fix lenses

- **Root cause vs symptom:** Root cause. The guard converts an id-less soft-error
  envelope into `null` so the route's _existing_ null branch fires — it does not paper
  over a symptom. Matches the investigation's documented root cause exactly.
- **Scope minimality:** Minimal and correct. Only the `checkout:` expression on
  `mcp.server.js:520` plus an augmented comment, plus the test file. No cart change, no
  route change, no normalize change, no nesting change (checkout is already flat — the
  plan correctly distinguishes this from the cart bug's dual defect). No scope creep.
- **Regression coverage:** Adequate. Case 2 pins the latent bug — the fixture matches the
  real captured soft-error shape and is served with `isError:false` to force the exact
  hypothetical the live server never produced on demand. Verified case 2 fails against the
  current `payload ?? null` (truthy envelope returned) and passes after `payload?.id`.
  The plan honestly concedes case 1 passes pre-fix (checkout was already flat) and is a
  contract guard, not the pin.
- **Reproduction confirmation:** Honestly handled. §9 step 4 and AL-2 correctly state a
  live `isError:false` soft-error is not reproducible on demand (all probes returned
  `isError:true`, which throws before the return path), so the unit test is the primary
  guard. The before/after "prove the pin" instruction (run `test:unit` before applying
  §4.1 to confirm case 2 fails) is the right substitute for a live repro.
- **Investigation alignment:** The plan matches the investigation. No disagreement.

## Standards compliance

- Anti-Stubbing: satisfied — the guard corrects real behavior, does not suppress a
  Type/ReferenceError or stub empty data.
- No `.tsx` conversion, no `.env` edits, no hand-editing generated types. §6 correctly
  notes no GraphQL change → no codegen.
- Verification (§9) includes `npm run lint`, `npm run build`, and `npm run test:unit`
  with the before/after pin. Complete.

---

## Non-blocking notes (advisory — do NOT gate implementation)

1. **Empirical overstatement in §4.1 justification and AL-4.** The prose says the "live
   capture shows a real checkout **success** always carries top-level `id`." Per the
   investigation (lines 15–24), **both** probed cases returned `isError:true` (error
   cases that happened to carry `id`); a genuine `isError:false` success was never
   captured. The discriminator is still correct — it rests on `normalizeCheckout`'s
   structural dependence on `id`, not on the probe — so this changes nothing about the
   fix. But the wording claims more empirical grounding than exists. Preferred phrasing:
   "id was present in every probed checkout response (all isError:true); the guard is
   self-consistent because normalizeCheckout requires id." Note: the _code comment_ the
   Coder is told to write (§4.1 "After") attributes "PROBED live" only to the soft-error
   envelope keys — which IS accurate — so nothing inaccurate ships in code. This nit is
   confined to plan prose.

2. **§8.3 "strict improvement" is slightly overstated.** On the `null` path the reply
   copy is still `'Added to your assistant cart — checkout here.'` while `checkoutUrl`
   becomes `undefined` — a dangling "checkout here" with no link. Pre-fix, the user got a
   bogus link to the store homepage. Both are degraded; post-fix is a lateral move or mild
   improvement (no misleading homepage-as-checkout link), **not strictly better in every
   framing**. Critically, it introduces **no new hard failure** — no crash, no worse
   breakage — and the dangling-CTA condition is pre-existing in spirit (the homepage link
   was equally not-a-checkout). Out of scope for this minimal fix, but QA should be told
   the null path yields a reply that references checkout with no URL, so it is not mistaken
   for a regression this fix introduced.

Neither note requires a code change or blocks the Coder. The fix is correct, minimal,
well-tested, and safe in the route as written.

APPROVE
