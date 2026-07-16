# Implementation notes: `ucp-no-auth-mode` (Revision 2)

Plan: `docs/plans/ucp-no-auth-mode.md` (Revision 2)
Review: `docs/reviews/ucp-no-auth-mode-review.md` — verdict `APPROVE`
Implemented: 2026-07-15

---

## Files changed

- **`app/lib/const.js`** — Added `UCP_AUTH_MODES` (`{NONE, DEV_COOKIE, SIGNED}`), `UCP_DEFAULT_AUTH_MODE` (= `DEV_COOKIE`), and `UCP_CLIENT_USER_AGENT` (a new, separately-named constant from `DEV_SHIM_USER_AGENT`, per AL-2 — the `none` path is not dev-only/shim-mediated, so it gets its own const with its own JSDoc explaining the "precautionary, not proven" status). `DEV_SHIM_USER_AGENT` and everything else in the file is untouched.
- **`app/lib/mcp.server.js`** — `callTool` gains an `authMode` param (default `UCP_DEFAULT_AUTH_MODE`). The old top-of-function `!password` guard (lines 107–112 pre-change) was relocated into an `authMode` switch:
  - `dev-cookie`: same `!password` guard, now with the rewritten hint that leads with `UCP_AUTH_MODE=none`; then `ensureStorefrontDigest()` unchanged.
  - `none`: no shim call, `cookie` stays `undefined`.
  - `signed`: throws `config_error` / `signed_mode_not_implemented` immediately.
  - unrecognized value: throws `config_error` / `unknown_auth_mode` (with `mode` in `detail`, not in the console line — see "Deviations" below).
  - Every one of these four throws (plus the pre-existing `password_gate_persists_after_remint`) is preceded by a `console.error('[mcp] config_error reason=<token> tool=<name>')` line with `// eslint-disable-line no-console`, matching the existing `http_error`/`rpc_error` logging discipline exactly.
  - Request headers are now built conditionally: `Cookie` only in `dev-cookie` mode, `User-Agent: UCP_CLIENT_USER_AGENT` only in `none` mode — no `Cookie: undefined` leak.
  - The 302/301 handler now branches on `authMode`: `none` throws `config_error` / `auth_mode_none_but_store_gated` immediately (no remint, no retry); `dev-cookie` keeps the existing invalidate-and-remint-once retry, now threading `authMode` into the recursive call.
  - `searchCatalog`, `createCart`, `updateCart`, `createCheckout` all gained an `authMode` param + JSDoc, threaded into `callOpts` exactly like `password`/`profileUrl`.
  - Envelope/rate-limit/timeout/tool_error logic is untouched.
- **`app/routes/($locale).api.assistant.jsx`** — Reads `context.env.UCP_AUTH_MODE || UCP_DEFAULT_AUTH_MODE` and adds `authMode` to `mcpBase`. `mapMcpError` is unchanged (generic `config_error` message stays generic — no reason leakage to the browser, per plan §2/§4.1).
- **`app/lib/mcp.server.test.js`** — Added `describe('callTool — auth modes')` with the 10 cases from plan §7b, plus a new `plainFetch` helper (a fetchImpl with zero `/password` handling, used for `none` cases so "the shim was never invoked" is structural, not inferred). Existing 15 cases in this file are byte-unchanged.
- **Not modified** (per plan): `app/lib/ucp-auth.server.js`, `app/lib/ucp-auth.server.test.js`, `app/lib/mcp-normalize.js` / `.test.js`, `app/lib/mcp-error.server.js`, any generated types, `.env`/`.env.local`.

---

## Commands to run the feature locally

```bash
cd ~/Projects/Shopify/hydrogen-storefront
npm run dev
```

Operator env vars (documented here per AL-3/N3 — not written to any env file by the Coder):

| Store type                                         | `UCP_AUTH_MODE`                                     | `DEV_STOREFRONT_PASSWORD`                                                                          |
| :------------------------------------------------- | :-------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| Public, password-disabled (e.g. `ashford-quantum`) | `none`                                              | not needed                                                                                         |
| Password-gated dev store                           | `dev-cookie` (or leave unset — this is the default) | required                                                                                           |
| Unset entirely                                     | defaults to `dev-cookie`                            | required if the store is gated; loud `config_error` (`dev_storefront_password_missing`) if not set |
| Phase-2 signed tier                                | `signed`                                            | n/a — throws `signed_mode_not_implemented` (no implementation exists yet)                          |

`CLAUDE.md`'s required-env-vars table does not yet have a `UCP_AUTH_MODE` row (AL-3/N3, deferred to operator/reviewer per the plan — the Coder does not edit that file). Recording it here so a future agent grounding on `CLAUDE.md` alone still learns the var exists.

---

## Verification gates (actual output)

### 1. `npm run lint`

Clean on all four touched files (`app/lib/const.js`, `app/lib/mcp.server.js`, `app/lib/mcp.server.test.js`, `app/routes/($locale).api.assistant.jsx`) — confirmed via a scoped `npx eslint` pass with zero output.

Full-repo `npm run lint`: **72 problems (72 errors, 0 warnings)** — this matches the pre-existing baseline (the task brief cited "~72 pre-existing baseline errors in untouched files"); no new errors or warnings were introduced. (An early draft of the new `console.error` lines briefly tripped `eslint-comments/no-unused-disable` + prettier line-length — see "Deviations" below for how that was resolved; the final state is clean.)

### 2. `npm run build`

Exit code **0**. Output ends with `✓ built in ~1s` for both the client and SSR bundles. No generated-type diff. A `Bundle analyzer failed to analyze the bundle: TypeError: Invalid URL` message appears in the output — **confirmed pre-existing**: I ran `npm run build` against the unmodified `main` HEAD (via `git stash`) and the identical warning appears there too, unrelated to this change. It does not affect the exit code or the emitted `dist/` artifacts.

### 3. `npm run test:unit`

```
ℹ tests 61
ℹ suites 13
ℹ pass 61
ℹ fail 0
```

- All 8 `ucp-auth.server.test.js` cases: green, file untouched.
- All 15 pre-existing `mcp.server.test.js` cases: green, zero edits (confirms G4 — the `dev-cookie` default reproduces prior behavior exactly, including the config-gate test which only asserts `err.code === 'config_error'`).
- All ~28 `mcp-normalize.test.js` cases: green, file untouched.
- New `describe('callTool — auth modes')` block: **10/10 green** (§7b tests 1–10, verbatim to the plan's numbering).

The test run's stdout also shows the new `[mcp] config_error reason=... tool=...` log lines firing for every expected path (visible test-runner output, not asserted directly per §7b's note that logging is a side-channel).

---

## §10.4a UA probe result

**Deferred to QA**, per the task brief's instruction (AL-7). This requires exercising the live `ashford-quantum.myshopify.com` storefront over HTTP (both with and without the `User-Agent` header on the cookieless `/api/ucp/mcp` POST), which is outside the Coder's unit-test-and-static-verification scope and belongs to QA's manual/browser verification pass (§10.4/§10.4a of the plan). The code ships **with** the UA regardless of the probe outcome (per the plan — this is a documentation-strength question, not a code-behavior fork). QA should record the probe result in their report and, if useful, a follow-up doc note can upgrade/downgrade `UCP_CLIENT_USER_AGENT`'s JSDoc from "precautionary" to "confirmed necessary" (or vice versa) once the probe runs.

---

## Deviations from the plan (with justification)

1. **`unknown_auth_mode` console line omits `mode=${authMode}`; `detail.mode` still carries it.** The plan says the log "may additionally include `mode=${authMode}`" (explicitly optional, marked "may"). Including it inline pushed that particular `console.error` statement's code-only width past this codebase's effective ~80-char line-length convention at its indent level (confirmed empirically: the pre-existing `http_error`/`rpc_error` log lines both have code-only widths of 74–77 chars and are left single-line by Prettier; a version of my line with `mode=` inlined measured 87 chars code-only and Prettier wanted to break it across lines, which in turn desynchronizes the `// eslint-disable-line` comment from the actual `console.error` call and produces an `eslint-comments/no-unused-disable` error). Rather than break the single-line-log convention the plan asks me to match, I kept `mode` in `detail.mode` (the CI-asserted, machine-readable channel — test 8 doesn't require it in the console string) and dropped it only from the printed line. This preserves the mandatory reason-token/tool-name log format and the "no secret values" rule; `mode` (an operator-set env value, not a secret) is still fully available via `detail.mode` for anyone catching the error. No behavior or CI assertion depends on the console string containing `mode=`.
2. **Introduced a local `const reason = '<token>';` before each of the five `config_error`-adjacent throws**, rather than inlining the string literal twice (once in the log, once in `throw new McpError(...)`). This is a light DRY improvement to avoid the log token and the thrown `detail.reason` ever silently drifting apart from a future edit to one but not the other; it does not change the log format, the reason tokens themselves, or any test-visible behavior. Not called out explicitly in the plan, but stays well within "matching the existing pattern" instruction, and every unit test still asserts the exact same reason-token strings the plan specifies.
3. **Reverted `package.json`/`package-lock.json` after every `npm run build` run.** Running `shopify hydrogen build` on this machine auto-updates the pinned `@shopify/cli` version (`^3.74.1` → `^4.5.1`) in both files as a side effect of the installed CLI binary being newer than the pinned range. This is unrelated to the plan and CLAUDE.md explicitly says never to hand-edit `package-lock.json` / let npm manage it, so I `git checkout --`'d both files back to their committed state after each build run rather than letting that drift persist in the diff. Confirmed via `git stash` that this happens identically on an unmodified `main` checkout — pre-existing environment behavior, not something this change caused.

No other deviations. The default (`dev-cookie`), the relocated guard's rewritten hint, the `none`/`signed`/unknown branches, the conditional headers, the mode-branched 302 handling, and the `ucp-auth.server.js`/`ucp-auth.server.test.js`/`mcp-normalize.js`/`mcp-error.server.js` non-modification are all implemented exactly as specified.

---

## Known properties carried forward (per plan §9.7 / AL-6 / N4)

- `signed` and unrecognized `authMode` values fail **at request time** (inside `callTool`), not at server boot — there is no startup-validation harness for `context.env.UCP_AUTH_MODE`, and the plan (AL-6) explicitly accepts this rather than duplicating an enum check in the route.
- The `CLAUDE.md` required-env-vars table does not have a `UCP_AUTH_MODE` row yet (AL-3/N3) — flagged above in "Commands to run the feature locally" rather than silently edited into that shared convention file.

---

## Out-of-scope observations

- None found beyond the pre-existing `npm run build` bundle-analyzer warning and the pre-existing CLI auto-pin-bump behavior, both confirmed unrelated to this change via `git stash` comparison against `main` HEAD.
