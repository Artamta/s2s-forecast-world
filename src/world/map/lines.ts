import type { Viewport } from "./viewport";
import { projectX, projectY, visibleBox, visibleShifts } from "./viewport";

/** A decoded polyline with its bounding box, in degrees. */
export interface Line {
  points: Float32Array;
  west: number;
  east: number;
  south: number;
  north: number;
}

/** Decode [x0, y0, dx, dy, ...] integer deltas into degree coordinates. */
export function decodeLines(encoded: number[][] | undefined, quantum: number): Line[] {
  return (encoded ?? []).map((deltas) => {
    const points = new Float32Array(deltas.length);
    let [x, y] = [0, 0];
    let [west, east, south, north] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let index = 0; index < deltas.length; index += 2) {
      x += deltas[index];
      y += deltas[index + 1];
      const [lon, lat] = [x * quantum, y * quantum];
      points[index] = lon;
      points[index + 1] = lat;
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    return { points, west, east, south, north };
  });
}

/** Add every visible copy of the lines to the current path. */
export function traceLines(context: CanvasRenderingContext2D, viewport: Viewport, lines: Line[]): void {
  const box = visibleBox(viewport);
  for (const line of lines) {
    if (line.north < box.south || line.south > box.north) continue;
    for (const shift of visibleShifts(viewport, line.west, line.east)) {
      const { points } = line;
      context.moveTo(projectX(viewport, points[0] + shift), projectY(viewport, points[1]));
      for (let index = 2; index < points.length; index += 2) {
        context.lineTo(projectX(viewport, points[index] + shift), projectY(viewport, points[index + 1]));
      }
    }
  }
}

export function strokeLines(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  lines: Line[],
  color: string,
  width: number,
): void {
  context.beginPath();
  traceLines(context, viewport, lines);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = "round";
  context.stroke();
}
