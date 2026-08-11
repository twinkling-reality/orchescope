/**
 * The whole loop in one command, against the bundled demonstration system.
 *
 * The product's claim is the delta between what a repository declares and what a run exercises, and seeing it takes
 * three commands in a fixed order: map the system, run it once, map it again. Anyone refining the terminal document
 * runs that sequence dozens of times, and typing it out invites the mistake that wastes a cycle: auditing on top of a
 * previous run so the before state is already gone.
 *
 * This script is framing and nothing else. The two audits print their own output because that output is the interface
 * under review, and a tour that reformatted it would be reviewing itself. What it does hide is the demonstration
 * system's own chatter while it runs. That is captured and reduced to one line, and `--verbose` streams everything
 * instead.
 */

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = join(root, 'apps/demo');
const cli = join(root, 'apps/cli/src/main.ts');

const verbose = process.argv.includes('--verbose');
const keep = process.argv.includes('--keep');

const colour = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const style = {
  bold: (text) => (colour ? `\x1b[1m${text}\x1b[0m` : text),
  dim: (text) => (colour ? `\x1b[2m${text}\x1b[0m` : text),
  good: (text) => (colour ? `\x1b[32m${text}\x1b[0m` : text),
};

const TOTAL = 4;
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];

/**
 * A step heading. The command is shown as it would be typed rather than as it was resolved: the point of the tour is
 * that a reader can run any line of it themselves, and an absolute path to a Homebrew node binary teaches nothing.
 */
const heading = (index, title, typed) => {
  process.stdout.write(`\n${style.bold(`${index}/${TOTAL}  ${title}`)}\n`);
  if (typed !== undefined) process.stdout.write(`${style.dim(`      ${typed}`)}\n`);
};

/** Animates only while work runs, and only where an animation can be erased. */
const spinner = (label) => {
  if (!process.stdout.isTTY) {
    process.stdout.write(`      ${label}\n`);
    // Nothing to stop and nothing to erase: the label was written once and stays where it was written.
    return () => undefined;
  }
  let frame = 0;
  const tick = setInterval(() => {
    process.stdout.write(`\r\x1b[2K      ${FRAMES[frame % FRAMES.length]} ${label}`);
    frame += 1;
  }, 80);
  return () => {
    clearInterval(tick);
    process.stdout.write('\r\x1b[2K');
  };
};

const streamed = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exited with ${code}`))));
  });

const captured = (command, args, label) =>
  new Promise((resolve, reject) => {
    const stop = spinner(label);
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', (error) => {
      stop();
      reject(error);
    });
    child.on('exit', (code) => {
      stop();
      if (code === 0) resolve(out);
      else reject(new Error(`exited with ${code}\n${err || out}`));
    });
  });

const done = (detail) => process.stdout.write(`      ${style.good('done')}  ${detail}\n`);

const orchescope = (...args) => [process.execPath, [cli, ...args]];
const typed = (...args) => `orchescope ${args.join(' ')}`;
const here = (path) => relative(root, path);

process.stdout.write(`\n${style.bold('Orchescope tour')}\n`);
process.stdout.write(
  `${style.dim('The declared against exercised loop, on the bundled demonstration system.')}\n`,
);

heading(1, 'Start from no runs');
if (keep) {
  done(`kept ${style.dim('apps/demo/.orchescope/state')}, so earlier runs still count`);
} else {
  // Without this the second audit reconciles against a previous tour's run, and the before state is unreachable.
  rmSync(join(demo, '.orchescope/state'), { recursive: true, force: true });
  done(`cleared ${style.dim('apps/demo/.orchescope/state')}`);
}

heading(2, 'Map it, with no run to compare against', typed('--cwd', here(demo), 'audit'));
await streamed(...orchescope('--cwd', demo, 'audit'));

heading(
  3,
  'Run it once and collect its spans',
  typed('--cwd', here(demo), 'trace', '--', 'node', here(join(demo, 'src/main.ts'))),
);
const traceArgs = ['--cwd', demo, 'trace', '--', process.execPath, join(demo, 'src/main.ts')];
if (verbose) {
  await streamed(...orchescope(...traceArgs));
} else {
  const out = await captured(
    ...orchescope('--json', ...traceArgs),
    'running the demonstration system',
  );
  const data = JSON.parse(out).data;
  const services = data.services.length;
  done(
    `${data.spanCount} span(s) from ${services} service(s), run ${style.dim(data.runId)}` +
      (data.spanCount === 0
        ? '\n      the run produced no spans, so the next audit has nothing to join'
        : ''),
  );
}

heading(4, 'Map it again, now against that run', typed('--cwd', here(demo), 'audit'));
await streamed(...orchescope('--cwd', demo, 'audit'));

if (!verbose) {
  process.stdout.write(`\n${style.dim('Run with --verbose to see every command in full.')}\n`);
}
