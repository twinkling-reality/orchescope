/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AdapterRun, ReportBundle, Scenario } from '@orchescope/schema';
import {
  failedAdapters,
  goalEligibleFindings,
  nextActions,
} from '../src/presentation/next-actions.ts';
import { bundle, component, finding, goal } from './fixture.ts';

/**
 * The overview tells a reader what to do next, so the order has to hold: an input Orchescope could not read
 * comes before a missing declaration, a missing declaration before runtime evidence, and runtime evidence
 * before anything that needs it. Sending a reader to `trace` when nothing was detected would waste their run.
 */

const adapter = (overrides: Partial<AdapterRun> & Pick<AdapterRun, 'adapterId'>): AdapterRun => ({
  adapterId: overrides.adapterId,
  adapterVersion: overrides.adapterVersion ?? '1',
  ecosystem: overrides.ecosystem ?? 'manifest',
  componentsFound: overrides.componentsFound ?? 0,
  edgesFound: overrides.edgesFound ?? 0,
  filesInspected: overrides.filesInspected ?? 0,
  durationMs: overrides.durationMs ?? 0,
  status: overrides.status ?? 'completed',
  ...(overrides.detail === undefined ? {} : { detail: overrides.detail }),
});

const withCoverage = (base: ReportBundle, adapters: readonly AdapterRun[]): ReportBundle => ({
  ...base,
  graph: { ...base.graph, coverage: { ...base.graph.coverage, adapters: [...adapters] } },
});

const scenario = (id: string): Scenario =>
  ({
    schemaVersion: 1,
    id,
    name: id,
    description: 'a scenario',
    target: { kind: 'command', command: ['node', 'main.js'] },
    inputs: [],
    evaluators: [],
    faults: [],
    limits: {},
    metadata: {},
  }) as unknown as Scenario;

const populated = (overrides: Partial<ReportBundle> = {}): ReportBundle => {
  const base = bundle({
    graph: {
      ...bundle().graph,
      components: [component({ id: 'agent:triage' })],
    },
    ...overrides,
  });
  return {
    ...base,
    summary: { ...base.summary, componentCount: 1, runCount: 0, ...(overrides.summary ?? {}) },
  };
};

describe('nextActions', () => {
  it('puts a rejected input first, because it changes what the report means', () => {
    const report = withCoverage(populated({ summary: { ...populated().summary, runCount: 2 } }), [
      adapter({
        adapterId: 'adapter:manifest',
        status: 'failed',
        detail: '.orchescope/manifest.yaml is not a valid manifest: /edges/0/from',
      }),
    ]);
    const [first] = nextActions(report);
    assert.equal(first?.title, 'Fix the file that could not be read');
    assert.match(first?.reason ?? '', /manifest/);
  });

  it('points an undetected repository at the manifest, not at a trace', () => {
    const actions = nextActions(bundle());
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.title, 'Write your system down in a manifest');
    assert.deepEqual(actions[0]?.commands[0], ['orchescope', 'init', '--manifest']);
  });

  it('says to declare components when the manifest was read and declares nothing', () => {
    const actions = nextActions(
      withCoverage(bundle(), [adapter({ adapterId: 'adapter:manifest', status: 'completed' })]),
    );
    assert.equal(actions[0]?.title, 'Fill in the manifest');
  });

  it('asks for runtime evidence when a system was found and nothing has run', () => {
    const actions = nextActions(populated());
    assert.equal(actions[0]?.title, 'Watch the system run once');
    assert.deepEqual(actions[0]?.commands[0]?.slice(0, 2), ['orchescope', 'trace']);
  });

  it('names the eligible finding once there is a run to compare against', () => {
    const report = populated({
      findings: [
        finding({ id: 'OSC-REL-0001', severity: 'high', title: 'A retry can repeat a refund' }),
      ],
    });
    const actions = nextActions({ ...report, summary: { ...report.summary, runCount: 1 } });
    const goalStep = actions.find((action) => action.title.includes('OSC-REL-0001'));
    assert.ok(goalStep !== undefined, `no goal step in ${actions.map((a) => a.title).join(', ')}`);
    assert.deepEqual(goalStep.commands[0], ['orchescope', 'goal', 'create', 'OSC-REL-0001']);
  });

  it('never offers a goal for a finding that is not eligible', () => {
    const report = populated({
      findings: [
        finding({
          id: 'OSC-ARCH-0001',
          goalReadiness: {
            eligible: false,
            reason: 'this needs a design decision',
            requiresRuntimeEvidence: false,
            requiresHumanReview: true,
          },
        }),
      ],
    });
    const withRun = { ...report, summary: { ...report.summary, runCount: 1 } };
    assert.deepEqual(goalEligibleFindings(withRun), []);
    assert.equal(
      nextActions(withRun).some((action) => action.title.startsWith('Turn ')),
      false,
    );
  });

  it('suggests a benchmark only when nothing more useful is outstanding', () => {
    const report = populated({ scenarios: [scenario('support-desk')] });
    const actions = nextActions({ ...report, summary: { ...report.summary, runCount: 3 } });
    assert.deepEqual(actions, [
      {
        title: 'Change one thing and measure it',
        reason:
          'support-desk is available and nothing is waiting to be handed off. Varying one thing against it is what produces new evidence next.',
        commands: [['orchescope', 'benchmark', '--scenario', 'support-desk', '--agents', '1,2,4']],
      },
    ]);
  });

  it('hands off and verifies an existing goal instead of offering another one', () => {
    const report = populated({
      findings: [finding({ id: 'OSC-REL-0001' })],
      goals: [goal({ id: 'OSC-GOAL-0001' })],
      scenarios: [scenario('support-desk')],
    });
    const actions = nextActions({ ...report, summary: { ...report.summary, runCount: 3 } });
    assert.equal(actions[0]?.title, 'Hand off and verify OSC-GOAL-0001');
    assert.deepEqual(actions[0]?.commands[0], [
      'orchescope',
      'goal',
      'show',
      'OSC-GOAL-0001',
      '--prompt',
    ]);
    assert.equal(
      actions.some((action) => action.title.startsWith('Turn ')),
      false,
    );
  });

  it('bounds itself to three steps', () => {
    const report = withCoverage(
      populated({
        findings: [finding({ id: 'OSC-REL-0001' }), finding({ id: 'OSC-REL-0002' })],
      }),
      [adapter({ adapterId: 'adapter:manifest', status: 'failed', detail: 'rejected' })],
    );
    assert.ok(nextActions(report).length <= 3);
  });
});

describe('failedAdapters', () => {
  it('names the adapter without its identifier prefix and keeps the detail', () => {
    const report = withCoverage(bundle(), [
      adapter({ adapterId: 'adapter:manifest', status: 'failed', detail: 'not a valid manifest' }),
      adapter({ adapterId: 'adapter:mcp', status: 'not_applicable' }),
    ]);
    assert.deepEqual(failedAdapters(report), [{ id: 'manifest', detail: 'not a valid manifest' }]);
  });
});
