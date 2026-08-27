import process from 'node:process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from './install.ts';

/**
 * The entry point Node loads through `--import`, and the only module here with a side effect.
 *
 * It is separate from `install` so that everything with behaviour in it can be tested by calling a
 * function with a fake environment, and the one file that reaches for the real process stays this short.
 *
 * The try is the point. This module runs before the target's first line, so an exception thrown here is an
 * exception the target never had a chance to cause and cannot recover from. There is nowhere to report it
 * that is not the target's own output, so a shim that cannot start does not start.
 */

try {
  const installation = install({
    environment: process.env,
    globals: globalThis as unknown as { fetch: typeof globalThis.fetch },
    onBeforeExit: (listener) => process.on('beforeExit', listener),
    setInterval: (body, ms) => setInterval(body, ms),
    directory: process.cwd(),
    /*
     * This module is what `--import` loads, so its own directory is the shim, and a frame inside it is
     * the boundary rather than the caller. Taken from `import.meta.url` so it stays correct in both the
     * bundled build, where everything is one file beside the command line, and the source checkout,
     * where it is several modules in a package this repository also audits.
     */
    instrumentationRoot: dirname(fileURLToPath(import.meta.url)),
  });
  /*
   * Awaited here so every patch is in place before the target's first line. `--import` settles the module
   * it loads, top level await and all, before it loads the entry point, which is the whole reason a patch
   * that has to resolve a package can be applied at all.
   */
  await installation?.patches;
} catch {
  // A process must not fail on account of being watched.
}
