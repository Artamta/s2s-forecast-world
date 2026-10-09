import { GEO_ROOT, loadJson } from "../lib/data";
import type { DetailIndex, EncodedLines } from "../types";
import { decodeLines, type Line } from "./lines";
import { visibleBox, type Viewport } from "./viewport";

const DETAIL_SCALE = 9;

/** Coastlines, borders and region outlines, loaded as the map needs them. */
export class Geography {
  coast: Line[] = [];
  borders: Line[] = [];
  private index: DetailIndex | null = null;
  private readonly tiles = new Map<string, Line[] | "loading">();
  private readonly outlines = new Map<string, Promise<Line[]>>();
  private readonly listeners = new Set<() => void>();

  async load(): Promise<void> {
    const [base, index] = await Promise.all([
      loadJson<EncodedLines>(`${GEO_ROOT}base.json`),
      loadJson<DetailIndex>(`${GEO_ROOT}detail/index.json`),
    ]);
    this.coast = decodeLines(base.coast, base.quantum);
    this.borders = decodeLines(base.borders, base.quantum);
    this.index = index;
  }

  /** Call back whenever a detail tile arrives, so maps can redraw. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  outline(regionId: string): Promise<Line[]> {
    if (!this.outlines.has(regionId)) {
      this.outlines.set(
        regionId,
        loadJson<EncodedLines>(`${GEO_ROOT}regions/${regionId}.json`)
          .then((document) => decodeLines(document.outline, document.quantum))
          .catch(() => []),
      );
    }
    return this.outlines.get(regionId) as Promise<Line[]>;
  }

  /** Detailed coast for a zoomed-in view, or null until every needed tile is in. */
  detailedCoast(viewport: Viewport): Line[] | null {
    if (!this.index || viewport.scale < DETAIL_SCALE) return null;
    const box = visibleBox(viewport);
    const size = this.index.tile_degrees;
    const lines: Line[] = [];
    let complete = true;
    for (const tile of this.index.tiles) {
      if (tile.south + size < box.south || tile.south > box.north) continue;
      const visible = [-360, 0, 360, 720].some(
        (shift) => tile.west + size + shift >= box.west && tile.west + shift <= box.east,
      );
      if (!visible) continue;
      const loaded = this.tiles.get(tile.path);
      if (loaded === undefined) this.fetchTile(tile.path);
      if (Array.isArray(loaded)) lines.push(...loaded);
      else complete = false;
    }
    return complete ? lines : null;
  }

  private fetchTile(path: string): void {
    this.tiles.set(path, "loading");
    loadJson<EncodedLines>(`${GEO_ROOT}${path}`)
      .then((document) => {
        this.tiles.set(path, decodeLines(document.coast, document.quantum));
        this.listeners.forEach((listener) => listener());
      })
      .catch(() => this.tiles.set(path, []));
  }
}
