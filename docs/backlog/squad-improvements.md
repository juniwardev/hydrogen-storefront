
## QA agent: prefer relative paths in shell commands

**Discovered during:** fix-variant-clicks-return-404 QA run.

**Symptom:** QA agent's Bash command log shows fully qualified paths like `cp /tmp/qa-foo.png /Users/juniorwarner/Projects/Shopify/hydrogen-storefront/docs/qa/foo.png`. Verbose, leaks workspace structure.

**Fix:** Add a bullet to `~/.claude/agents/qa.md` under `## Bash command style` instructing the agent to prefer relative paths for destinations under the project tree.

**Severity:** Low (cosmetic + minor privacy).

**Apply when:** Between QA runs. Mid-cycle agent prompt edits don't affect the running session.
