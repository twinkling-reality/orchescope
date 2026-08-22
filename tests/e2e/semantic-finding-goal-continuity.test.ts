import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateRules,
  fired,
  type FindingDraft,
  type Rule,
} from '../../packages/findings/src/index.ts';
import { createGoal } from '../../packages/goals/src/index.ts';
import { indexGraph } from '../../packages/graph/src/index.ts';
import type { EvidenceId, Finding } from '../../packages/schema/src/index.ts';
import { buildGraph, componentDraft, edgeDraft } from '../../packages/testkit/src/index.ts';

const planner = componentDraft({ kind: 'agent', name: 'planner', file: 'src/planner.ts' });
const model = componentDraft({ kind: 'model', name: 'primary', file: 'src/model.ts' });
const runtimeTool = componentDraft({ kind: 'tool', name: 'runtime_tool', file: 'src/tool.ts' });
const graph = indexGraph(
  buildGraph(
    [planner, model, runtimeTool],
    [edgeDraft('invokes_model', planner, model), edgeDraft('calls_tool', planner, runtimeTool)],
  ),
);
const plannerId = graph.graph.components.find((component) => component.displayName === 'planner')
  ?.id as string;
const modelId = graph.graph.components.find((component) => component.displayName === 'primary')
  ?.id as string;
const runtimeToolId = graph.graph.components.find(
  (component) => component.displayName === 'runtime_tool',
)?.id as string;
const modelEdgeId = graph.graph.edges.find((edge) => edge.kind === 'invokes_model')?.id as string;

const selectedDraft: FindingDraft = {
  ruleId: 'model-call-without-timeout',
  situation: 'model-call-without-timeout',
  category: 'reliability',
  polarity: 'risk',
  severity: 'medium',
  confidence: 0.85,
  basis: 'discovered',
  title: 'Primary has no timeout',
  explanation: 'The model invocation carries no timeout.',
  impact: 'A provider can hold the run open.',
  components: [plannerId, modelId],
  edges: [modelEdgeId],
  evidence: ['ev_timeout' as EvidenceId],
  recommendation: {
    summary: 'Set a timeout on the model client.',
    steps: ['Set an explicit timeout.'],
    effort: 'small',
    risk: 'low',
  },
  remediationVariant: 'client',
  goalEligible: true,
  goalReason: 'One bounded client setting.',
};

const rule = (id: string, draft: FindingDraft): Rule => ({
  id,
  category: draft.category,
  summary: id,
  evaluate: () => fired([draft]),
});

const findings = (rules: readonly Rule[]): readonly Finding[] =>
  evaluateRules({
    scanId: 'scan_goal_continuity',
    generatedAt: '2026-08-22T12:00:00.000Z',
    graph,
    context: {
      delta: undefined,
      observedRuns: [],
      silentRuns: [],
      benchmarks: [],
      chaosReports: [],
      scenarios: [],
      evidenceById: new Map(),
    },
    rules,
  }).findingSet.findings;

describe('semantic finding goal continuity', () => {
  it('creates the rerun goal for the same selected claim after runtime adds another finding', () => {
    const selectedRule = rule(selectedDraft.ruleId, selectedDraft);
    const before = findings([selectedRule])[0] as Finding;
    const runtimeDraft: FindingDraft = {
      ...selectedDraft,
      ruleId: 'exercised-not-declared',
      situation: 'observed-component-without-exact-declaration',
      category: 'architecture',
      title: 'Runtime tool has no exact declaration',
      components: [runtimeToolId],
      edges: [],
      evidence: ['ev_runtime' as EvidenceId],
      remediationVariant: 'manifest-declaration',
    };
    const after = findings([rule(runtimeDraft.ruleId, runtimeDraft), selectedRule]);
    const selectedAfterRerun = after.find((finding) => finding.ruleId === selectedDraft.ruleId);
    assert.ok(selectedAfterRerun !== undefined);
    assert.equal(selectedAfterRerun.id, before.id);

    const goal = createGoal({
      finding: selectedAfterRerun,
      sequence: 1,
      now: '2026-08-22T12:05:00.000Z',
      components: graph.graph.components.filter((component) =>
        selectedAfterRerun.components.includes(component.id),
      ),
      evidence: [],
      validationScenarioIds: [],
      baselineRunIds: [],
      repetitions: 3,
    });
    const resolved = goal.acceptanceCriteria.find(
      (criterion) => criterion.check.kind === 'finding_resolved',
    );
    assert.equal(resolved?.check.kind, 'finding_resolved');
    if (resolved?.check.kind !== 'finding_resolved') return;
    assert.equal(resolved.check.findingId, before.id);
    assert.equal(
      goal.metadata['findingSemanticKey'],
      selectedAfterRerun.metadata['findingSemanticKey'],
    );
  });
});
