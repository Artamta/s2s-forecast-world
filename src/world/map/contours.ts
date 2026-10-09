/** Isolines of a regular grid of values by marching squares. */

/** Where a level crosses the edge between two corner values, as a 0-1 share of the edge. */
function crossing(a: number, b: number, level: number): number {
  return (level - a) / (b - a);
}

/**
 * Line segments [x1, y1, x2, y2, ...] in grid coordinates where the field equals `level`.
 * Cells with a missing corner are skipped.
 */
export function contourSegments(values: Float32Array, cols: number, rows: number, level: number): number[] {
  const segments: number[] = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const nw = values[row * cols + col];
      const ne = values[row * cols + col + 1];
      const sw = values[(row + 1) * cols + col];
      const se = values[(row + 1) * cols + col + 1];
      if (Number.isNaN(nw + ne + sw + se)) continue;
      const index = (nw >= level ? 8 : 0) | (ne >= level ? 4 : 0) | (se >= level ? 2 : 0) | (sw >= level ? 1 : 0);
      if (index === 0 || index === 15) continue;
      const top: [number, number] = [col + crossing(nw, ne, level), row];
      const right: [number, number] = [col + 1, row + crossing(ne, se, level)];
      const bottom: [number, number] = [col + crossing(sw, se, level), row + 1];
      const left: [number, number] = [col, row + crossing(nw, sw, level)];
      const add = (a: [number, number], b: [number, number]): void => {
        segments.push(a[0], a[1], b[0], b[1]);
      };
      switch (index) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 5: add(left, top); add(bottom, right); break;
        default: add(top, right); add(left, bottom); break;
      }
    }
  }
  return segments;
}
