/**
 * The surface behind the name of a hovered or selected node.
 *
 * This is the one thing the canvas draws whose colours the library chooses rather than reading from
 * ours. Sigma's `drawDiscNodeHover` fills the plate with `#FFF` and casts an eight pixel `#000` shadow
 * under it, both written into the library. The text on top of it is the one part sigma does take from
 * us, so in the dark theme the result is `--ink` at `#e9ecf2` on a white plate: the name is there and
 * cannot be read. Nothing else in this design system casts a shadow either.
 *
 * The geometry here is sigma's, because the shape is right: a plate that grows out of the node's own
 * disc keeps a name attached to the thing it names. The colours are the palette's. `--sheet` is the
 * token for a surface that has to separate from the page, and the canvas is painted in `--sheet` too,
 * so the plate is separated by `--rule`, the same hairline that separates every other panel, rather
 * than by a shadow.
 *
 * A plate is drawn only when there is a name to put in it. Above the naming ceiling the canvas
 * suppresses labels, and sigma still draws its plate around the empty string, which is five pixels of
 * white in the middle of a dark drawing: an artefact of the same defect rather than a hover.
 */

/** Room between the name and the plate's edge. Sigma's own value, kept so the plate still fits it. */
const PADDING = 2;

/** One device pixel at every pixel ratio: sigma scales the 2D context, so this is the page's hairline. */
const HAIRLINE = 1;

/**
 * The drawing surface, named by what this module uses rather than taken from the browser's own type.
 *
 * `apps/web/src/**\/*.ts` is compiled under the Node configuration as well as the browser one, because
 * `pnpm states` imports the naming ceiling and the delta bar out of it, so a module here cannot depend
 * on the DOM library. Writing the surface out also states the whole of what this renderer touches: no
 * shadow property appears, so none can be left set for whatever draws next.
 *
 * A fill is a string here and a gradient or a pattern in the browser, so the property is widened to
 * accept what a real context declares while still refusing a number.
 */
export interface LabelSurface {
  font: string;
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  measureText(text: string): { readonly width: number };
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
}

export interface HoverLabel {
  readonly x: number;
  readonly y: number;
  /** The node's drawn radius, which the plate has to grow out of rather than sit on top of. */
  readonly nodeSize: number;
  readonly label: string;
  readonly font: string;
  readonly labelSize: number;
  readonly labelWeight: string;
  /** `--sheet`, `--rule` and `--ink` as the theme in force resolves them. */
  readonly sheet: string;
  readonly hairline: string;
  readonly ink: string;
}

export function drawHoverLabel(context: LabelSurface, hover: HoverLabel): void {
  if (hover.label === '') {
    return;
  }
  context.font = `${hover.labelWeight} ${hover.labelSize}px ${hover.font}`;
  const boxWidth = Math.round(context.measureText(hover.label).width + 5);
  const boxHeight = Math.round(hover.labelSize + 2 * PADDING);
  // The arc has to be at least as tall as the plate or it cannot meet its edges, which is why the
  // half height is a floor here and not only the node's radius.
  const radius = Math.max(hover.nodeSize, boxHeight / 2) + PADDING;
  const angle = Math.asin(boxHeight / 2 / radius);
  const xDelta = Math.sqrt(Math.abs(radius ** 2 - (boxHeight / 2) ** 2));

  context.beginPath();
  context.moveTo(hover.x + xDelta, hover.y + boxHeight / 2);
  context.lineTo(hover.x + radius + boxWidth, hover.y + boxHeight / 2);
  context.lineTo(hover.x + radius + boxWidth, hover.y - boxHeight / 2);
  context.lineTo(hover.x + xDelta, hover.y - boxHeight / 2);
  context.arc(hover.x, hover.y, radius, angle, -angle);
  context.closePath();
  context.fillStyle = hover.sheet;
  context.fill();
  context.lineWidth = HAIRLINE;
  context.strokeStyle = hover.hairline;
  context.stroke();

  context.fillStyle = hover.ink;
  context.fillText(hover.label, hover.x + hover.nodeSize + 3, hover.y + hover.labelSize / 3);
}
