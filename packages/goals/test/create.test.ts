import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Evidence, Finding } from '@orchescope/schema';
import { createGoal, type CreateGoalInput } from '../src/create.ts';
import { renderGoalMarkdown } from '../src/render.ts';

/**
 * Goal creation tests.
 *
 * A goal is the document handed to whoever implements the change, and the two things it must not do are
 * overstate its own evidence and name something the reader cannot find again. Both are tested here
 * because neither is visible from inside the goal: a class of `observed` looks the same as any other
 * until it is read back against the record it summarises.
 */

const evidence = (id: string, kind: Evidence['kind'], basis: Evidence['basis']): Evidence =>
  ({ id, kind, basis, producer: 'test' }) as Evidence;

const finding = (overrides: Partial<Finding> = {}): Finding =>
  ({
    id: 'OSC-REL-0003',
    ruleId: 'retry-around-non-idempotent-operation',
    category: 'reliability',
    severity: 'high',
    basis: 'discovered',
    confidence: 0.85,
    polarity: 'risk',
    title: 'Retry around issue_refund can repeat an effect',
    explanation: 'orchestrator retries issue_refund and no idempotency key was found.',
    impact: 'Under a transient failure the external effect happens more than once.',
    components: ['tool:issue_refund'],
    edges: [],
    sourceLocations: [{ file: 'src/tools/refund.ts', startLine: 1 }],
    evidence: ['ev_one', 'ev_two'],
    metrics: [],
    tags: [],
    metadata: {},
    goalReadiness: { eligible: true, requiresRuntimeEvidence: false, requiresHumanReview: false },
    ...overrides,
  }) as Finding;

const create = (input: {
  readonly finding?: Finding;
  readonly evidence?: readonly Evidence[];
  readonly scenarioIds?: readonly string[];
  readonly baseline?: CreateGoalInput['baseline'];
  readonly exercisingRunIds?: readonly string[];
  readonly repetitions?: number;
}) =>
  createGoal({
    finding: input.finding ?? finding(),
    sequence: 1,
    now: '2026-07-27T12:00:00.000Z',
    components: [],
    evidence: input.evidence ?? [],
    validationScenarioIds: input.scenarioIds ?? [],
    ...(input.baseline === undefined ? {} : { baseline: input.baseline }),
    exercisingRunIds: input.exercisingRunIds ?? input.baseline?.runIds ?? [],
    repetitions: input.repetitions ?? 3,
  });

/** A recorded result that can serve as a baseline: one scenario, one condition, enough samples. */
const recorded = (scenarioId: string, samples = 3): CreateGoalInput['baseline'] => ({
  scenarioId,
  runIds: Array.from(
    { length: samples },
    (_, index) => `run_${String(index + 1).padStart(16, '0')}`,
  ),
  samples,
});

describe('createGoal, the evidence summary', () => {
  it('carries the class of the records it counts rather than assuming they were observed', () => {
    const goal = create({
      evidence: [
        evidence('ev_one', 'config_entry', 'discovered'),
        evidence('ev_two', 'derived', 'inferred'),
      ],
    });
    const bases = new Map(goal.evidenceSummary.map((entry) => [entry.label, entry.basis]));
    assert.equal(bases.get('config_entry evidence'), 'discovered');
    assert.equal(bases.get('derived evidence'), 'inferred');
    assert.ok(!goal.evidenceSummary.some((entry) => entry.basis === 'observed'));
  });

  it('separates records of one kind that were established differently', () => {
    const goal = create({
      evidence: [
        evidence('ev_one', 'span', 'observed'),
        evidence('ev_two', 'span', 'simulated'),
        evidence('ev_three', 'span', 'simulated'),
      ],
    });
    const spans = goal.evidenceSummary.filter((entry) => entry.label === 'span evidence');
    assert.equal(spans.length, 2);
    assert.deepEqual(spans.map((entry) => `${entry.basis} ${entry.value}`).toSorted(), [
      'observed 1 record',
      'simulated 2 records',
    ]);
  });

  it('says a class for a record even when the finding names no metric', () => {
    const goal = create({ evidence: [] });
    assert.equal(goal.evidenceSummary.length, 1);
    assert.equal(goal.evidenceSummary[0]?.basis, 'discovered');
    assert.equal(goal.evidenceSummary[0]?.value, '2 records referenced by the finding');
  });

  it('gives the plural rather than deriving it', () => {
    const one = create({ evidence: [evidence('ev_one', 'config_entry', 'discovered')] });
    assert.equal(one.evidenceSummary[0]?.value, '1 record');
    const two = create({
      evidence: [
        evidence('ev_one', 'config_entry', 'discovered'),
        evidence('ev_two', 'config_entry', 'discovered'),
      ],
    });
    assert.equal(two.evidenceSummary[0]?.value, '2 records');
  });
});

describe('createGoal, semantic finding continuity', () => {
  it('copies the full key and subject digests used to match the rerun', () => {
    const semanticKey = 'a'.repeat(64);
    const semanticSubject = 'b'.repeat(64);
    const goal = create({
      finding: finding({
        id: 'OSC-ABCDE-1234',
        metadata: {
          findingIdentity: 'semantic-sha256-v1',
          findingSemanticKey: semanticKey,
          findingSemanticSubject: semanticSubject,
        },
      }),
    });
    assert.equal(goal.findingId, 'OSC-ABCDE-1234');
    assert.equal(goal.metadata['findingSemanticKey'], semanticKey);
    assert.equal(goal.metadata['findingSemanticSubject'], semanticSubject);
  });

  it('refuses to downgrade incomplete semantic metadata to legacy matching', () => {
    assert.throws(
      () =>
        create({
          finding: finding({
            id: 'OSC-ABCDE-1234',
            metadata: { findingIdentity: 'semantic-sha256-v1' },
          }),
        }),
      /incomplete semantic identity metadata/,
    );
  });
});

describe('createGoal, naming the finding', () => {
  it('states the explanatory rule in the criterion and keeps the handle in the machine check', () => {
    const goal = create({});
    const resolved = goal.acceptanceCriteria.find(
      (criterion) => criterion.check.kind === 'finding_resolved',
    );
    assert.ok(resolved !== undefined);
    assert.equal(
      resolved.statement,
      'finding retry-around-non-idempotent-operation no longer fires on a rescan',
    );
    assert.ok(!resolved.statement.includes('OSC-REL-0003'));
  });

  it('keeps the identifier in the check, as the record of which finding the goal was cut from', () => {
    const goal = create({});
    const resolved = goal.acceptanceCriteria.find(
      (criterion) => criterion.check.kind === 'finding_resolved',
    );
    assert.equal(
      resolved?.check.kind === 'finding_resolved' ? resolved.check.findingId : null,
      'OSC-REL-0003',
    );
    assert.equal(goal.findingId, 'OSC-REL-0003');
    assert.equal(goal.metadata['ruleId'], 'retry-around-non-idempotent-operation');
  });

  it('names no identifier anywhere a reader is asked to go and look', () => {
    const goal = create({ scenarioIds: ['support-desk'] });
    const prose = [
      goal.rollback,
      ...goal.acceptanceCriteria.map((criterion) => criterion.statement),
      ...goal.validation.commands.map((command) => command.purpose),
    ];
    for (const line of prose) assert.ok(!line.includes('OSC-REL-0003'), line);
  });
});

/**
 * A goal must not state a term nothing can evaluate.
 *
 * Two metric criteria were issued whatever the repository held, and the plan in the same document
 * declined to prescribe the `compare` that would decide them. An operator who did exactly what the goal
 * asked got `not validated` with those two permanently undecided, so a goal that was in fact complete
 * could never say so, and the loop this product exists to close stopped one step from the end.
 */
describe('createGoal, the criteria it is willing to be judged on', () => {
  it('issues no metric criterion when no run has been recorded to compare against', () => {
    const issued = create({}).acceptanceCriteria.map((criterion) => criterion.statement);
    assert.deepEqual(issued, [
      'finding retry-around-non-idempotent-operation no longer fires on a rescan',
    ]);
  });

  it('issues them once the plan can produce both sides, which is when it prescribes the comparison', () => {
    const goal = create({
      baseline: recorded('support-desk'),
      scenarioIds: ['support-desk'],
    });
    const issued = goal.acceptanceCriteria.map((criterion) => criterion.statement);
    assert.ok(issued.some((statement) => statement.includes('task success does not decline')));
    assert.ok(
      goal.validation.commands.some((entry) => entry.command.includes('compare')),
      'the command that decides them has to be prescribed alongside them',
    );
  });

  /*
   * A baseline without a scenario is half a comparison.
   *
   * Nothing in the plan records a run except a scenario, so `latest` still resolves to the baseline and
   * the prescribed comparison is a run against itself. Every metric reads unchanged, which satisfies both
   * `metric_not_worse` criteria on evidence about nothing, and a goal that reports a pass it did not earn
   * is worse than one that reports it cannot tell.
   */
  it('issues no metric criterion when the plan can produce no candidate to compare against', () => {
    const goal = create({ baseline: recorded('support-desk') });
    const metric = goal.acceptanceCriteria.filter((criterion) =>
      criterion.check.kind.startsWith('metric_'),
    );
    assert.deepEqual(
      metric,
      [],
      'a criterion was stated that only a self comparison could satisfy',
    );
    assert.equal(
      goal.validation.commands.some((entry) => entry.command.includes('compare')),
      false,
      'the plan prescribed a comparison whose candidate would be its own baseline',
    );
    // The document says which half is missing rather than leaving a reader to notice the absence.
    assert.match(renderGoalMarkdown(goal), /which this plan does not rerun/);
  });

  /* The two go together: a criterion is issued exactly when its deciding command is. */
  it('never states a criterion whose deciding command it declines to name', () => {
    const goal = create({});
    const metric = goal.acceptanceCriteria.filter((criterion) =>
      criterion.check.kind.startsWith('metric_'),
    );
    const compares = goal.validation.commands.some((entry) => entry.command.includes('compare'));
    assert.equal(metric.length === 0, !compares);
  });

  /*
   * Naming the command is not enough on its own: it has to carry the argument that makes its result
   * findable. A comparison is attached to a goal only by `--goal`, and a judgement resolves one by that
   * identifier, so the command without it produces evidence the goal cannot see.
   */
  it('names itself on the comparison it prescribes', () => {
    const goal = create({
      baseline: recorded('support-desk'),
      scenarioIds: ['support-desk'],
    });
    const compare = goal.validation.commands.find((entry) => entry.command.includes('compare'));
    assert.ok(compare !== undefined, 'the plan prescribed no comparison');
    const at = compare.command.indexOf('--goal');
    assert.ok(at >= 0, `the prescribed comparison carries no --goal: ${compare.command.join(' ')}`);
    assert.equal(compare.command[at + 1], goal.id);
  });
});
