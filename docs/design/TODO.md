# Open product decisions after the browser cut

The browser workspace, report server, standalone HTML export and Playwright UI suite are gone. What remains below is
what still needs a decision for the agent-first product.

Ordered by how much a reader or agent is misled by leaving it.

## 1. Text the analysis packages write still speaks Orchescope

**What is wrong.** Terminal and MCP prose still surfaces engine vocabulary: `declared`, `exercised`, `relation`,
`run(s)` in some finding strings. Agents and humans both read these strings.

**What would decide it.** Whether JSON and MCP are meant to speak the same language as the terminal document. If they
are, one pass over findings, goals and comparison packages. Grammar slips are worth fixing either way.

## 2. The coverage pair describes the reachable set, not the declared set

**What is wrong.** `ReconciliationDelta.coverage.declaredComponents` counts every component a run could have reached,
including undeclared ones. See the earlier write-up in git history under the old TODO item 7.

**What would decide it.** Whether the pair should describe the declared set or the reachable set, with finding text and
both renderers moving in the same change.

## 3. Steps two to five rarely run on real repositories

**What is wrong.** Measured across corpus bundles, most reports have no runs. The product value is the closed loop, and
most first contacts never reach it.

**What would decide it.** Onboarding that makes one traced run and one goal the default agent path, not optional
advanced commands.
