#!/usr/bin/env node

/**
 * Builds the browser workspace into `apps/web/dist`.
 *
 * Output is deterministic: no timestamps, no build identifiers and no remote references. The emitted
 * `index.html` carries a JSON data block holding the literal placeholder `__ORCHESCOPE_REPORT__`, which
 * the local report server and the standalone exporter replace with one report bundle.
 *
 * Anything substituted into that block must have every `<` escaped as the JSON escape `\\u003c`, so that
 * a string inside the report can never close the script element.
 */

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'apps', 'web');
const srcDir = join(appDir, 'src');
const outDir = join(appDir, 'dist');

const REPORT_ELEMENT_ID = 'orchescope-report';
const REPORT_PLACEHOLDER = '__ORCHESCOPE_REPORT__';

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Orchescope report</title>
    <link rel="stylesheet" href="./app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="application/json" id="${REPORT_ELEMENT_ID}">${REPORT_PLACEHOLDER}</script>
    <script type="module" src="./app.js"></script>
  </body>
</html>
`;

async function buildScript() {
  await build({
    entryPoints: [join(srcDir, 'main.tsx')],
    outfile: join(outDir, 'app.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    sourcemap: 'external',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    logLevel: 'warning',
  });
}

async function buildStyles() {
  await build({
    entryPoints: [join(srcDir, 'styles.css')],
    outfile: join(outDir, 'app.css'),
    bundle: true,
    minify: true,
    sourcemap: 'external',
    loader: { '.css': 'css' },
    logLevel: 'warning',
  });
}

async function report() {
  const names = (await readdir(outDir)).sort();
  const rows = [];
  for (const name of names) {
    const info = await stat(join(outDir, name));
    if (info.isFile()) {
      rows.push({ name, bytes: info.size });
    }
  }
  const width = rows.reduce((longest, row) => Math.max(longest, row.name.length), 0);
  console.log(`Wrote ${relative(root, outDir)}`);
  for (const row of rows) {
    const kib = (row.bytes / 1024).toFixed(1);
    console.log(
      `  ${row.name.padEnd(width)}  ${String(row.bytes).padStart(9)} B  ${kib.padStart(8)} KiB`,
    );
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await buildScript();
  await buildStyles();
  await writeFile(join(outDir, 'index.html'), INDEX_HTML, 'utf8');
  await report();
}

await main();
