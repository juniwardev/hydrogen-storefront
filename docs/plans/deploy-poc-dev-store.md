# Plan: POC deploy to `theme-evolution-os2-hydrogen2` (dev store, GitHub CD)

**Slug:** deploy-poc-dev-store
**Author:** Architect (via coordinating session)
**Status:** RESOLVED — **Option R** chosen (reframe the dev-cookie rule to _store visibility_,
not env name). Project docs updated 2026-08-13 (`CLAUDE.md`/`AGENTS.md` "Deploy targets",
`.claude/agents/devops.md`, `docs/runbooks/store-switch.md` superseded). Remaining work is
**operator execution** of §4 (env vars + first CD deploy).
**Scope:** Make `theme-evolution-os2-hydrogen2.myshopify.com` the **sole** deploy target for
this project, via its **GitHub continuous-deployment** connection, as a **login-gated dev/POC**
storefront. **Retire `ashford-quantum`** as a deploy target.

> **Secrets:** `.env`, `.env.local`, `.env.backup*`, and any storefront password are
> gitignored / never-print. This plan uses variable **names** and the public **domain**
> (`theme-evolution-os2-hydrogen2.myshopify.com`) only. See secret hygiene in §5.

---

## 1. Current facts (confirmed with operator)

- **Target store:** `theme-evolution-os2-hydrogen2.myshopify.com` — a **development store**
  (**Plus** plan _emulated_) with the **storefront password page enabled**. The Plus selection
  only unlocks plan-specific features for testing; the store **type** is development, so the
  governing limits (password can't be removed, no real transactions, no public Oxygen env) still
  apply. (Created new because the original `theme-evolution-os2-hydrogen` was a _client-transfer_
  store whose GitHub integration wouldn't connect.)
- **Possible bonus (unverified):** the agentic-commerce channel blocker is about channel
  availability; a Plus dev store _might_ expose it without the publish/password-off path. Worth a
  one-time probe **after** deploy — but checkout would still be test-gateway + login-gated, and
  search-only is already accepted, so nothing here is designed around it.
- **GitHub CD is connected** in the store admin — this is new for the project and **flips** the
  old "GitHub continuous deployment is intentionally NOT wired" note in `CLAUDE.md`.
- **ashford-quantum is being retired** as a deploy target. This project becomes a
  single-target, dev-store-only POC.

### What a dev store + password-on permanently means (unchanged from prior analysis)

| Capability                                         | Here                                                                                                                 | POC consequence                                |
| :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| Base storefront (home/collections/PDP/native cart) | ✅ Storefront GraphQL token bypasses the password                                                                    | Renders fine                                   |
| Assistant **search** (`/api/mcp`)                  | ✅ only via `dev-cookie` shim (§2)                                                                                   | Works iff the shim ships                       |
| Assistant **cart/checkout**                        | ❌ agentic channel can't provision (needs publish + password-off — impossible on a dev store) + no real transactions | Add-to-cart **degrades gracefully** — expected |
| Public URL                                         | ❌ dev stores have no public environment                                                                             | Deploy URL is login-gated — fine for POC       |

Sources: changelog "Oxygen on development stores" (2026-08-03); dev-store limitations doc
("can't remove the password page", "can't process real transactions").

---

## 2. ⚠️ OPEN DECISION — the DEV-ONLY rule vs the CD env mapping (needs sign-off)

Assistant search needs `UCP_AUTH_MODE=dev-cookie` + `DEV_STOREFRONT_PASSWORD` in the deployed
Oxygen env. With **GitHub CD**, `main` maps to an environment (default: **`production`**), so the
password would live in whatever env `main` deploys — by default one literally named `production`.
Project standards say `DEV_STOREFRONT_PASSWORD` must **never** be in `production`.

**Why the rule's premise no longer holds:** that rule was written when `production` = **ashford**,
a real _public_ storefront the shim must never touch (the intended prod auth is the unbuilt
`signed` tier). With ashford retired, there is **no public production storefront** — the only
deploy is a login-gated dev store that **structurally requires** the shim to function at all.

**Two ways forward:**

- **Option R (RECOMMENDED) — reframe the rule to match its intent.** Change the standard from
  _"never in an env named `production`"_ to _"never use `dev-cookie`/`DEV_STOREFRONT_PASSWORD`
  against a **public** storefront; it is only for password-gated dev/POC stores."_ This preserves
  the actual security intent (never shim a real public store) while allowing the CD default
  `main → production` mapping with `dev-cookie`. Simplest; aligns with CD defaults. Requires
  explicit sign-off because it amends a hard rule.
- **Option K — keep the rule literal.** Remap CD so `main` deploys a **non-`production`**
  environment (e.g. `poc`): set the `poc` env to track `main`, and leave `production` untracked/
  unused. More config friction (and an idle `production` env), but no rule change.

_(Fully-compliant fallback with no shim at all: deploy with the assistant route feature-flagged
off — catalog-only, no search. Operator has chosen a **working assistant**, so this is not the
plan; noted only as the escape hatch.)_

**CHOSEN → Option R** (operator sign-off 2026-08-13). The dev-cookie rule is reframed to
"never against a **public** storefront" (see the reframed rule in `CLAUDE.md` → "## Deploy
targets"); CD's default `main → production` mapping is used with `dev-cookie`. Option K retained
only as a fallback if the reframe is ever withdrawn.

---

## 3. Deploy model: GitHub CD (primary), manual deploy (fallback)

- **Primary:** push to the CD-mapped branch (`main` by default) → Oxygen builds (`npm run build`)
  and deploys automatically. No local link or manual command required.
- **Fallback:** `shopify hydrogen deploy --env <env>` (now known to support `-f/--force` +
  `-t/--token` for headless use — see the corrected `CLAUDE.md`/`devops.md`).
- One Hydrogen storefront per store: `...hydrogen2` has its own storefront + environments,
  entirely separate from the (retired) ashford one.

---

## 4. Steps

1. **Confirm the CD wiring** in the store admin (Hydrogen channel → Storefront settings):
   repo `hydrogen-storefront` is connected; note which **branch → environment** mapping exists
   (default `main → production`). Under **Option K**, change this so `main → poc`.
2. **Set environment variables** on the CD-mapped env. Oxygen auto-provisions this store's
   standard vars (its own `PUBLIC_STORE_DOMAIN`, `PUBLIC_STOREFRONT_API_TOKEN`, `SHOP_ID`,
   `SESSION_SECRET`, etc.). Add the custom + auth vars:
   - `UCP_AUTH_MODE=dev-cookie`
   - `DEV_STOREFRONT_PASSWORD=<this store's storefront password>` ← the §2 shim
   - `PUBLIC_UCP_AGENT_PROFILE_URL=<value>`
   - `PUBLIC_CHECKOUT_DOMAIN=theme-evolution-os2-hydrogen2.myshopify.com`
     Set these via the **dashboard** (Environments → Variables) — no local relink needed. (Or
     `shopify hydrogen link` + `shopify hydrogen env push --env <env>` if you prefer CLI; see the
     secret-hygiene note in §5.)
3. **Trigger the first deploy:** push to the mapped branch (or "Redeploy" in the dashboard).
   Watch the build succeed (it runs `npm run build`, which is green on `main`).
4. **Verify** (§6).

> Oxygen deployments are **immutable** — an env-var change only takes effect on the _next_
> deploy, so set vars before (or re-trigger after) the deploy.

---

## 5. Secret hygiene

- `DEV_STOREFRONT_PASSWORD` and store tokens are secrets. Never commit; never paste values into
  docs/PRs/chat. This plan and the docs reference **names** and the public **domain** only.
- If using `shopify hydrogen env push`, note it **echoes variable values** in its confirmation
  output (the surface that once leaked `SESSION_SECRET` to a transcript) — run it in your own
  terminal, don't paste the output back. Prefer the dashboard for the password var.

---

## 6. Verification (login-gated dev-store URL)

Authenticate to the store, open the deployment URL, then:

1. Homepage + a PDP render; no React hydration warnings in console.
2. Assistant `search_catalog` returns real `...hydrogen2` products.
3. Deploy/runtime log shows **no** `[mcp] config_error reason=<token>` for `dev-cookie`
   (no `dev_storefront_password_missing`, no `auth_mode_none_but_store_gated`).
4. Add-to-cart **degrades gracefully** (expected — cart/checkout blocked on a dev store).

---

## 7. Doc rewrite (execute after the §2 sign-off, one pass)

- `CLAUDE.md` + `AGENTS.md` "Deploy targets" — retarget table/URL/deploy command/env-vars to
  `...hydrogen2`; deploy mechanism → **GitHub CD** (remove "CD intentionally NOT wired");
  `UCP_AUTH_MODE` → `dev-cookie`; apply the §2 rule outcome; mark ashford **retired**.
- `.claude/agents/devops.md` — store/storefront/env/URL; CD-primary + manual-fallback; DEV-ONLY
  handling per §2.
- `docs/runbooks/store-switch.md` — mark **superseded** (single-target now); keep as audit record
  with a header pointing here.
- `docs/qa/oxygen-deploy-target-deploy.md` — leave as-is (historical ashford deploy record).
- If Option K: note the `main → poc` mapping; if Option R: record the amended rule text.

---

## 8. Out of scope / non-goals

- Reviving ashford or making the dev store public / password-off (impossible on a dev store).
- Getting assistant cart/checkout working here (impossible — no agentic channel, no real txns).
- Native TS conversion, GraphQL changes, or app-code changes (config/ops only; the only code
  path that could change is the assistant feature-guard, and only under the compliant fallback,
  which is not the chosen plan).
