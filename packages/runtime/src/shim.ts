import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finding the instrumentation shim, and deciding whether to load it into the target.
 *
 * Two layouts have to work. An installed build is one bundled command line file with `instrument.mjs`
 * beside it. A source checkout runs the TypeScript directly and has the shim's entry point in its own
 * package. Resolving by trying both, rather than by asking which mode this is, is what stops a change to
 * one layout silently disabling instrumentation in the other: the shim either exists on disk or it does
 * not, and a run says which.
 */

/**
 * Commands whose process is a Node process, so `NODE_OPTIONS` reaches it.
 *
 * A package manager is on the list because it is how a project's own start script is invoked, and the
 * variable is inherited by what it spawns. `python`, `docker`, `uvicorn` and `wrangler` are deliberately
 * absent: the variable means nothing to them, and pretending otherwise would be the tool claiming to have
 * instrumented something it never touched.
 */
const NODE_COMMANDS = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'pnpx',
  'yarn',
  'bun',
  'bunx',
  'deno',
]);

const basename = (command: string): string => {
  const cut = command.replaceAll('\\', '/').split('/').pop() ?? command;
  return cut.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
};

export const targetRunsNode = (command: readonly string[]): boolean => {
  const first = command[0];
  return first !== undefined && NODE_COMMANDS.has(basename(first));
};

/**
 * Where the shim is, or undefined when this build does not carry one.
 *
 * `moduleUrl` is the caller's `import.meta.url`, which is what tells the two layouts apart without either
 * of them having to be named.
 */
export const locateShim = (moduleUrl: string): string | undefined => {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    // An installed build: one bundle, with the shim beside it.
    join(here, 'instrument.mjs'),
    // A source checkout: packages/runtime/src -> packages/instrumentation/src.
    join(here, '..', '..', 'instrumentation', 'src', 'register.ts'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
};

/**
 * `NODE_OPTIONS` with the shim added, preserving whatever the environment already asked for.
 *
 * Appending rather than replacing matters: a project that sets its own `--max-old-space-size` or loader in
 * the environment is telling the runtime something it needs, and a tracer that overwrote it would change
 * how the program runs in order to watch it run.
 */
export const withShim = (existing: string | undefined, shimPath: string): string => {
  const option = `--import ${JSON.stringify(shimPath)}`;
  return existing === undefined || existing.trim().length === 0 ? option : `${existing} ${option}`;
};
