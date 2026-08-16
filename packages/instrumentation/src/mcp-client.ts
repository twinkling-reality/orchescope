import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MCP } from '@orchescope/traces/attributes';
import { SPAN_KIND_CLIENT, type Tracer } from './tracer.ts';

/**
 * Tool calls a target makes to a Model Context Protocol server it started itself.
 *
 * Every other thing this shim records travels over `fetch`, which is a global and needs no cooperation
 * from anyone. A local MCP server does not: the client spawns it and speaks newline delimited JSON-RPC
 * over its standard input, so the request never passes anything patchable. That is the common shape for a
 * repository that uses MCP servers rather than publishing one, and without this its tool calls are the
 * one part of an agent system that leaves no trace at all.
 *
 * The patch is on `Client.prototype.callTool`, which is the narrowest place that knows both the tool's
 * name and when the call finished. It is also the piece of surface most likely to move, so nothing here
 * assumes: the module is resolved from the target's own dependencies, the shape is checked before it is
 * touched, and what happened is reported rather than left for a reader to infer from an empty trace.
 */

export type PatchOutcome =
  | { readonly patched: true; readonly target: string }
  | { readonly patched: false; readonly target: string; readonly reason: string };

const CLIENT_MODULE = '@modelcontextprotocol/sdk/client/index.js';

type ToolCall = { readonly name?: unknown };
type ClientClass = { prototype: { callTool?: unknown } };

/**
 * Every build of the module that the target might load.
 *
 * A package that ships both a CommonJS and an ES module build is two separate objects at runtime, and
 * `require.resolve` only ever finds the first. The first target this ran against imported the package, so
 * the patch was applied to the CommonJS copy, the target used the ES module copy, and the run reported a
 * successful patch and produced no tool spans at all. That is worse than not patching: it is the tool
 * claiming to have looked.
 *
 * So the package's own `exports` map is read and every build it offers for this entry is patched. They are
 * distinct instances, so whichever the target reaches is one this has already been through, and no
 * guessing about directory layouts is involved.
 */
const CONDITIONS = ['import', 'require', 'default', 'node'] as const;

const buildsIn = (entry: unknown, into: Set<string>): void => {
  if (typeof entry === 'string') {
    into.add(entry);
    return;
  }
  if (typeof entry !== 'object' || entry === null) return;
  for (const condition of CONDITIONS) {
    buildsIn((entry as Record<string, unknown>)[condition], into);
  }
};

/**
 * The entry in an `exports` map that governs a subpath, and what the wildcard in it stands for.
 *
 * An exact key wins; otherwise the pattern whose prefix is longest, which is what the module resolution
 * specification says and what makes `./client/index.js` land on `./*` rather than on `.`. The Model
 * Context Protocol SDK maps exactly this way, so without patterns the map yields nothing at all and the
 * only build found is the one `require` happened to pick.
 */
const exportEntryFor = (
  exports: Record<string, unknown>,
  subpath: string,
): { readonly entry: unknown; readonly wildcard: string } | undefined => {
  const exact = exports[subpath];
  if (exact !== undefined) return { entry: exact, wildcard: '' };
  let best:
    | { readonly entry: unknown; readonly wildcard: string; readonly length: number }
    | undefined;
  for (const [key, entry] of Object.entries(exports)) {
    const star = key.indexOf('*');
    if (star < 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    if (best !== undefined && prefix.length <= best.length) continue;
    best = {
      entry,
      wildcard: subpath.slice(prefix.length, subpath.length - suffix.length),
      length: prefix.length,
    };
  }
  return best === undefined ? undefined : { entry: best.entry, wildcard: best.wildcard };
};

const packageNameOf = (specifier: string): { readonly name: string; readonly subpath: string } => {
  const parts = specifier.split('/');
  const take = specifier.startsWith('@') ? 2 : 1;
  const rest = parts.slice(take);
  return {
    name: parts.slice(0, take).join('/'),
    subpath: rest.length === 0 ? '.' : `./${rest.join('/')}`,
  };
};

/** The manifest of the package a file belongs to, found by walking up until the name matches. */
const manifestAbove = (from: string | undefined, packageName: string): string | undefined => {
  let directory = from === undefined ? undefined : dirname(from);
  while (directory !== undefined) {
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) {
      try {
        const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: unknown };
        if (manifest.name === packageName) return candidate;
      } catch {
        // An unreadable manifest is not the one being looked for.
      }
    }
    const parent = dirname(directory);
    directory = parent === directory ? undefined : parent;
  }
  return undefined;
};

const resolveFrom = (directory: string, specifier: string): readonly string[] => {
  const require = createRequire(`${directory}/index.js`);
  const found = new Set<string>();
  try {
    found.add(require.resolve(specifier));
  } catch {
    // The subpath may only exist under a condition this process does not satisfy. The map below decides.
  }
  try {
    const { name, subpath } = packageNameOf(specifier);
    /*
     * Walked up from a file inside the package rather than resolved as a subpath. A package whose exports
     * map carries a wildcard maps `package.json` through it too, so asking for it by name returned the
     * manifest of a build directory: no exports at all, and the whole map invisible.
     */
    const manifestPath = manifestAbove([...found][0], name);
    if (manifestPath === undefined) return [...found].filter((path) => existsSync(path));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    const matched = exportEntryFor(manifest.exports ?? {}, subpath);
    const relative = new Set<string>();
    if (matched !== undefined) buildsIn(matched.entry, relative);
    for (const entry of relative) {
      found.add(resolve(dirname(manifestPath), entry.replaceAll('*', matched?.wildcard ?? '')));
    }
  } catch {
    // No readable manifest. Whatever `require.resolve` found is all there is.
  }
  return [...found].filter((path) => existsSync(path));
};

const toolNameOf = (parameters: unknown): string | undefined => {
  if (typeof parameters !== 'object' || parameters === null) return undefined;
  const name = (parameters as ToolCall).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
};

/**
 * Wraps `callTool` so the call is timed and named, and so nothing else about it changes.
 *
 * The original is called with the original arguments and its promise is returned untouched, including a
 * rejection. A tool that failed is a span with an error status, not a swallowed error.
 */
type CallTool = (this: unknown, ...args: unknown[]) => Promise<unknown>;

const wrapCallTool = (original: CallTool, tracer: Tracer): CallTool =>
  async function instrumentedCallTool(this: unknown, ...args: unknown[]) {
    const name = toolNameOf(args[0]);
    if (name === undefined) return original.apply(this, args);
    const span = tracer.start({
      name: `execute_tool ${name}`,
      kind: SPAN_KIND_CLIENT,
      attributes: { [MCP.toolName]: name, [MCP.methodName]: 'tools/call' },
    });
    try {
      const result = await tracer.within(span, () => original.apply(this, args));
      span.end('ok');
      return result;
    } catch (error) {
      span.end('error', error instanceof Error ? error.message : 'the tool call failed');
      throw error;
    }
  };

export type McpPatchOptions = {
  readonly tracer: Tracer;
  readonly directory: string;
  /**
   * Resolving and loading every build of the module, as one step, so a test can hand over a stand in for a
   * package it does not install. An empty list means the target does not depend on it.
   */
  readonly load?: (specifier: string) => Promise<readonly unknown[]>;
};

/**
 * Loads every build independently, because one of them failing is not the others failing.
 *
 * A package can ship a build this runtime cannot load: a CommonJS entry that is really an ES module, or a
 * bundle for another platform. Loading them together meant one such file disabled instrumentation for the
 * whole package, which is the tool refusing to do the part of its job it could still do.
 */
const loadFromTarget =
  (directory: string) =>
  async (specifier: string): Promise<readonly unknown[]> => {
    const settled = await Promise.allSettled(
      resolveFrom(directory, specifier).map((path) => import(pathToFileURL(path).href)),
    );
    return settled
      .filter((outcome) => outcome.status === 'fulfilled')
      .map((outcome) => (outcome as PromiseFulfilledResult<unknown>).value);
  };

/**
 * Patches one loaded build, or reports that it was not the shape this build knows.
 *
 * Every step is checked rather than assumed, including that `Client` has a prototype at all. An export
 * named `Client` that is a plain object made this throw, and the throw crossed back out through the caller
 * and left the run with no report of what happened: the exact silence this file exists to prevent, written
 * into the file that prevents it.
 */
const patchOne = (loaded: unknown, tracer: Tracer): boolean => {
  if (typeof loaded !== 'object' || loaded === null) return false;
  // The export is named by the package, not by this repository, so it is read by key rather than by field.
  const client = (loaded as Record<string, unknown>)['Client'];
  if (typeof client !== 'function' && (typeof client !== 'object' || client === null)) return false;
  const prototype = (client as ClientClass).prototype;
  if (typeof prototype !== 'object' || prototype === null) return false;
  const original = prototype.callTool;
  if (typeof original !== 'function') return false;
  prototype.callTool = wrapCallTool(original as CallTool, tracer);
  return true;
};

export const patchMcpClient = async (options: McpPatchOptions): Promise<PatchOutcome> => {
  let builds: readonly unknown[];
  try {
    builds = await (options.load ?? loadFromTarget(options.directory))(CLIENT_MODULE);
  } catch (error) {
    return {
      patched: false,
      target: CLIENT_MODULE,
      reason: error instanceof Error ? error.message : 'the module could not be loaded',
    };
  }
  if (builds.length === 0) {
    return { patched: false, target: CLIENT_MODULE, reason: 'the target does not depend on it' };
  }
  let patched = 0;
  for (const build of builds) {
    try {
      if (patchOne(build, options.tracer)) patched += 1;
    } catch {
      // A build whose shape surprised this one is a build left alone, not a run brought down.
    }
  }
  if (patched === 0) {
    return {
      patched: false,
      target: CLIENT_MODULE,
      reason: 'Client.prototype.callTool is not the shape this build knows',
    };
  }
  return { patched: true, target: CLIENT_MODULE };
};
