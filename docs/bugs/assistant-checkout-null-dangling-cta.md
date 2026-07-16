# Bug: Assistant renders a "checkout here" CTA with no URL when checkout can't be started

**Slug:** assistant-checkout-null-dangling-cta
**Reported:** 2026-07-15
**Reported by:** operator (follow-up from `fix-create-checkout-soft-error-gap` Plan-Reviewer note NB-2)
**Severity:** Low
**Affected scope:** Shopping-assistant checkout handoff — the rare path where a cart exposes no usable `continue_url` AND `create_checkout` yields no usable checkout URL. UX only; no crash, no data issue.

## Steps to reproduce

Not reproduced live — latent UX gap identified during the `fix-create-checkout-soft-error-gap` review, not an observed failure. In principle:

1. Reach the `create_checkout` fallback path (`app/routes/($locale).api.assistant.jsx:184–196`), which fires only when the preceding cart's response has no usable `continue_url` (the `:180` gate).
2. Have `create_checkout` return no usable URL — after the `fix-create-checkout-soft-error-gap` fix, a soft-error checkout correctly yields `checkout: null`, so `checkoutUrl` resolves to `undefined` (route `:193–196`).
3. Observe the assistant reply: it still presents a "checkout here" call-to-action, but with no URL behind it (a dangling CTA).

## Expected behavior

When no usable checkout URL can be produced, the assistant should say something honest like "I couldn't start checkout — please try again" (or degrade gracefully to the product/cart page), rather than rendering a checkout CTA that goes nowhere.

## Actual behavior

The reply renders a checkout CTA with an empty/undefined URL. This is a _lateral_ UX state, not a regression introduced by the checkout guard fix — before that fix, the same path surfaced a bogus (junk) link; after it, the link is cleanly empty. Either way the user gets a dead-end CTA.

## Hypothesis

The assistant's reply-composition treats "has a checkout step" as always render-a-CTA, without a branch for "no usable URL." The fix likely lives in whatever assembles the assistant's checkout-handoff message (route action and/or the component that renders the CTA), adding a no-URL branch that swaps the CTA for a graceful message.

## Suspected files

- `app/routes/($locale).api.assistant.jsx` — checkout-handoff assembly (~180–196).
- Whatever component renders the assistant's checkout CTA from that payload.

## Regression risk areas

(To be filled by the Architect during planning, if/when this is picked up.)

## Notes

Deliberately out of scope for `fix-create-checkout-soft-error-gap` (that fix's job was to stop returning a truthy junk checkout; it correctly returns `null`). Filed so the resulting dead-end-CTA UX is tracked rather than lost in a review note. Low priority — the path is a rare fallback and produces no hard failure.
