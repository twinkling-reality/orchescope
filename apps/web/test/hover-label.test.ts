import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drawHoverLabel, type HoverLabel, type LabelSurface } from '../src/ui/hover-label.ts';

/**
 * The plate behind a hovered node's name.
 *
 * What these guard is that every colour the plate is painted in came from the palette. Sigma's own
 * renderer writes `#FFF` and `#000` into the library, so the defect was invisible in the light theme
 * and made the name unreadable in the dark one. A recording context is enough to settle that: the
 * question is which values reached the canvas, not what the canvas looked like afterwards.
 */

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

interface Recorder {
  readonly context: LabelSurface;
  readonly calls: readonly Call[];
  readonly assignments: ReadonlyMap<string, unknown>;
}

function recordingContext(textWidth = 96): Recorder {
  const calls: Call[] = [];
  const assignments = new Map<string, unknown>();
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const target: Record<string, unknown> = {
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    measureText: () => ({ width: textWidth }),
  };
  const context = new Proxy(target, {
    set(_receiver, property, value) {
      assignments.set(String(property), value);
      return true;
    },
    get(receiver, property) {
      return receiver[String(property)];
    },
  }) as unknown as LabelSurface;
  return { context, calls, assignments };
}

const LABEL: HoverLabel = {
  x: 100,
  y: 50,
  nodeSize: 6,
  label: 'create_frame_streaming_completion',
  font: '"JetBrains Mono", monospace',
  labelSize: 11,
  labelWeight: '400',
  sheet: '#14171e',
  hairline: '#262b35',
  ink: '#e9ecf2',
};

describe('the plate takes every colour from the palette', () => {
  it('fills with the sheet the theme resolves, never white', () => {
    const recorder = recordingContext();
    drawHoverLabel(recorder.context, LABEL);
    const fills = recorder.calls.filter((call) => call.name === 'fill');
    assert.equal(fills.length, 1);
    assert.equal(recorder.assignments.get('strokeStyle'), LABEL.hairline);
  });

  it('sets the name in the ink, so the last fill style before the text is the ink', () => {
    const recorder = recordingContext();
    drawHoverLabel(recorder.context, LABEL);
    assert.equal(recorder.assignments.get('fillStyle'), LABEL.ink);
    const text = recorder.calls.find((call) => call.name === 'fillText');
    assert.deepEqual(text?.args[0], LABEL.label);
  });

  it('casts no shadow, which nothing else in this design system does either', () => {
    const recorder = recordingContext();
    drawHoverLabel(recorder.context, LABEL);
    assert.equal(recorder.assignments.has('shadowBlur'), false);
    assert.equal(recorder.assignments.has('shadowColor'), false);
    assert.equal(recorder.assignments.has('shadowOffsetX'), false);
  });

  it('separates the plate from the canvas with one hairline', () => {
    const recorder = recordingContext();
    drawHoverLabel(recorder.context, LABEL);
    assert.equal(recorder.assignments.get('lineWidth'), 1);
    assert.equal(recorder.calls.filter((call) => call.name === 'stroke').length, 1);
  });
});

describe('the plate is drawn only when it has a name in it', () => {
  it('draws nothing for a node whose label the naming ceiling suppressed', () => {
    const recorder = recordingContext();
    drawHoverLabel(recorder.context, { ...LABEL, label: '' });
    assert.deepEqual(recorder.calls, []);
    assert.equal(recorder.assignments.size, 0);
  });

  it('still draws for a one character name', () => {
    const recorder = recordingContext(7);
    drawHoverLabel(recorder.context, { ...LABEL, label: 'a' });
    assert.equal(recorder.calls.filter((call) => call.name === 'fill').length, 1);
  });
});

describe('the plate grows out of the node rather than sitting on it', () => {
  it('keeps the arc wide enough to meet the plate at the smallest node the overlay draws', () => {
    const recorder = recordingContext();
    drawHoverLabel(recorder.context, { ...LABEL, nodeSize: 3 });
    const arc = recorder.calls.find((call) => call.name === 'arc');
    const radius = arc?.args[2] as number;
    const angle = arc?.args[3] as number;
    // 11px of text plus two of padding either side is a 15px plate, so an arc under 7.5 could not
    // reach its corners and the angle would be NaN.
    assert.ok(radius >= 7.5, `radius was ${String(radius)}`);
    assert.equal(Number.isFinite(angle), true);
  });

  it('widens with the name, so a long one is not clipped', () => {
    const short = recordingContext(20);
    const long = recordingContext(200);
    drawHoverLabel(short.context, { ...LABEL, label: 'ab' });
    drawHoverLabel(long.context, LABEL);
    const rightEdge = (recorder: Recorder): number =>
      (recorder.calls.find((call) => call.name === 'lineTo')?.args[0] as number) ?? 0;
    assert.ok(rightEdge(long) > rightEdge(short));
  });
});
