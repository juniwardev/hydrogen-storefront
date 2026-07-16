# QA Report: fix-assistant-checkout-null-dangling-cta

**QA date:** 2026-07-15/16
**Slug type:** bug fix (`fix-` prefix)
**Bug report:** `docs/bugs/assistant-checkout-null-dangling-cta.md`
**Investigation:** `docs/bugs/assistant-checkout-null-dangling-cta-investigation.md`
**Plan:** `docs/plans/fix-assistant-checkout-null-dangling-cta.md`
**Impl notes:** `docs/plans/fix-assistant-checkout-null-dangling-cta-impl-notes.md`
**Review:** `docs/reviews/fix-assistant-checkout-null-dangling-cta-review.md` (verdict: APPROVE)

---

## Environment under test

- Dev server: `npm run dev` at `http://localhost:3000` (Hydrogen/MiniOxygen — no storefront password gate per `docs/dev-fixtures.md`, which supersedes the generic playbook's password-gate step for this project).
- `.env` values confirmed by direct read (not disclosed beyond what's needed):
  - `PUBLIC_STORE_DOMAIN=ashford-quantum.myshopify.com`
  - `UCP_AUTH_MODE=none`
  - (`PUBLIC_UCP_AGENT_PROFILE_URL` present, value not needed/disclosed)
- Browser MCP used: **Playwright MCP** for all live checks (navigation, assistant interaction, console/network capture, screenshot). Chrome DevTools MCP was not needed — no network-timing, performance-trace, or complex-debugging surface was required for this fix.
- Test product: `the-complete-snowboard` (out of stock on this store — used only to reach the page and open the assistant panel). Actual add-to-cart exercised via the assistant's own `search` → `add` flow, which surfaced in-stock alternatives (e.g. "The Hidden Snowboard," $749.95). `docs/dev-fixtures.md` has no filled-in product-handle entries yet (only the template); this is the closest available fixture and is sufficient for this fix's scope (assistant reply/link agreement, not product-page-specific rendering).

---

## Mandated bug-fix verdict lines

- **Bug reproduced before fix:** not attempted (reason: the dangling-CTA path fires only when a cart response has no usable `continue_url` **and** the `create_checkout` fallback also yields no usable URL — a rare fallback that is not forceable through the live UI without stubbing `createCheckout`/`normalizeCheckout` internals, which is out of QA's read-only scope. The bug report itself is marked "Not reproduced live." This matches the plan's own test-plan rationale: the primary guard is the unit-test suite on the pure `composeAddReply` helper, not a live repro.)
- **Bug reproduced after fix:** no (the live-reachable healthy path was verified unaffected; the unit tests — which are the primary guard for the unreachable fallback branch — pin the fixed behavior and pass 73/73).

---

## 1. Automated gates (actual output)

### `npm run test:unit` — 73/73 pass, 17 suites, 0 failures

```
▶ composeAddReply — healthy path (checkoutUrl truthy)
  ✔ primary add: reproduces the current copy byte-for-byte
  ✔ stale-cart retry: reproduces the current copy byte-for-byte
▶ composeAddReply — no usable checkout URL (falsy checkoutUrl)
  ✔ primary add, checkoutUrl undefined: graceful fallback, no "checkout here"
  ✔ stale-cart retry, checkoutUrl undefined: graceful fallback, no "checkout here"
  ✔ checkoutUrl null: falls back the same as undefined
  ✔ checkoutUrl empty string: falls back (guards an empty-string URL slipping a CTA through)
...
ℹ tests 73
ℹ suites 17
ℹ pass 73
ℹ fail 0
```

Confirmed the 6 new cases are **not** smoke tests — they assert exact string equality:

- Truthy `checkoutUrl` (primary and `cartReset: true` retry variant) → byte-for-byte match with today's healthy copy (`"Added to your assistant cart — checkout here."` / `"Started a new cart and added the item — checkout here."`).
- Falsy `checkoutUrl` (`undefined`, `null`, `''`) → exact fallback string match **and** `assert.ok(!reply.includes('checkout here'))`. The empty-string case is the sharpest edge case, since `normalizeCheckout`/`normalizeCart` use `?? undefined`, which does not collapse `''` — this case would have failed under the pre-fix hardcoded-string behavior.

### `npm run lint` — clean on touched files

Full run: 72 pre-existing problems, all in untouched files (`($locale).products.$productHandle.jsx`, `($locale).search.jsx`, `sitemap.$type.$page[.xml].jsx`). Grepped explicitly for the touched files:

```
$ npm run lint 2>&1 | grep -i "assistant-reply\|api.assistant"
(no output — zero matches, confirmed clean)
```

### `npm run build` — exit code 0

```
EXIT_CODE=0
✓ 378 modules transformed.
dist/server/index.js   675.40 kB │ map: 2,256.63 kB
✓ built in 1.16s
```

The documented bundle-analyzer "Invalid URL" / `metafile.server.json` ENOENT notice appeared — pre-existing, unrelated, acceptable per task instructions.

### `npm run format:check` — clean on touched files

```
$ npm run format:check 2>&1 | grep -i "assistant-reply\|api.assistant\|package.json"
(no output — zero matches, confirmed clean)
```

---

## 2. Healthy-path live regression (Playwright MCP)

1. Navigated to `http://localhost:3000/products/the-complete-snowboard` → HTTP 200, server-rendered HTML present.
2. Opened the "Shopping Assistant" panel, sent `show me snowboards` (search intent) → "Found 8 products," each with an "Add to cart" button.
3. Clicked "Add to cart" on "The Hidden Snowboard" ($749.95) — this exercises the primary `add`-intent, truthy-`checkoutUrl` return site (route lines ~179–183).
4. **Reply bubble rendered:** `Added to your assistant cart — checkout here.` — byte-for-byte identical to the pre-fix hardcoded copy and to the unit test's healthy-path assertion.
5. **Checkout link rendered:** `Go to checkout →`, `href="https://ashford-quantum.myshopify.com/cart/c/hWNEWzJg8CWtxFGvBpI1vnrc?key=c3c2a86e893867c390793e9a4b00daf8"` — a real, well-formed cart/checkout URL (not a placeholder or empty string).
6. Captured the raw POST response body via Playwright's network inspector:
   ```json
   {
     "reply": "Added to your assistant cart — checkout here.",
     "cart": {
       "id": "gid://shopify/Cart/hWNEWzJg8CWtxFGvBpI1vnrc?key=...",
       "totalAmount": {"amount": "749.95", "currencyCode": "USD"},
       "lineCount": 1,
       "checkoutUrl": "https://ashford-quantum.myshopify.com/cart/c/..."
     }
   }
   ```
   This is direct live confirmation that `reply` and `cart.checkoutUrl` are both present and non-empty in the same payload — the exact invariant the fix establishes.
7. Screenshot: `docs/qa/fix-assistant-checkout-null-dangling-cta-healthy-path.png` — shows the reply bubble and the working "Go to checkout →" link rendered together cleanly, no layout issues.

**Verdict on this section: PASS.** The fix did not alter the healthy-path wording or break the link. Text and link visibly agree.

---

## 3. Text/link agreement (core of the fix)

- **Healthy case (observed live):** reply says "checkout here" AND the link renders with a real URL. Confirmed above (§2). Agreement holds.
- **No-URL case (unit-test-pinned, not live-observed):** the dangling-CTA fallback requires both an absent cart `continue_url` and a soft-error `create_checkout` response — not forceable through the live UI without code-level stubbing, which is outside QA's read-only scope. Per the plan's own test-plan rationale (§7), the **primary guard is the unit-test suite** on the extracted pure `composeAddReply` helper, which asserts (and would have failed pre-fix): when `checkoutUrl` is `undefined`/`null`/`''`, the reply reads the honest fallback copy and does **not** contain "checkout here." This is accepted as sufficient evidence per the task's guidance — the rare fallback path is "hard to force live," and unit-pinning is the documented primary guard, not a fallback QA had to settle for.
- **Retry-variant wording (`cartReset: true`):** not forced live (cartId is held only in React component state, not in any client-observable storage — see `app/components/ChatAssistant.jsx:34`, `useState(null)` — so there is no way to inject a stale cartId from outside the page without modifying app code). Covered by unit test cases 2 and 4, which assert the retry-variant healthy and fallback copy respectively.

---

## 4. Untouched-surface confirmation

```
$ git status --porcelain
 M app/routes/($locale).api.assistant.jsx
 M package.json
?? app/lib/assistant-reply.js
?? app/lib/assistant-reply.test.js
?? docs/bugs/assistant-checkout-null-dangling-cta-investigation.md   (pre-existing doc, not this pass)
?? docs/plans/fix-assistant-checkout-null-dangling-cta-impl-notes.md
?? docs/plans/fix-assistant-checkout-null-dangling-cta.md            (pre-existing doc, not this pass)
?? docs/reviews/fix-assistant-checkout-null-dangling-cta-review.md   (pre-existing doc, not this pass)

$ git diff --stat
 app/routes/($locale).api.assistant.jsx | 27 +++++++++++++++++++--------
 package.json                           |  2 +-
 2 files changed, 20 insertions(+), 9 deletions(-)
```

Confirmed:

- `app/components/ChatAssistant.jsx` is **absent** from the diff — not modified. Its link-gating logic (`{cart.checkoutUrl && (<a>...</a>)}`) is unchanged and still correctly gates the "Go to checkout →" anchor.
- Cart/checkout logic (`createCheckout`, `normalizeCheckout`, `normalizeCart`) is **not** modified — no changes appear in `app/lib/mcp.server.js` or `app/lib/mcp-normalize.js` in the diff.
- Only the two new files (`assistant-reply.js`, `assistant-reply.test.js`), the route, and `package.json`'s `test:unit` script line were touched, matching the plan's affected-files table exactly.

---

## 5. Regression matrix

| Area                                           | Result                                                                                                                                                                                                                                     | Method                                           |
| :--------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------- |
| Healthy checkout path (CTA unchanged)          | PASS — byte-for-byte identical reply, working link                                                                                                                                                                                         | Live (Playwright)                                |
| Normal add-to-cart reply                       | PASS — reads naturally, cart summary (1 item · $749.95) renders correctly                                                                                                                                                                  | Live (Playwright)                                |
| Stale-cart retry variant reply wording         | Unit-pinned only (not live-forceable — cartId held in component state with no external injection point)                                                                                                                                    | Unit test (`assistant-reply.test.js` cases 2, 4) |
| Reply/link agreement                           | PASS (healthy, live) / unit-pinned (no-URL)                                                                                                                                                                                                | Live + unit                                      |
| SSR/hydration clean on assistant surface       | PASS — 0 assistant-related console errors/warnings across page load, panel open, search, and add-to-cart                                                                                                                                   | Live (Playwright console capture)                |
| Analytics.ProductView variantId intact         | Not applicable to this diff — `ChatAssistant.jsx` does not render `Analytics.ProductView` and is untouched by this fix; the product-page usage (`($locale).products.$productHandle.jsx:189`) is outside this diff's surface and unaffected | Static confirmation (grep + diff)                |
| Other intents unaffected (`search`, `default`) | PASS — `search` intent tested live, returned 8 products with no CTA-related text; `composeAddReply` import used only inside the `add` case per code read                                                                                   | Live + static                                    |

---

## Console errors and warnings

One pre-existing, **unrelated** console error observed on every page load of `the-complete-snowboard`:

```
Warning: React does not recognize the `preserveControl` prop on a DOM element...
    at LinkWithRef ... at Link (app/components/Link.jsx:7:5) ... at ProductForm (($locale).products.$productHandle.jsx:199:3)
```

This originates from `ProductForm`'s use of `<Link>` on the product-detail page (unrelated to the assistant, unrelated to this diff — `($locale).products.$productHandle.jsx` is not in the changed-files list and is a documented lint-baseline file with 20 pre-existing lint errors). No new console errors or warnings were introduced by opening the assistant panel, searching, or adding to cart — 0 additional messages appeared across those three interactions.

## Network failures and slow responses

No failed requests observed. Both `/api/assistant` POSTs (search intent, add intent) returned `200 OK`. No slow-response concerns noted — this is a UX/copy fix, not a performance change, so no trace was taken (Chrome DevTools MCP performance panel not needed).

## Accessibility observations

- The assistant panel is a `dialog` with role and an accessible heading ("Shopping Assistant"), a close button, and a labeled textbox ("Message to shopping assistant"). No new accessibility regressions introduced by this fix — it only changes text content of an existing `reply` field and a `checkoutUrl` field already present in the response shape.
- The "Go to checkout →" link has visible, descriptive text and `target="_blank" rel="noopener noreferrer"` (per source read of `ChatAssistant.jsx`, unmodified) — unaffected by this change.

## Performance notes

None applicable — this is a small, synchronous, pure-function copy-composition fix. No trace taken.

## Screenshots

- `docs/qa/fix-assistant-checkout-null-dangling-cta-healthy-path.png` — assistant panel showing the reply bubble ("Added to your assistant cart — checkout here.") and the working "Go to checkout →" link rendered together after a successful add-to-cart.

---

## Nits (non-blocking)

1. **Low severity.** `docs/dev-fixtures.md` has no filled-in product-handle entries yet — only the template. QA had to discover a workable product/flow (assistant search → add) live rather than following a pre-vetted fixture. Not a defect in this fix; a housekeeping gap in the fixtures file worth flagging for a future pass (per the file's own "Known fixture gaps" section, which is currently empty).
2. **Informational.** The stale-cart retry variant's wording (`cartReset: true` branch) could not be exercised live because `cartId` lives only in transient React state (`ChatAssistant.jsx:34`) with no external injection point — this is a testability characteristic of the existing app, not something introduced by this fix, and is fully covered by unit tests 2/4.

---

## Summary

The fix is scoped exactly as planned: a pure `composeAddReply` helper gates the "checkout here" CTA phrase on a single resolved `checkoutUrl` value that also feeds `cart.checkoutUrl`, eliminating the possibility of the reply text and the rendered link disagreeing. All four `add`-intent return sites in the route were rewritten per the plan; `ChatAssistant.jsx` and cart/checkout logic are untouched, confirmed via `git diff --stat`. All four automated gates pass with the exact evidence expected (73/73 unit tests including 6 new byte-for-byte-pinned cases, clean lint/format on touched files, exit-0 build). The live-reachable healthy path was directly observed in a real browser: reply text and checkout link both render and agree, with a real, working checkout URL captured from the raw network response. The unreachable dangling-CTA fallback is proven only by the unit-test suite, which is the documented primary guard for this bug and is accepted as sufficient per the task's explicit framing.

PASS
