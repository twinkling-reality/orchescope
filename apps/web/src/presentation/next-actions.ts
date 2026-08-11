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
      title: 'Fix the file that could not be read',
      reason: `${failed.map((adapter) => adapter.id).join(', ')} rejected a file this repository wrote on purpose, so whatever that file said is missing from this report.`,
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
            title: 'Write your system down in a manifest',
            reason:
              'Nothing here named an agent, a model call, a tool or an MCP server. A manifest is how a system this build cannot read from source gets onto the page.',
            commands: [manifestCommand(), auditCommand()],
          }
        : {
            title: 'Fill in the manifest',
            reason:
              'The manifest was read and names nothing yet, so there is nothing to report on.',
            commands: [auditCommand()],
          },
    );
    return actions;
  }

  if (bundle.summary.runCount === 0) {
    actions.push({
      title: 'Watch the system run once',
      reason: 'Most problems only show up once it runs.',
      commands: [traceCommand(), importTraceCommand()],
    });
  }

  const goal =
    bundle.goals.find(
      (candidate) => !['validated', 'rejected', 'abandoned'].includes(candidate.status),
    ) ?? bundle.goals[0];
  if (goal !== undefined) {
    actions.push({
      title: `Hand off and verify ${goal.id}`,
      reason:
        'The goal already exists. Give its prompt to whoever is making the change, then run the commands it records to decide whether it worked. Nothing here marks it done for you.',
      commands: [
        goalPromptCommand(goal.id),
        ...goal.validation.commands.map((entry) => entry.command),
      ].slice(0, 3),
    });
  }

  const [eligible] = goalEligibleFindings(bundle);
  if (eligible !== undefined && goal === undefined) {
    actions.push({
      title: `Turn ${eligible.id} into a goal somebody can pick up`,
      reason: `${eligible.title}. A goal writes down the evidence, the files a change is allowed to touch, and the command that decides whether the change worked.`,
      commands: [goalCommand(eligible.id), goalPromptCommand(null)],
    });
  }

  const [scenario] = bundle.scenarios;
  if (scenario === undefined) {
    actions.push({
      title: 'Add a scenario',
      reason:
        'A scenario is a run you can repeat. Without one, there is no way to check a change by running the same thing again.',
      commands: [scenarioRunCommand(null)],
    });
  } else if (actions.length === 0) {
    actions.push({
      title: 'Change one thing and measure it',
      reason: `${scenario.id} is available and nothing is waiting to be handed off. Varying one thing against it is what produces new evidence next.`,
      commands: [benchmarkCommand(scenario.id)],
    });
  }

  return actions.slice(0, 3);
}
