import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * A real served report, for the browser tests.
 *
 * The demonstration system is copied so the tests never write into the repository, audited with the real command, and
 * then served by the real command. The URL carries the capability token the server prints, which is the same path a user
 * takes. Nothing here stubs the data: if the audit finds nothing, the tests fail, which is the intent.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

export type ServedReport = {
  readonly url: string;
  readonly workspace: string;
  readonly stop: () => Promise<void>;
};

const waitForUrl = (child: ChildProcess): Promise<string> =>
  new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => {
      reject(new Error(`the report server printed no URL: ${buffered}`));
    }, 60_000);
    timer.unref();

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffered += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/.exec(buffered);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the report server exited with code ${String(code)}: ${buffered}`));
    });
  });

export const serveDemoReport = async (): Promise<ServedReport> => {
  const workspace = mkdtempSync(join(tmpdir(), 'orchescope-ui-'));
  cpSync(join(repositoryRoot, 'apps/demo'), workspace, {
    recursive: true,
    filter: (source) => !source.includes('/node_modules'),
  });

  await execFileAsync(process.execPath, [cliEntry, '--cwd', workspace, 'audit', '--json'], {
    cwd: repositoryRoot,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 240_000,
  });

  const child = spawn(process.execPath, [cliEntry, '--cwd', workspace, 'open'], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const url = await waitForUrl(child);
    return {
      url,
      workspace,
      stop: async () => {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 5_000);
          timer.unref();
        });
        rmSync(workspace, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
};
