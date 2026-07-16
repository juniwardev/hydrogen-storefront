# Plan Review: `ucp-no-auth-mode` (Revision 2 — second pass)

Reviewer: Plan-Reviewer (adversarial)
Date: 2026-07-15
Plan under review: `docs/plans/ucp-no-auth-mode.md` (Revision 2)
Prior review: `APPROVE WITH CHANGES`, three required changes.
Verdict basis: re-read against live `app/lib/mcp.server.js`, `app/routes/($locale).api.assistant.jsx` (`mapMcpError`), `app/lib/const.js`, and `app/lib/mcp.server.test.js`. Every line/section citation below was re-confirmed against the code and the plan body, not taken from the plan's changelog.

---

## Summary

Revision 2 addresses all three required changes substantively, not cosmetically. The observability spec is real, consistent with the existing logging discipline, and makes the previously non-executable §10.6 executable. The hint rewrite leads with the correct remedy for the actual target env and is applied consistently. The AL-2 User-Agent claim is genuinely downgraded to a hypothesis with the codebase counter-evidence cited, and a real probe is added to settle it. No new Anti-Stubbing, hydration, or Analytics violations. The G2 "shim untouched by construction" property and the default-to-`dev-cookie` test-preservation still hold. This clears the bar.

---

## Verification of the three prior required changes

### Required Change 1 — Observability — **RESOLVED**

Evidence:
- The existing asymmetry the change targets is real. `http_error` logs server-side at `mcp.server.js:173` (`[mcp] http_error status=${res.status} tool=${name}`) and `rpc_error` at `:190` (`[mcp] rpc_error tool=${name} code=${data.error?.code}`), each with `// eslint-disable-line no-console`. The `config_error` throws at `:107–112` and `:148–150` (`password_gate_persists_after_remint`) log **nothing** — confirmed. So the "four indistinguishable misconfigurations" problem was genuine.
- `mapMcpError` at `($locale).api.assistant.jsx:339–343` maps every `config_error` to the single string `"The shopping assistant is not configured."` — confirmed. The old §10.6 (verify by browser message) was therefore non-executable.
- §4.1 specifies `console.error(`[mcp] config_error reason=<token> tool=${name}`)` before each throw, in the **same format and same `eslint-disable-line no-console` discipline** as lines 173/190. G4-honored: coarse category + reason token + tool name, no password/cookie/query/payload. Consistent with the existing pattern and the no-secret rule.
- Every reason token is thrown where the plan says: `dev_storefront_password_missing` (dev-cookie branch, relocated guard, §9.2 step 2), `auth_mode_none_but_store_gated` (none-branch 302), `signed_mode_not_implemented` (signed branch), `unknown_auth_mode` (default). No orphan token is specified-but-unthrown. The parity log on the pre-existing `password_gate_persists_after_remint` (`:149`) is a fair consistency add, not scope creep.
- The rewritten §10.6 (step 6) verifies each of the four via the `[mcp] config_error reason=<token>` server log and/or the `detail.reason` unit assertions (new tests 4/7/8/10 in §7b), not the opaque browser string. All four sub-checks now produce a distinct, human-observable signal — genuinely executable.
- Minor wording nit (non-blocking): §4.1 and §10.6 call tests 4/7/8/10 ones that "already assert" `detail.reason`. They are new tests specified in this same plan, not pre-existing — "already" reads oddly but is not wrong (they exist within the plan's own §7b). No action required.

### Required Change 2 — Misleading hint — **RESOLVED**

Evidence:
- The proposed hint (§4, lines 121–124; §9.2 step 2) leads with `Set UCP_AUTH_MODE=none for a public (password-disabled) storefront`, then the dev password, then the Phase-2 signer. For the real target — the **public** `ashford-quantum` store — leading with `none` is the correct primary remedy; the pre-Revision hint's "set a password" would have mis-steered the operator to configure something the store does not need.
- Applied consistently: §3 default rationale (line 100), §4 design + mermaid node E1 (line 132), §5 affected-files row, §6 API-changes bullet (line 204), §9.2 checklist (line 281), §10.6(b) (line 313). I found no lingering spot that still steers the operator to set a password first. The retained `DEV_STOREFRONT_PASSWORD` remedy is now correctly positioned as the secondary (password-gated-store) case.

### Required Change 3 — AL-2 User-Agent claim — **RESOLVED**

Evidence:
- Wording is actually downgraded, not still asserted. §8 risk bullet (line 251): "not confirmed," "hypothesis." AL-2 (line 262): "treat necessity as a hypothesis," "precautionary belt-and-suspenders, not a proven requirement." §4 (line 114) and §4.1 call the UA "precautionary." New AL-7 (line 267) records the open question and a resolution path. No residual "firm requirement / confirmed" language for the cookieless `none` case.
- The cited counter-evidence is real. `mcp.server.js:124–140` builds the dev-cookie MCP POST headers with only `Content-Type` and `Cookie` — **no `User-Agent`** — confirmed, and the module header documents that POST as probe-confirmed 200. So "a UA-less `/api/ucp/mcp` POST always 403s" is correctly treated as unproven for that endpoint. The distinguisher the plan names (the working case carries `_shopify_essential`, the `none` case is cookieless) is stated as inference, which is accurate. Note the `/password`-leg 403 root cause remains genuinely confirmed at `const.js:16–24` — the plan correctly keeps that confirmed while scoping the downgrade to the MCP POST only.
- §10.4a specifies a real probe: run `none` against `ashford-quantum` with the UA (expect 200), then a one-off cookieless POST without the UA (record 200 vs 403), note in impl-notes, resolve AL-7. This is an actual evidence-gathering step, not a gesture.
- AL-7 is a fair statement of the open question, and it is non-blocking for implementation: the code ships **with** the UA regardless of the probe outcome (sending a UA is cheap and harmless); only the *strength of the justification* / the const's JSDoc wording changes. Leaving it open for the probe to settle is acceptable — it is a documentation-strength fork, not a code-behavior fork, so it does not gate `/implement`.

---

## Regression re-confirmation (things validated last pass)

- **Default `dev-cookie` keeps the 23 auth tests green.** The config-gate test at `mcp.server.test.js:73–89` asserts only `err.code === 'config_error'` (line 85) — it does **not** assert `detail.reason` or `detail.hint`. Relocating the guard into the `dev-cookie` branch, rewriting the hint, and adding a log line therefore cannot break it. Confirmed. §7a's "zero edits" requirement holds.
- **`none` never routes through `ensureStorefrontDigest()` (G2 by construction).** `ensureStorefrontDigest`/`invalidateStorefrontDigest` are reachable only inside the `dev-cookie` branch and its 302 retry (`:114`, `:152`). The `none` branch is specified to skip the shim entirely and `ucp-auth.server.js` is not modified. G2 preserved.
- **Option B still honors "never silently skip auth."** Reaching `none` requires an explicit operator declaration; unset defaults to `dev-cookie` (loud gate), unrecognized values throw `unknown_auth_mode`. §3.4/§4.4 invariant intact.
- **Anti-Stubbing / hydration / Analytics.** No new violations. `none` issues a real network POST with the real `meta.ucp-agent.profile` Component Contract (§7b test 5). Module is server-only (no hydration surface). §10.4 keeps the `<Analytics.ProductView>` `variantId` check.
- **Verification gates.** §10 steps 2–3 keep `npm run lint` and `npm run build` (the type-check/production gate; no separate `typecheck`). Present.
- **No new lint risk from the added logging.** The specified `console.error(...); // eslint-disable-line no-console` matches the existing suppressed lines at `:173`/`:190`, so the new lines won't trip the `no-console` rule.

---

## Non-blocking notes (carry into impl-notes; none gate implementation)

- N1 — §4.1/§10.6 phrase the new §7b tests as ones that "already assert" `detail.reason`. They are new within this plan; harmless wording only.
- N2 — Executing §10.6(a) (`auth_mode_none_but_store_gated`) requires a still-gated store to point at; §10.5 already assumes a password-gated store is available for the dev-cookie regression pass, so this is reachable. Worth a one-line reminder in impl-notes that (a) needs the gated store, not `ashford-quantum`.
- N3 — Prior N3 (CLAUDE.md `UCP_AUTH_MODE` env-row deferral) and N4 (`signed`/unknown fail at request-time not boot, per AL-6) are correctly carried into §9.7 impl-notes. No change needed.
- N4 — AL-7's probe result and the UA const's JSDoc-strength decision should be recorded in impl-notes (the plan already asks for this in §9.2 step 7 / §10.4a).

---

Revision 2 folded in all three required changes with evidence, introduced no new blocking issues, and preserved every property validated in the first pass. No required changes remain.

APPROVE
