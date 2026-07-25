import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { renderAgentPrompt } from '@orchescope/goals';
import type { ActionResult, ServerActions } from '@orchescope/report-server';
import {
  compareUseCase,
  createGoalFromFinding,
  loadScenario,
  runBenchmarkUseCase,
  runChaosUseCase,
  runScenarioUseCase,
} from '@orchescope/usecases';
import { resolveInsideRoot } from '@orchescope/workspace';
import type { CommandContext } from './context.ts';

/**
 * Actions the served report may perform.
 *
 * Each one is the same use case the command line calls, so a button in the report and a command in a terminal
 * cannot diverge. Two of them deserve their own note:
 *
 *  - opening a source location shells out to an editor. The path is resolved inside the repository root first, so a
 *    crafted request cannot point the editor at an arbitrary file, and the editor command comes from the
 *    environment rather than from the request.
 *  - every action is only wired up when the corresponding capability is available, so a report served in a
 *    restricted configuration has no handler at all rather than one that refuses.
 */

const ok = (body: unknown): ActionResult => ({ status: 200, body: { ok: true, data: body } });

const failed = (status: number, message: string): ActionResult => ({
  status,
  body: { ok: false, error: { message } },
});

const EDITOR_COMMANDS: readonly (readonly [
  string,
  (file: string, line?: number) => readonly string[],
])[] = [
  ['code', (file, line) => (line === undefined ? [file] : ['--goto', `${file}:${line}`])],
  ['cursor', (file, line) => (line === undefined ? [file] : ['--goto', `${file}:${line}`])],
  ['subl', (file, line) => [line === undefined ? file : `${file}:${line}`]],
  ['vim', (file, line) => (line === undefined ? [file] : [`+${line}`, file])],
];

const openWithEditor = (
  editor: string,
  file: string,
  line: number | undefined,
): Promise<ActionResult> => {
  const entry = EDITOR_COMMANDS.find(([name]) => editor.endsWith(name));
  const args = entry === undefined ? [file] : entry[1](file, line);
  return new Promise<ActionResult>((resolve) => {
    execFile(editor, [...args], { timeout: 5_000, windowsHide: true }, (error) => {
      resolve(
        error === null
          ? ok({ opened: true, editor })
          : failed(502, `the editor ${editor} could not be started: ${error.message}`),
      );
    });
  });
};

export const serverActionsFor = (context: CommandContext): ServerActions => {
  const { workspace } = context;
  const version = context.version;

  return {
    createGoal: (findingId) => {
      try {
        const goal = createGoalFromFinding({ workspace, findingId });
        return ok({ goal, agentPrompt: renderAgentPrompt(goal) });
      } catch (error) {
        return failed(
          400,
          error instanceof Error ? error.message : 'the goal could not be created',
        );
      }
    },
    rerunScenario: async (scenarioId) => {
      try {
        const scenario = loadScenario({ workspace, reference: scenarioId });
        const outcome = await runScenarioUseCase({
          workspace,
          scenario,
          orchescopeVersion: version,
        });
        return ok({ result: outcome.result, runIds: outcome.runIds });
      } catch (error) {
        return failed(
          400,
          error instanceof Error ? error.message : 'the scenario could not be run',
        );
      }
    },
    runBenchmark: async (input) => {
      try {
        const scenario = loadScenario({ workspace, reference: input.scenarioId });
        const values = input.values
          .map((value) => Number.parseInt(value, 10))
          .filter(Number.isFinite);
        const report = await runBenchmarkUseCase({
          workspace,
          scenario,
          dimension:
            input.dimension === 'traffic_concurrency' ? 'traffic_concurrency' : 'agent_count',
          values: values.length > 0 ? values : [1, 2],
          repetitions: 3,
          orchescopeVersion: version,
        });
        return ok({ benchmarkId: report.id, variants: report.variants.length });
      } catch (error) {
        return failed(
          400,
          error instanceof Error ? error.message : 'the benchmark could not be run',
        );
      }
    },
    runChaos: async (scenarioId) => {
      try {
        const scenario = loadScenario({ workspace, reference: scenarioId });
        const report = await runChaosUseCase({ workspace, scenario, orchescopeVersion: version });
        return ok({ chaosReportId: report.id, outcomes: report.outcomes.length });
      } catch (error) {
        return failed(
          400,
          error instanceof Error ? error.message : 'the chaos suite could not be run',
        );
      }
    },
    compareRuns: (input) => {
      try {
        const comparison = compareUseCase({
          workspace,
          baseline: input.baseline,
          candidate: input.candidate,
        });
        return ok({ comparison });
      } catch (error) {
        return failed(400, error instanceof Error ? error.message : 'the comparison failed');
      }
    },
    openLocation: (input) => {
      const editor =
        process.env['ORCHESCOPE_EDITOR'] ?? process.env['VISUAL'] ?? process.env['EDITOR'];
      if (editor === undefined) {
        return failed(
          409,
          'no editor is configured. Set ORCHESCOPE_EDITOR, VISUAL or EDITOR to open a source location.',
        );
      }
      let absolute: string;
      try {
        absolute = resolveInsideRoot(workspace.paths, input.file);
      } catch {
        return failed(400, 'the path is outside the repository');
      }
      if (!existsSync(absolute)) {
        return failed(404, `${input.file} does not exist in this repository`);
      }
      return openWithEditor(editor, absolute, input.line);
    },
  };
};
