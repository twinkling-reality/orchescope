/**
 * What to do next, derived from the report rather than from a fixed list.
 *
 * The overview leads with this because a report that states a problem and not the next move leaves the
 * reader to guess. The order is the same one the command line uses: a rejected input first, then a system
 * that was never declared, then runtime evidence, then the goal loop. Nothing here invents a command that
 * the binary does not accept; every argv comes from `commands.ts`, which is tested against the real
 * command line surface.
 */

import type { Finding, ReportBundle } from '@orchescope/schema';
import {
  auditCommand,
  benchmarkCommand,
  goalCommand,
  goalPromptCommand,
  importTraceCommand,
  manifestCommand,
  scenarioRunCommand,
  traceCommand,
} from './commands.ts';

export interface NextAction {
  readonly title: string;
  /** Why this is the next step, in the reader's terms. */
  readonly reason: string;
  readonly commands: readonly (readonly string[])[];
}

const MANIFEST_ADAPTER_ID = 'adapter:manifest';

/** Adapters that could not use an input the project wrote on purpose. */
export function failedAdapters(bundle: ReportBundle): readonly { id: string; detail: string }[] {
  return bundle.graph.coverage.adapters
    .filter((adapter) => adapter.status === 'failed')
    .map((adapter) => ({
      id: adapter.adapterId.replace(/^adapter:/, ''),
      detail: adapter.detail ?? 'the adapter failed',
    }));
}

export function goalEligibleFindings(bundle: ReportBundle): readonly Finding[] {
  return bundle.findings.filter(
    (finding) => finding.polarity === 'risk' && finding.goalReadiness.eligible,
  );
}

export function nextActions(bundle: ReportBundle): readonly NextAction[] {
  const actions: NextAction[] = [];
  const failed = failedAdapters(bundle);
  if (failed.length > 0) {
    actions.push({
      title: 'Correct the input that could not be read',
      reason: `${failed.map((adapter) => adapter.id).join(', ')} rejected a file this repository wrote on purpose, so whatever it declared is missing from this report.`,
      commands: [auditCommand()],
    });
  }

  const manifest = bundle.graph.coverage.adapters.find(
    (adapter) => adapter.adapterId === MANIFEST_ADAPTER_ID,
  );
  if (bundle.summary.componentCount === 0) {
    actions.push(
      manifest === undefined || manifest.status === 'not_applicable'
        ? {
            title: 'Declare the system in a manifest',
            reason:
              'Nothing here declared an agent, a model call, a tool or an MCP server. A manifest is how a system this build cannot parse gets into the graph.',
            commands: [manifestCommand(), auditCommand()],
          }
        : {
            title: 'Declare your components in the manifest',
            reason: 'The manifest was read and declares nothing yet, so the graph is still empty.',
            commands: [auditCommand()],
          },
    );
    return actions;
  }

  if (bundle.summary.runCount === 0) {
    actions.push({
      title: 'Collect runtime evidence',
      reason:
        'This report has the declared side only. The delta between what the repository declares and what a run exercises needs at least one run.',
      commands: [traceCommand(), importTraceCommand()],
    });
  }

  const [eligible] = goalEligibleFindings(bundle);
  if (eligible !== undefined) {
    actions.push({
      title: `Turn ${eligible.id} into a bounded goal`,
      reason: `${eligible.title}. A goal states the evidence, the files a change may touch, and the command that decides whether the change worked.`,
      commands: [goalCommand(eligible.id), goalPromptCommand(null)],
    });
  }

  const [scenario] = bundle.scenarios;
  if (scenario === undefined) {
    actions.push({
      title: 'Add a scenario',
      reason:
        'A scenario is a repeatable run. Without one, a change cannot be verified by rerunning the same thing.',
      commands: [scenarioRunCommand(null)],
    });
  } else if (actions.length === 0) {
    actions.push({
      title: 'Vary one dimension and compare',
      reason: `${scenario.id} is available, and no finding is waiting for a goal. A benchmark is the next thing that produces new evidence.`,
      commands: [benchmarkCommand(scenario.id)],
    });
  }

  return actions.slice(0, 3);
}
