import process from 'node:process';
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
  install({
    environment: process.env,
    globals: globalThis as unknown as { fetch: typeof globalThis.fetch },
    onBeforeExit: (listener) => process.on('beforeExit', listener),
    setInterval: (body, ms) => setInterval(body, ms),
  });
} catch {
  // A process must not fail on account of being watched.
}
