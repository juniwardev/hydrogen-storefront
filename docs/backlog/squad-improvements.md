
## QA agent: prefer relative paths in shell commands

**Discovered during:** fix-variant-clicks-return-404 QA run.

**Symptom:** QA agent's Bash command log shows fully qualified paths like `cp /tmp/qa-foo.png /Users/juniorwarner/Projects/Shopify/hydrogen-storefront/docs/qa/foo.png`. Verbose, leaks workspace structure.

**Fix:** Add a bullet to `~/.claude/agents/qa.md` under `## Bash command style` instructing the agent to prefer relative paths for destinations under the project tree.

**Severity:** Low (cosmetic + minor privacy).

**Apply when:** Between QA runs. Mid-cycle agent prompt edits don't affect the running session.

## Coder agent's missing auto-commits on Hydrogen project

**Pattern observed (3 consecutive Hydrogen shipments):**
- fix-codegen-selectedoptions-not-defined — Coder did not commit code
- fix-variant-clicks-return-404 — Coder did not commit code
- add-site-footer — Coder did not commit code

**Expected behavior:** Per ~/.claude/agents/coder.md, "Make small, reviewable
commits with clear messages." Should produce per-meaningful-change commits
during implementation.

**Observation:** This pattern does NOT appear to occur on the
theme-evolution-os2 (Liquid) project, where Coder DID auto-commit during
the bug-fix workflow. Both projects use the same global Coder agent file.

**Hypotheses:**
- Project-specific context interaction (something about Hydrogen's per-file
  scope makes Coder less commit-prone).
- Tools availability difference (Bash tool behavior, or git config inside the
  agent's sandbox).
- The Coder is bundling all changes into one mental "task" and the impl-notes
  write-up is closing the session before a commit step fires.

**Severity:** Medium (operator workaround works but breaks workflow contract).

**Likely next step:** Strengthen the Coder prompt with "MUST commit before
declaring done; verify with git log" language. Or investigate Hydrogen-
specific behavior via /investigate.
