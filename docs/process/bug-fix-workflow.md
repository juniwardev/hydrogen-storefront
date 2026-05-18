# Claude Squad — Bug Fix Workflow Reference

Comprehensive reference for using the Claude Squad to investigate and fix bugs in existing codebases. Companion to the feature workflow (plan → review → implement → QA → ship).

This document is self-contained. The right home for it inside a project is `docs/process/bug-fix-workflow.md` or `docs/squad/bug-fix-workflow.md`.

---

## How bug fixes differ from features

Three structural differences shape the workflow:

**Features start with intent; bugs start with observation.** For a feature, you know what you want to build. For a bug, you observe that something's wrong and have to work backwards to what's broken, why, and how to fix it. This adds an investigation phase that features don't need.

**Bug fixes have asymmetric risk.** A feature either works or doesn't — if it doesn't, you iterate. A bug fix that doesn't fully resolve the issue is bad, but a bug fix that introduces a NEW bug elsewhere is worse. Regression risk dominates. The adversarial plan review is even more valuable for bugs than for features because the "obvious fix" is often the wrong fix.

**Bug fixes have narrower scope.** A feature is allowed to touch many files because that's its job. A bug fix should touch the minimum surface needed to resolve the bug. Drive-by cleanups while "in there anyway" are a primary source of regressions.

---

## Prerequisites

Before running the bug-fix workflow, your project must have:

1. **A `## Deploy targets` section in `CLAUDE.md` and `AGENTS.md`.** The DevOps agent refuses to deploy without it. Example:

```markdown
## Deploy targets

- **Development store** (`<store-handle>.myshopify.com`):
  - Live theme: `<theme-id>` (currently the published theme on this dev store)
  - Verification URL: `https://<store-handle>.myshopify.com`
  - Notes: <any project-specific deploy guidance>
```

2. **A `docs/dev-fixtures.md` file** at the project root with the storefront password and test product URLs. QA reads this for browser-based verification. Should be gitignored (contains credentials).

3. **The five squad agents and the `/investigate` command tuned for bug-fix awareness.** Architect, Plan-Reviewer, Coder, QA, and General all have bug-fix-specific sections; DevOps is Shopify-aware. The `/investigate` slash command exists at `~/.claude/commands/investigate.md`.

If any of these are missing, set them up before running the workflow.

---

## The new artifact: bug reports

Every bug fix starts with a bug report at `docs/bugs/<slug>.md`. The operator writes this — either from direct observation or transcribing from a user-submitted report. It captures the bug objectively so the squad can reason about it.

### Bug report template

```markdown
# Bug: <one-line summary>

**Slug:** <short-hyphenated-id>
**Reported:** <YYYY-MM-DD>
**Reported by:** <name or "internal QA">
**Severity:** Critical | High | Medium | Low
**Affected scope:** <where the bug appears — pages, breakpoints, browsers, locales>

## Steps to reproduce

1. Step one
2. Step two
3. ...

## Expected behavior

What should happen.

## Actual behavior

What does happen. Include screenshots/screen recordings if visual.

## Hypothesis (optional)

If you suspect a cause, note it. Don't lock the investigation into your hypothesis — it's a starting point, not a constraint.

## Suspected files

If you know which files are involved, list them. Helps the investigator focus.

## Regression risk areas

(Filled in by the Architect during planning. What else does this code path affect?)
```

The severity field drives workflow tier selection.

---

## The four workflow tiers

Pick the tier based on bug shape, not blind adherence to process.

### Tier 1 — Trivial bug

One-line fix. No architectural decision. No regression risk.

**Examples:** typo in copy, wrong color hex, broken link, missing translation key.

**Workflow:**

```
1. Write bug report.
2. /implement docs/bugs/<slug>.md — Coder fixes directly, no plan needed.
3. /qa fix-<slug> — verify the fix doesn't break related functionality.
4. touch docs/qa/fix-<slug>.approved
5. /ship fix-<slug>
6. Commit the deploy note DevOps writes.
```

Total time: 15-30 minutes.

### Tier 2 — Standard bug

Medium complexity. Affects a single component. Identifiable regression risk.

**Examples:** cart drawer overflow on mobile, dropdown doesn't close on outside click, form validation message wrong in non-default locale.

**Workflow:**

```
1. Write bug report.
2. /plan fix-<slug> per docs/bugs/<slug>.md
3. /review-plan docs/plans/fix-<slug>.md
4. (Iterate plan if APPROVE WITH CHANGES)
5. /implement docs/plans/fix-<slug>.md
6. /qa fix-<slug>
7. (If QA fails, back to /implement)
8. touch docs/qa/fix-<slug>.approved
9. /ship fix-<slug>
```

The most common tier. Identical pipeline to features.

### Tier 3 — Complex or mysterious bug

Multiple files affected, architectural implications, OR root cause is unclear. Investigation phase comes first.

**Examples:** sporadic checkout failures, performance regression on collection pages, theme renders correctly on Chrome but breaks on Safari iOS.

**Workflow:**

```
1. Write bug report (root cause field left blank — that's what investigation produces).
2. /investigate <slug> — General agent diagnoses, writes docs/bugs/<slug>-investigation.md
3. /plan fix-<slug> per investigation findings
4. /review-plan docs/plans/fix-<slug>.md
5. (Iterate)
6. /implement docs/plans/fix-<slug>.md
7. /qa fix-<slug> with extra regression coverage
8. touch docs/qa/fix-<slug>.approved
9. /ship fix-<slug>
```

The investigation artifact becomes input to the plan. The Architect reads it during planning; the Plan-Reviewer cross-checks the proposed fix against it.

### Tier 4 — Hotfix

Production is broken. You don't have time for adversarial review.

**Workflow:**

```
1. Quick fix via Coder (or manually).
2. Manual deploy (bypass /ship for speed).
3. Verify storefront recovered.
4. THEN write bug report, investigation, postmortem, and deploy note.
```

The retroactive audit trail is non-negotiable but it happens after stabilization. Consider building a dedicated `/hotfix <slug>` command later that codifies this fast path.

---

## The `/investigate` slash command

Lives at `~/.claude/commands/investigate.md`:

```markdown
---
description: Diagnose a documented bug to find root cause before planning a fix.
argument-hint: <slug>
---

Use the `general` subagent to investigate the bug documented at `docs/bugs/$ARGUMENTS.md`.

Confirm before invoking:
1. The bug report file exists. If not, refuse and ask me to create one first.
2. The bug report has filled-in "Steps to reproduce" and "Actual behavior" sections. If either is empty, refuse — there's nothing to investigate yet.

The General agent should:

1. Read the bug report.
2. Reproduce the bug if possible (run the steps, observe the behavior).
3. Search the codebase for relevant files using Grep/Glob.
4. Trace through the code to identify root cause.
5. Write findings to `docs/bugs/$ARGUMENTS-investigation.md` including:
   - Root cause statement (with code references — file:line)
   - Why the bug occurs (the mechanism in plain language)
   - Suggested fix approach (high level — Architect will detail in planning)
   - Regression risk areas (what else in the codebase uses this code path)

Do not propose a specific fix or modify any code. The investigation feeds into the Architect's plan, which is where the actual fix gets designed and reviewed.

After completion, print:
- Path to the investigation document
- The root cause statement
- Recommendation: proceed to /plan or do more investigation
```

---

## Investigation document structure

The General agent writes `docs/bugs/<slug>-investigation.md` with these sections (the agent's prompt enforces this):

```markdown
# <slug> — Investigation

## Root cause

One paragraph statement with code references (file:line).

## Mechanism

How the bug manifests — the chain of cause and effect, in plain language.

## Suggested fix approach

High level only. The Architect details the actual fix during planning.

## Regression risk areas

Other code paths that touch the same files, functions, or styling rules. The Architect uses this to fill the bug report's "Regression risk areas" section, which QA then uses for regression testing.
```

The investigation is read-only intelligence — it does NOT propose a specific fix. That's the Architect's job during planning. Keeping investigation and planning as separate steps means the adversarial review (Plan-Reviewer) can critique the fix approach without being primed by the investigator's instinct.

---

## Agent behaviors during bug fix workflow

All five squad agents have bug-fix-specific behaviors codified in their prompts (`~/.claude/agents/<agent>.md`). DevOps doesn't change — deploys are deploys.

### Architect — when planning bug fixes

- Begins with a root cause statement, not just a proposed change.
- Uses `docs/bugs/<slug>-investigation.md` as the root cause source if it exists; cites it in the plan.
- Identifies regression risk areas and fills the bug report's "Regression risk areas" section.
- Constrains scope ruthlessly — bug fix plans propose the minimum change needed.
- Specifies how the fix will be verified.
- Plan slug always starts with `fix-`.

### Plan-Reviewer — when reviewing bug fix plans

- Asks: does the fix address the root cause or just the symptom?
- Watches for scope creep on files unnecessary to the fix.
- Demands explicit regression test cases.
- Demands explicit reproduction-confirmation checks.
- Cross-checks the proposed fix against `docs/bugs/<slug>-investigation.md`. Disagreement is a red flag.

### Coder — when implementing bug fixes

- Applies only the changes specified in the plan. No drive-by cleanups.
- Uses commit message format: `fix(<area>): <description> (fixes <slug>)`.
- Stops and reports if the proposed fix doesn't work or causes new problems — does not improvise.
- Writes a "Bug fix verification approach" section in `docs/plans/<slug>-impl-notes.md` describing how to confirm the bug is resolved.

### QA — when verifying bug fixes

- Reads the bug report at `docs/bugs/<slug>.md` (slug after the `fix-` prefix).
- Reproduces the bug first if feasible against the pre-fix state.
- Verifies the fix by re-running the reproduction steps.
- Runs regression checks against everything in the bug report's "Regression risk areas" section.
- Report must include two explicit verdict lines:
  - `Bug reproduced before fix: yes | no | not attempted (with reason)`
  - `Bug reproduced after fix: yes | no`
- If "after fix" is `yes`, verdict is `FAIL` regardless of other findings.

### General — when investigating bugs

Invoked via `/investigate <slug>`. Follows the procedure documented in the investigate command spec above. Writes to `docs/bugs/<slug>-investigation.md`. Does NOT propose specific fixes or modify code.

### DevOps — same for bugs and features

Reads `docs/qa/fix-<slug>.approved` to confirm operator sign-off. Captures pre-deploy snapshot. Pushes via `shopify theme push --theme=<id> --nodelete`. Verifies storefront. Writes deploy note. Rolls back on failure.

---

## File layout convention

```
docs/
├── bugs/
│   ├── <slug>.md                              ← bug report (operator writes)
│   └── <slug>-investigation.md                ← optional, Tier 3 bugs (General writes)
├── plans/
│   ├── fix-<slug>.md                          ← fix plan (Architect writes)
│   └── fix-<slug>-impl-notes.md               ← implementation notes (Coder writes)
├── reviews/
│   └── fix-<slug>-review.md                   ← review (Plan-Reviewer writes)
├── qa/
│   ├── fix-<slug>-report.md                   ← QA report
│   ├── fix-<slug>.approved                    ← operator sign-off
│   └── fix-<slug>-deploy.md                   ← deploy note (DevOps writes)
```

The `fix-` prefix on plan/review/qa/deploy slugs makes the audit trail self-documenting. Six months from now, `git log --grep "^fix("` shows only bug fixes; `git log --grep "^feat("` shows only features.

---

## Walkthrough: a hypothetical Tier 3 bug

Suppose the Material Spotlight rating bars are visible on Chrome desktop but missing on Safari iOS.

**Step 1 — Write the bug report:**

```bash
cat > docs/bugs/material-spotlight-rating-bars-safari-ios.md <<'EOF'
# Bug: Material Spotlight rating bars missing on Safari iOS

**Slug:** material-spotlight-rating-bars-safari-ios
**Reported:** 2026-05-18
**Reported by:** Junior Warner (internal QA)
**Severity:** Medium
**Affected scope:** Material Spotlight section, Safari iOS only

## Steps to reproduce

1. Open <product URL> on Safari iOS
2. Scroll to the Material Spotlight section
3. Observe the sustainability rating bars

## Expected behavior

Five rating bars visible: four filled, one empty. Same as Chrome desktop.

## Actual behavior

No bars visible. Label and "4 / 5" score render correctly, but bars are gone.

## Hypothesis

Possibly a Safari-specific CSS issue with `display: flex` on `<span>` elements, or pseudo-element rendering difference.

## Suspected files

- `snippets/sustainability-rating.liquid`

## Regression risk areas

(To be filled by Architect during planning)
EOF
```

**Step 2 — Investigate (root cause unclear, so Tier 3):**

```
/investigate material-spotlight-rating-bars-safari-ios
```

General agent reads the bug report, reproduces in Safari iOS via Playwright, examines `snippets/sustainability-rating.liquid`, and writes `docs/bugs/material-spotlight-rating-bars-safari-ios-investigation.md` with root cause and code references.

**Step 3 — Plan the fix:**

```
/plan fix-material-spotlight-rating-bars-safari-ios per docs/bugs/material-spotlight-rating-bars-safari-ios-investigation.md
```

Architect writes the fix plan, citing the investigation's root cause, filling the bug report's "Regression risk areas" section, and specifying verification approach.

**Step 4 — Review:**

```
/review-plan docs/plans/fix-material-spotlight-rating-bars-safari-ios.md
```

Plan-Reviewer cross-checks the proposed fix against the investigation. Iterate to APPROVE.

**Step 5 — Implement:**

```
/implement docs/plans/fix-material-spotlight-rating-bars-safari-ios.md
```

Coder applies the minimum change, uses commit message `fix(material-spotlight): <description> (fixes material-spotlight-rating-bars-safari-ios)`, writes verification approach to impl-notes.

**Step 6 — QA:**

```
/qa fix-material-spotlight-rating-bars-safari-ios
```

QA agent reproduces the bug on Safari iOS, applies the fix in browser context, verifies the fix, regression-tests the regression risk areas. Report includes the two mandatory verdict lines and final `PASS` verdict.

**Step 7 — Approve and ship:**

```bash
touch docs/qa/fix-material-spotlight-rating-bars-safari-ios.approved
```

```
/ship fix-material-spotlight-rating-bars-safari-ios
```

DevOps captures pre-deploy snapshot, pushes to target theme, verifies storefront, writes deploy note at `docs/qa/fix-material-spotlight-rating-bars-safari-ios-deploy.md`, commits.

**Step 8 — `git push`** to share the audit trail.

---

## Quick reference cheat sheet

| Bug Type | Tier | Process |
|---|---|---|
| Typo, color, link | 1 | Report → /implement → /qa → /ship |
| Component-level bug | 2 | Report → /plan → /review-plan → /implement → /qa → /ship |
| Mystery / complex | 3 | Report → /investigate → /plan → /review-plan → /implement → /qa → /ship |
| Production-down emergency | 4 | Quick fix → manual deploy → write retrospective artifacts |

**Slash commands used:**

- `/investigate <slug>` — diagnose (Tier 3 only). Invokes General agent.
- `/plan fix-<slug>` — plan the fix. Invokes Architect.
- `/review-plan docs/plans/fix-<slug>.md` — adversarial review. Invokes Plan-Reviewer.
- `/implement docs/plans/fix-<slug>.md` — apply the fix. Invokes Coder.
- `/qa fix-<slug>` — verify with regression coverage. Invokes QA.
- `/ship fix-<slug>` — deploy via DevOps with snapshot rollback.

**Two manual operator actions:**

- `touch docs/qa/fix-<slug>.approved` — operator sign-off gate between QA and DevOps.
- `git push` — share artifacts to remote after ship completes.

---

## What's already in place (for theme-evolution-os2)

Following the Material Spotlight feature and subsequent agent updates:

- ✅ All five squad agents tuned for bug-fix awareness (Architect, Plan-Reviewer, Coder, QA, General)
- ✅ DevOps agent Shopify-aware (snapshot-based rollback, declared deploy targets)
- ✅ `/investigate` command exists at `~/.claude/commands/investigate.md`
- ✅ CLAUDE.md and AGENTS.md have `## Deploy targets` section
- ✅ `docs/dev-fixtures.md` set up for QA browser tests
- ✅ Manual deploy procedure documented as fallback for Tier 4 hotfixes

## Optional improvements to consider

These are low-priority and only worth doing if the squad surfaces a specific need:

- **`/hotfix <slug>` command** for Tier 4 emergencies, codifying the fast path with forced retroactive audit trail.
- **`/bug-report <slug>` command** that scaffolds a bug report template — useful if you're writing many bug reports manually.
- **Symlink CLAUDE.md ↔ AGENTS.md** so they can't drift. Currently manual diff verification.
- **Postmortem template** for QA agents to use when investigating a `FAIL` verdict's root cause before bouncing back to Coder.

Don't pre-build any of these. Let the squad's friction tell you which one matters first.
