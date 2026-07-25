/**
 * Builds the publishable artifact.
 *
 * One bundle, one directory, no compiler on the user's machine. Packages that ship a native binding or a WebAssembly
 * grammar stay external, because they locate their own assets relative to their own package directory and bundling
 * them would break that. Everything else is inlined, and third party licence text is emitted next to the bundle so
 * the attribution travels with it.
 */

import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'apps/cli/dist');

/**
 * Kept external on purpose:
 *  - oxc-parser resolves a platform specific napi binding at runtime
 *  - web-tree-sitter and tree-sitter-python load WebAssembly relative to their own package directory
 */
const external = ['oxc-parser', 'web-tree-sitter', 'tree-sitter-python'];

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'apps/cli/src/main.ts')],
  outfile: join(outputDirectory, 'orchescope.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external,
  legalComments: 'external',
  minify: false,
  sourcemap: false,
  banner: {
    // A CommonJS dependency compiled into an ES module bundle can still call `require` for a Node builtin, and esbuild
    // leaves that call to a shim that throws unless a `require` exists in scope. Creating one from this module's own URL
    // is the supported way to make those calls work in an ES module.
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  metafile: true,
  logLevel: 'warning',
});

const webDist = join(root, 'apps/web/dist');
if (existsSync(join(webDist, 'index.html'))) {
  cpSync(webDist, join(outputDirectory, 'ui'), { recursive: true });
} else {
  console.warn(
    'the browser workspace has not been built, so dist/ui was not created. Run: pnpm build:web',
  );
}

const bundleBytes = statSync(join(outputDirectory, 'orchescope.mjs')).size;
const inputs = Object.keys(result.metafile.inputs).length;
writeFileSync(
  join(outputDirectory, 'build-info.json'),
  `${JSON.stringify(
    {
      bundleBytes,
      inputs,
      external,
      node: process.versions.node,
      esbuild: (await import('esbuild')).version,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `bundled ${inputs} modules into apps/cli/dist/orchescope.mjs (${(bundleBytes / 1024).toFixed(0)} KiB)`,
);
console.log(`external at runtime: ${external.join(', ')}`);
if (existsSync(join(outputDirectory, 'ui', 'index.html'))) {
  console.log('copied the browser workspace into apps/cli/dist/ui');
}
