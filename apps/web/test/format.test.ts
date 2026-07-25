/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatArgv,
  formatBytes,
  formatDuration,
  formatInteger,
  formatMetricValue,
  formatNumber,
  formatPercent,
  formatSourceLocation,
  formatTimestamp,
  humanise,
  pluralise,
  quoteArg,
} from '../src/format.ts';

describe('formatInteger and formatNumber', () => {
  it('groups thousands without depending on a locale', () => {
    assert.equal(formatInteger(1234567), '1 234 567');
    assert.equal(formatInteger(-4321), '-4 321');
    assert.equal(formatInteger(0), '0');
  });

  it('renders a non finite value as a word rather than as NaN', () => {
    assert.equal(formatInteger(Number.NaN), 'unknown');
    assert.equal(formatNumber(Number.POSITIVE_INFINITY), 'unknown');
  });

  it('keeps integers integral and rounds fractions to the requested precision', () => {
    assert.equal(formatNumber(1000), '1 000');
    assert.equal(formatNumber(1234.5678), '1 234.57');
    assert.equal(formatNumber(-0.5, 1), '-0.5');
  });
});

describe('formatDuration', () => {
  it('picks a unit by magnitude', () => {
    assert.equal(formatDuration(0.25), '0.250 ms');
    assert.equal(formatDuration(12.34), '12.3 ms');
    assert.equal(formatDuration(1500), '1.50 s');
    assert.equal(formatDuration(90_000), '1 min 30.0 s');
  });

  it('reports a non finite duration as unknown', () => {
    assert.equal(formatDuration(Number.NaN), 'unknown');
  });
});

describe('formatMetricValue', () => {
  it('recognises units it can render better', () => {
    assert.equal(formatMetricValue(1500, 'ms'), '1.50 s');
    assert.equal(formatMetricValue(0.25, 'ratio'), '25.0%');
    assert.equal(formatMetricValue(12.5, 'percent'), '12.5%');
    assert.equal(formatMetricValue(2048, 'bytes'), '2.0 KiB');
  });

  it('appends any other unit verbatim', () => {
    assert.equal(formatMetricValue(4, 'tool calls'), '4 tool calls');
  });

  it('does not repeat a unit it has already rendered', () => {
    assert.equal(formatMetricValue(10, 'ms').endsWith('ms ms'), false);
  });
});

describe('formatPercent and formatBytes', () => {
  it('treats the input of formatPercent as a fraction', () => {
    assert.equal(formatPercent(0.153), '15.3%');
    assert.equal(formatPercent(1), '100.0%');
  });

  it('scales bytes to binary units', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024 * 1024), '1.0 MiB');
  });
});

describe('humanise', () => {
  it('turns a snake case token into a sentence', () => {
    assert.equal(humanise('agent_group'), 'Agent group');
    assert.equal(humanise('model_interpreted'), 'Model interpreted');
    assert.equal(humanise('tool'), 'Tool');
  });

  it('leaves an empty token alone', () => {
    assert.equal(humanise(''), '');
  });
});

describe('formatTimestamp', () => {
  it('renders the recorded UTC instant without reinterpreting it', () => {
    assert.equal(formatTimestamp('2026-07-24T13:45:06.123Z'), '2026-07-24 13:45:06 UTC');
  });

  it('passes an unrecognised string through unchanged', () => {
    assert.equal(formatTimestamp('yesterday'), 'yesterday');
  });
});

describe('formatSourceLocation', () => {
  it('renders a single line and a range', () => {
    assert.equal(formatSourceLocation('src/a.ts', 10), 'src/a.ts:10');
    assert.equal(formatSourceLocation('src/a.ts', 10, 10), 'src/a.ts:10');
    assert.equal(formatSourceLocation('src/a.ts', 10, 20), 'src/a.ts:10-20');
  });
});

describe('quoteArg and formatArgv', () => {
  it('leaves ordinary arguments unquoted', () => {
    assert.equal(quoteArg('orchescope'), 'orchescope');
    assert.equal(quoteArg('--baseline=run_1'), '--baseline=run_1');
    assert.equal(quoteArg('src/tools/refund.ts'), 'src/tools/refund.ts');
  });

  it('quotes arguments containing whitespace or shell characters', () => {
    assert.equal(quoteArg('two words'), "'two words'");
    assert.equal(quoteArg('a;b'), "'a;b'");
    assert.equal(quoteArg('$(whoami)'), "'$(whoami)'");
  });

  it('escapes an embedded single quote', () => {
    assert.equal(quoteArg("it's"), "'it'\\''s'");
  });

  it('joins an argv with spaces', () => {
    assert.equal(
      formatArgv(['orchescope', 'scenario', 'run', 'happy path']),
      "orchescope scenario run 'happy path'",
    );
  });
});

describe('pluralise', () => {
  it('picks the singular only for exactly one', () => {
    assert.equal(pluralise(1, 'match', 'matches'), '1 match');
    assert.equal(pluralise(0, 'match', 'matches'), '0 matches');
    assert.equal(pluralise(2000, 'match', 'matches'), '2 000 matches');
  });
});
