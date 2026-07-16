# Post mcp-shopping-assistant backlog

This file captures follow-up work items identified during and after the `mcp-shopping-assistant` build (June 2026). Each item should be promoted to a feature plan in `docs/plans/` when it becomes the active work. This is a governance document documenting the scope and sequencing of future work — **not a feature plan itself**.

## Recommended sequence

The four items below are prioritized by both dependency and cost-benefit:

1. **Workflow improvement first** (item a) — lowest cost, immediate benefit on every future build. Prevents sequential validator whack-a-mole patterns.
2. **Then deployment infrastructure** (item b) — enables shipping anything from this project to production rather than terminating at QA + sign-off.
3. **Then UCP migration** (item c) — benefits from both prior items being in place; unblocks the Spring '26 catalog response format.
4. **Then platform upgrades** (item d) — substantial migration that can be scheduled when other work has slowed; no hard dependencies but better to ship known-good features first before undertaking large version migrations.

---

## a. Workflow: Add Component Contract enumeration rule to Architect and Plan-Reviewer agents

**Title:** Require component contract enumeration in plans — prevent sequential validator failures.

**Why it matters:** The QA rounds 1–3 of the mcp-shopping-assistant build surfaced a sequential-validator whack-a-mole pattern where Hydrogen's `<Analytics.ProductView>` component validation failed one field at a time across three separate QA rounds (ItemView, then vendor, then variantTitle). Capturing the full contract upfront prevents this rework.

**Dependencies:** None.

**Surfacing context:** QA rounds 1, 2, 3 of the mcp-shopping-assistant build; the QA agent identified that Hydrogen's validator runs sequential `if (!product.X)` checks and stops at the first failure. Plans written without explicit contract enumeration trigger this pattern repeatedly.

**Scope notes:** Not a feature plan. The work is a one-time update to two agent prompts:

- `~/.claude/agents/architect.md` — add a requirement that every plan enumerate full component contracts (required props, payload fields, validation rules) for all Hydrogen components, MCP tools, or platform APIs it references.
- `~/.claude/agents/plan-reviewer.md` — add a verification step to check the enumeration against the Dev MCP tooling before signing off.

This is workflow infrastructure, not code.

**Estimated effort:** Small (30 min agent prompt edits; immediate benefit on the next feature).

---

## b. Infrastructure: Set up AWS deployment for hydrogen-storefront and wire up the DevOps agent

**Title:** Deploy hydrogen-storefront to AWS and make `/ship` operational.

**Why it matters:** Once `/ship` is operational, future features can be deployed to production rather than terminating at QA + sign-off. The current workflow stops at `touch docs/qa/<slug>.approved`; DevOps/deployment is not configured.

**Dependencies:** None (AWS account access is already in place per operator).

**Surfacing context:** The project `CLAUDE.md` "Deploy targets" section notes no production deploy target is configured. The `/ship` slash command is non-operational by design (see `.claude/agents/devops.md` refusal condition). This was observed during the final stages of the mcp-shopping-assistant build when attempting to verify `/ship` readiness.

**Scope notes:** Not a feature plan. The work includes:

- Deciding on the AWS service (likely ECS, App Runner, Lambda, or Amplify depending on Hydrogen's runtime requirements and operator preference).
- Configuring CI/CD (GitHub Actions or equivalent).
- Documenting the deployment procedure.
- Creating or updating `.claude/agents/devops.md` (project-scoped) with AWS-specific deploy/verify/rollback steps.
- Adding a "Deploy targets" section to the project `CLAUDE.md` per the squad workflow convention, documenting the chosen service, deploy command, and verification URL.

**Trade-off note (include in scope):** Hydrogen is traditionally deployed to Shopify's Oxygen platform. Deploying to AWS is a deliberate decision with trade-offs worth documenting: cold start behavior may differ from edge runtimes, CDN configuration will be custom rather than Shopify-managed, and infrastructure cost vs flexibility will be different. Document the rationale alongside the setup.

**Estimated effort:** Medium to large (1–2 sessions depending on AWS familiarity and CI/CD tooling choice).

---

## c. Feature: Remove dev store storefront password and migrate hydrogen-storefront to UCP

**Title:** Unlock UCP Cart MCP endpoint and migrate from `/api/mcp` to `/api/ucp/mcp`.

**Why it matters:** The current implementation targets the standard `/api/mcp` endpoint whose cart tools are on a deprecation track toward UCP Cart MCP. UCP offers the richer catalog response format intended by Spring '26. Migration unblocks that format.

**Dependencies:**

- Item (a) — to benefit from component contract enumeration in the plan phase.
- Item (b) — so the migration can ship to production rather than terminating at QA + sign-off.

**Surfacing context:** The Coder's §8.1 probe cycle during the mcp-shopping-assistant build found `/api/ucp/mcp` returns 302 → /password (dev-store storefront password enabled), forcing a pivot to the standard `/api/mcp` endpoint. The memory file `dev-store-password-blocks-ucp-mcp.md` documents this constraint and should be updated once cleared.

**Scope notes:** Not a feature plan yet, but this is a full squad workflow:

- Remove or disable the storefront password from the hydrogen-storefront dev store (or set up a separate publicly-accessible dev store).
- Probe the UCP surface against the now-reachable `/api/ucp/mcp` endpoint to capture the response shape.
- Document shape differences from the current `/api/mcp` implementation.
- Write a feature plan with the migration scope.
- Implement (update tool calls, response parsers, data flows).
- QA the changes.
- Ship to production (requires item b to be complete).

**Estimated effort:** Large (full squad workflow; one feature plan + implement + QA + ship cycle).

---

## d. Platform: Upgrade Hydrogen, Shopify CLI, and address Vite/React Router deprecation warnings

**Title:** Upgrade Hydrogen (2025.1.1 → 2026.4.3), Shopify CLI, and evaluate React Router v3 future flags.

**Why it matters:** Keeping the platform current reduces accumulated migration risk. The project is 21 versions behind on Hydrogen and will accumulate debt. Also unlocks newer APIs and fixes.

**Dependencies:** No hard dependencies. Benefits from item (b) being in place so upgraded versions can be deployed and verified in production.

**Surfacing context:** Dependency and version state observed during the mcp-shopping-assistant build. Deprecation warnings noted during `npm run dev` and `npm run build` runs (Vite CJS deprecation, React Router v3 future flags). The Hydrogen upgrade includes a Remix-to-React-Router v7 migration, API version bump to 2025.4 Storefront API, cookie system rework, and analytics improvements — all substantive changes.

**Scope notes:** Not a feature plan. This is a **phased upgrade** work:

- Use `/investigate` to map breaking changes between 2025.1.1 and 2026.4.3.
- Write a plan documenting the phases and QA gates.
- Implement in phases (Hydrogen version bump, then CLI upgrade, then React Router future flags evaluation).
- QA each phase before moving to the next.
- Ship when all phases pass (requires item b).

**Estimated effort:** Large (substantial platform migration; schedule when other work has slowed and the team can afford multi-session focus).

---

## When to promote items to feature plans

Each item above should move from this backlog file to a formal feature plan in `docs/plans/` only when:

1. It is the next active work priority (approved by operator).
2. A Plan-Reviewer or Architect agent is ready to write the plan document.
3. The item's dependencies (if any) are already in place or near completion.

Until then, this file serves as the source of truth for queued-up follow-up work and the reasoning behind its sequencing.
