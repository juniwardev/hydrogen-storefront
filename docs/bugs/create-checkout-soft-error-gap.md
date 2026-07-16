# Bug: `createCheckout()` has the same latent soft-error guard gap as the pre-fix cart tools

**Slug:** `create-checkout-soft-error-gap`
**Reported:** 2026-07-15
**Reported by:** Coder (filed per NB-2, `docs/reviews/fix-ucp-cart-create-flat-shape-review.md`)
**Severity:** Low
**Affected scope:** `app/lib/mcp.server.js` — `createCheckout()`; the rare `create_checkout` fallback path in `app/routes/($locale).api.assistant.jsx` (fires only when a cart's `continue_url` is absent)

## Steps to reproduce

Not reproduced live — this is a latent gap identified by static analysis while
fixing `fix-ucp-cart-create-flat-shape`, not an observed failure. To reproduce
in principle:

1. Reach the `create_checkout` fallback path (route `:184–196`, only fires
   when the preceding cart's response has no usable `continue_url`).
2. Have the UCP `create_checkout` tool return a _soft_ business-outcome
   response: `result.isError === false`, but `structuredContent` carries an
   error `messages[]` and no real checkout fields (no `id`, no
   `continue_url`) — the same shape the fixed `createCart`/`updateCart`
   guard against (see `docs/bugs/ucp-cart-create-flat-shape-investigation.md`
   and `docs/plans/fix-ucp-cart-create-flat-shape.md` §4.2, AL-1).
3. Observe that `createCheckout()` returns `checkout: payload ?? null` — since
   `payload` (the soft-error envelope) is a truthy object, `checkout` is
   returned non-null even though it has no real checkout identity.

## Expected behavior

A soft-error `create_checkout` response should yield `checkout: null`, the
same way the fixed `createCart`/`updateCart` now yield `cart: null` for their
analogous soft-error case — so the route's downstream consumption of
`checkoutResult.checkout` (route `:189–191`) doesn't proceed as if a real
checkout were created.

## Actual behavior

`createCheckout()` (`app/lib/mcp.server.js`, `createCheckout`, `~508–511`)
returns `checkout: payload ?? null`. Because `callTool()` throws
`McpError('empty_result')` on any falsy payload (`mcp.server.js:253–264`),
`payload` on the return path is always a truthy object — either a real
checkout or a soft-error envelope. The bare `?? null` therefore never
actually yields `null`; a soft-error envelope is returned as a truthy "junk"
checkout with `id: undefined` / `continue_url: undefined`, which would flow
into `normalizeCheckout()` and the route's checkout-URL handoff logic as if
it were a real result.

## Hypothesis

Same root defect class as the just-fixed `createCart`/`updateCart` bug: an
unwrap expression (`payload ?? null`) that only distinguishes "no payload at
all" from "a payload," not "a real success payload" from "a soft-error
envelope masquerading as a truthy object." The fix pattern used for
`createCart`/`updateCart` — guarding on an identifying field, e.g.
`payload?.id ? payload : null` — is the likely correct fix here too, pending
confirmation of which field is checkout's true identity discriminator (`id`
is the candidate, mirroring the cart fix).

## Suspected files

- `app/lib/mcp.server.js` — `createCheckout()`, `~504–511`

## Regression risk areas

(To be filled by the Architect during planning, if/when this is picked up.)

## Notes

Deliberately deferred out of `fix-ucp-cart-create-flat-shape` scope (see that
plan's Ambiguity Log AL-2): `createCheckout`'s code works today, no soft-error
has been observed live for checkout, and the checkout call is a rare fallback
only exercised when a cart's `continue_url` is absent. Filed here per the
Plan-Reviewer's NB-2 recommendation so the deferral is tracked as a known
issue rather than left only in an Ambiguity Log entry future readers may not
see.
