/**
 * Whether the map has room to name what it is drawing.
 *
 * The rule this replaces was arithmetic about a circle: the outermost ring of a drawing fitted into a
 * canvas of height H has a radius of at most H/2, so two neighbours on it have about `2200 / k` pixels
 * between them, a name needs roughly 16 of those, and 2200 / 16 is 137, rounded down to 120. That is a
 * good derivation of the wrong quantity, and two things went wrong with it.
 *
 * It is about a circle. The map now offers a directional layout as well, where the relationship between
 * the node count and the room between neighbours is completely different, and a rule derived from a
 * circumference has nothing to say about a lattice.
 *
 * And it was not true of the circle either. Sixteen pixels is what two names need where they are stacked
 * one above the other, which is what happens at the left and right of a ring. At the top and the bottom
 * of a ring two neighbours are side by side, and there a name needs its own width: the 2994 positioned
 * components in the pinned corpus average 22.7 characters, which is 159 pixels of 11px mono, and the
 * ninetieth percentile is 56 characters. So the ceiling promised that every one of 120 components would
 * be named while a drawing of 26 already printed two names on top of each other. `demo-populated` did
 * exactly that, with `search_policies` under `metering_record_usage`, at the fitted view, in the shipped
 * build.
 *
 * So the room is not computed from a count and a shape. It is computed from the drawing: two names
 * collide when they share a line and their own widths overlap, and the scale at which the last colliding
 * pair comes apart is a property of the coordinates and the names, whatever produced them. That is one
 * rule for every layout, present and future, and it needs no constant per layout.
 *
 * Two scales come out of it, because the canvas makes two different promises. At or beyond `nameEvery`
 * every drawn component carries its name and none may be dropped. Between that and `nameSome` the names
 * with room are drawn and the rest are left out, and which ones those are is worked out here as well
 * rather than left to the renderer's collision grid. Below `nameSome` there is not room for the first
 * characters of a name, and the canvas draws the shape of the system and says so.
 */

/** 11px JetBrains Mono advances 0.6em, and a name starts three pixels past a six pixel node. */
const CHAR_PX = 6.6;
const NAME_OFFSET = 9;

/** A line of 11px type. Two names closer than this across the drawing are one line of words. */
const LINE_PX = 14;

/**
 * The first characters of a name, which is what has to survive for a name to be worth drawing at all.
 * This is the 16 pixels the old derivation used, and it is the one part of it that was right.
 */
const STEM_PX = 16;

/**
 * A node's own radius, and the reason a name has to clear more than other names.
 *
 * Labels are drawn over the nodes, so a name with a node in the middle of it has a hole where two
 * characters were, and in the dark theme the hole is the same near white the name is set in. That is the
 * defect the hover plate had, at the scale of two characters, and it is the same answer: a name a node
 * is drawn through is not a name. It costs nothing on a small drawing, where nothing is in the way, and
 * a great deal on a dense one, where the honest count of readable names is the smaller number.
 */
const NODE_RADIUS_PX = 6;

export interface DrawnName {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Characters in the displayed name, which decides how far its label reaches to the right. */
  readonly chars: number;
  /**
   * How many relations touch this component. Where two names cannot both be drawn the busier one keeps
   * its own, because the map puts the busiest at the middle of the drawing and it is what a reader looks
   * for first. Ties break on the identifier, so which name survives cannot depend on arrival order.
   */
  readonly weight: number;
}

export interface NameRoom {
  /** Pixels per layout unit at which every name is clear. Infinite when two nodes share a point. */
  readonly nameEvery: number;
  /** Pixels per layout unit at which a name's first characters are clear. */
  readonly nameSome: number;
}

const nameWidth = (chars: number): number => NAME_OFFSET + CHAR_PX * chars;

/** The scale at which a gap of `apart` layout units becomes at least `needs` pixels. */
const scaleFor = (apart: number, needs: number): number =>
  apart === 0 ? Number.POSITIVE_INFINITY : needs / Math.abs(apart);

/**
 * The scale at which one name comes clear of another name and of that other name's node.
 *
 * Two names overlap while they are closer than a line of type across the drawing and their own widths
 * still meet along it, and each pair comes apart at whichever of those two happens first. A node spoils
 * a name while it is within half a line plus its own radius of it and still inside its width. Both have
 * to be settled, so the pair needs the larger of the two.
 */
function pairNeeds(one: DrawnName, other: DrawnName, width: (chars: number) => number): number {
  const down = other.y - one.y;
  const across = other.x - one.x;
  const labels = Math.min(
    scaleFor(down, LINE_PX),
    across > 0
      ? scaleFor(across, width(one.chars))
      : across < 0
        ? scaleFor(across, width(other.chars))
        : Number.POSITIVE_INFINITY,
  );
  const line = LINE_PX / 2 + NODE_RADIUS_PX;
  // A node to the left of a name only has to clear its own radius; one to the right has to clear the
  // whole name. Either way the two come apart vertically at the same distance.
  const discs = Math.min(
    scaleFor(down, line),
    Math.max(
      across > 0
        ? scaleFor(across, width(one.chars) + NODE_RADIUS_PX)
        : scaleFor(across, NODE_RADIUS_PX),
      across < 0
        ? scaleFor(across, width(other.chars) + NODE_RADIUS_PX)
        : scaleFor(across, NODE_RADIUS_PX),
    ),
  );
  return Math.max(labels, discs);
}

/**
 * The smallest scale at which every one of these names is clear of every other name and every node.
 *
 * Sorting by y lets the search stop early: further down the list the vertical distance only grows, so
 * the scale that pair needs only falls.
 */
function clearScale(names: readonly DrawnName[], width: (chars: number) => number): number {
  if (names.length < 2) {
    return 0;
  }
  const sorted = [...names].sort((left, right) => left.y - right.y);
  let needed = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const one = sorted[i];
    if (one === undefined) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const other = sorted[j];
      if (other === undefined) continue;
      const down = other.y - one.y;
      const apartVertically = down === 0 ? Number.POSITIVE_INFINITY : LINE_PX / down;
      if (apartVertically <= needed) break;
      needed = Math.max(needed, pairNeeds(one, other, width));
    }
  }
  return needed;
}

export function nameRoom(names: readonly DrawnName[]): NameRoom {
  return {
    nameEvery: clearScale(names, nameWidth),
    nameSome: clearScale(names, () => STEM_PX),
  };
}

/**
 * Which of these names can be drawn at this scale without one landing on another.
 *
 * Between the two scales in `NameRoom` some names fit and some do not, and something has to choose. The
 * renderer has a collision grid of its own for this, and it is a grid: it reserves a cell the width of a
 * name and drops everything else that falls in it, which on the demonstration leaves out six names where
 * two had to go. This works the same question out exactly, by walking the names busiest first and
 * keeping each one whose label is still clear of the ones already kept.
 */
export function clearNames(names: readonly DrawnName[], scale: number): ReadonlySet<string> {
  const kept = new Set<string>();
  if (!Number.isFinite(scale) || scale <= 0) {
    return kept;
  }
  const placed = new Map<number, Label[]>();
  // Every node is in the way, not only the ones whose names were kept: a node is drawn whether or not
  // it carries a name.
  const discs = new Map<number, { x: number; y: number }[]>();
  for (const name of names) {
    const point = { x: name.x * scale, y: name.y * scale };
    const band = Math.floor(point.y / LINE_PX);
    const bucket = discs.get(band);
    if (bucket === undefined) discs.set(band, [point]);
    else bucket.push(point);
  }
  const ordered = [...names].sort(
    (left, right) =>
      right.weight - left.weight || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  for (const name of ordered) {
    const label = {
      y: name.y * scale,
      from: name.x * scale,
      to: name.x * scale + nameWidth(name.chars),
    };
    if (!isClear(label, placed, discs)) continue;
    kept.add(name.id);
    const band = Math.floor(label.y / LINE_PX);
    const bucket = placed.get(band);
    if (bucket === undefined) placed.set(band, [label]);
    else bucket.push(label);
  }
  return kept;
}

interface Label {
  readonly from: number;
  readonly to: number;
  readonly y: number;
}

/** Whether this label has a name already kept, or any node at all, drawn through it. */
function isClear(
  label: Label,
  placed: ReadonlyMap<number, readonly Label[]>,
  discs: ReadonlyMap<number, readonly { x: number; y: number }[]>,
): boolean {
  const band = Math.floor(label.y / LINE_PX);
  for (let nearby = band - 2; nearby <= band + 2; nearby += 1) {
    for (const other of placed.get(nearby) ?? []) {
      if (Math.abs(other.y - label.y) < LINE_PX && label.from < other.to && other.from < label.to) {
        return false;
      }
    }
    for (const disc of discs.get(nearby) ?? []) {
      if (
        Math.abs(disc.y - label.y) < LINE_PX / 2 + NODE_RADIUS_PX &&
        disc.x > label.from + NODE_RADIUS_PX &&
        disc.x < label.to + NODE_RADIUS_PX
      ) {
        return false;
      }
    }
  }
  return true;
}

/** `scale` is pixels per layout unit at the camera's current position. */
export function namesFit(scale: number, room: NameRoom): boolean {
  return Number.isFinite(scale) && scale > 0 && scale >= room.nameSome;
}

/** True when every drawn name is clear, so none of them may be dropped by a collision grid. */
export function namesAllFit(scale: number, room: NameRoom): boolean {
  return Number.isFinite(scale) && scale > 0 && scale >= room.nameEvery;
}

/**
 * How far a reader has to close in before every name arrives, as a multiple of the current view.
 *
 * Told to the reader rather than left to be discovered by scrolling, because the alternative is a note
 * that says names are possible without saying what makes them appear. A drawing that can never name
 * everything, because two components share a coordinate, reports no magnification at all.
 */
export function zoomForNames(scale: number, room: NameRoom): number | null {
  if (!Number.isFinite(room.nameEvery) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  return room.nameEvery <= scale ? 1 : room.nameEvery / scale;
}
