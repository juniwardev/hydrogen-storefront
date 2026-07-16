## 2026-05-18 — Two squad-driven bug fixes shipped on Hydrogen

Both fixes ran through the full plan → review → implement → QA → operator approval workflow, with audit trails committed to main.

1. **fix-codegen-selectedoptions-not-defined** — added `$selectedOptions: [SelectedOptionInput!]!` to PRODUCT_QUERY operation. Surfaced during `npm run dev` codegen.
2. **fix-variant-clicks-return-404** — changed Remix `<Link to={...}>` from string to `{search: ...}` object form. Surfaced as a QA finding during the codegen fix.

Notable patterns from this session:

- Agent-drafted bug reports work (variant-clicks bug report was General-drafted from prior QA findings + operator review).
- QA agent's regression checks go beyond what's required when the prior fix exposes more state to verify.
- Coder agent gap repeated: did not auto-commit on either Hydrogen bug fix despite the global Coder prompt requiring it. Worth investigating before the next Hydrogen bug.
- The squad's adversarial Plan-Reviewer continues to catch real issues on first pass (5 minors on codegen fix, similar density on variant fix).

Time per fix: ~30-45 minutes of agent time + operator interaction. Notably faster than Material Spotlight (days). Compound interest from infrastructure investment is now obvious.

## 2026-05-18 — Site footer feature shipped on Hydrogen

Third squad-driven shipment on Hydrogen in two days:

1. fix-codegen-selectedoptions-not-defined (bug)
2. fix-variant-clicks-return-404 (bug, agent-drafted report)
3. add-site-footer (feature, planned via smoke test, implemented after bug fixes)

The footer ran through:

- /plan (smoke test of CLAUDE.md corrections, four review iterations)
- /implement (later, after bug fixes — Architect's plan stood up against the
  intervening codebase changes)
- /qa (29 minutes, PASS WITH NITS)

Notable:

- Plan made earlier in session executed cleanly after time delay — the
  audit trail's value is that plans can wait without rotting (the codebase
  changed in the meantime but the plan's structural decisions held).
- Coder auto-commit gap recurred (third consecutive Hydrogen shipment).
  Filed as a real pattern in squad-improvements.md.
- QA caught both nits clearly (placeholder URLs are operator-actionable,
  pre-existing Remix 500 behavior is acceptable).

Three shipments in two days demonstrates the squad workflow is now
operational on both projects with meaningful throughput.
