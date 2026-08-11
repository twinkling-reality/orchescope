import { existsSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { formatCount } from '@orchescope/domain';
import { integrityCheck } from '@orchescope/persistence';
import {
  probeJavaScriptParser,
  probePythonParser,
  resetPythonParser,
} from '@orchescope/source-analysis';
import type { Workspace } from '@orchescope/workspace';

/**
 * Environment checks.
 *
 * The doctor answers one question: will the commands this build offers actually work here. Each check reports what
 * it found rather than a bare pass, and an optional capability that is unavailable is reported as such rather than
 * as a failure, because a project that never needs Python analysis should not be told it is broken.
 */

export type CheckStatus = 'ok' | 'warning' | 'failed' | 'not_applicable';

export type Check = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly remediation?: string;
};

export type DoctorResult = {
  readonly checks: readonly Check[];
  readonly ok: boolean;
  readonly warnings: number;
};

const MINIMUM_NODE_MAJOR = 24;

export const runDoctor = async (input: {
  readonly workspace: Workspace;
  readonly orchescopeVersion: string;
}): Promise<DoctorResult> => {
  const { workspace } = input;
  const checks: Check[] = [];

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push({
    name: 'node runtime',
    status: nodeMajor >= MINIMUM_NODE_MAJOR ? 'ok' : 'failed',
    detail: `node ${process.versions.node} on ${platform()} ${arch()}`,
    ...(nodeMajor >= MINIMUM_NODE_MAJOR
      ? {}
      : { remediation: `Orchescope needs Node ${MINIMUM_NODE_MAJOR} or newer.` }),
  });

  checks.push({
    name: 'embedded database',
    status: 'ok',
    detail: `SQLite ${workspace.database.sqliteVersion}, schema version ${workspace.database.schemaVersion}`,
  });

  const integrity = integrityCheck(workspace.database);
  checks.push({
    name: 'store integrity',
    status: integrity.ok ? 'ok' : 'failed',
    detail: integrity.detail,
    ...(integrity.ok
      ? {}
      : { remediation: 'Remove .orchescope/state to start a fresh store, then rerun the audit.' }),
  });

  checks.push({
    name: 'workspace configuration',
    status: 'ok',
    detail:
      workspace.configSource === 'file'
        ? `read from ${workspace.paths.configFile}`
        : 'using built in defaults, no configuration file present',
    ...(workspace.configSource === 'file'
      ? {}
      : { remediation: 'Run orchescope init to write one.' }),
  });

  const javascriptParser = probeJavaScriptParser();
  checks.push({
    name: 'javascript and typescript analysis',
    status: javascriptParser.ok ? 'ok' : 'failed',
    detail: javascriptParser.detail,
    ...(javascriptParser.ok
      ? {}
      : {
          remediation:
            'Reinstall Orchescope so its platform specific parser binding is present, or report the platform.',
        }),
  });

  const pythonParser = await probePythonParser();
  checks.push({
    name: 'python analysis',
    status: pythonParser.ok ? 'ok' : 'warning',
    detail: pythonParser.detail,
    ...(pythonParser.ok
      ? {}
      : {
          remediation:
            'Reinstall Orchescope to restore the Python grammar. JavaScript analysis still works.',
        }),
  });
  resetPythonParser();

  const temporary = tmpdir();
  checks.push({
    name: 'temporary directory',
    status: existsSync(temporary) ? 'ok' : 'failed',
    detail: temporary,
  });

  checks.push({
    name: 'git metadata',
    status: workspace.git === undefined ? 'not_applicable' : 'ok',
    detail:
      workspace.git === undefined
        ? 'this directory is not a git checkout, so findings carry no revision'
        : `commit ${workspace.git.commit?.slice(0, 12) ?? 'unknown'} on ${workspace.git.ref ?? 'unknown ref'}${workspace.git.dirty ? ', working tree dirty' : ''}`,
  });

  const scenarios = workspace.store.listScenarios(workspace.projectId);
  checks.push({
    name: 'scenarios',
    status: scenarios.length > 0 ? 'ok' : 'not_applicable',
    detail:
      scenarios.length > 0
        ? `${formatCount(scenarios.length, 'scenario')} known to this project`
        : 'no scenario is defined, so execution based commands have nothing to run',
    ...(scenarios.length > 0
      ? {}
      : {
          remediation: 'Add a scenario file under scenarios/ to enable test, benchmark and chaos.',
        }),
  });

  checks.push({
    name: 'telemetry',
    status: 'ok',
    detail:
      'Orchescope contains no telemetry, calls no model, and makes no outbound request of its own',
  });

  const failed = checks.filter((check) => check.status === 'failed').length;
  const warnings = checks.filter((check) => check.status === 'warning').length;
  return { checks, ok: failed === 0, warnings };
};
