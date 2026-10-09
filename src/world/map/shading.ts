import type { FieldData } from "../lib/data";
import type { BinLegend, Category, TercileLegend } from "../types";

export type Rgb = [number, number, number];
export const NEUTRAL_COLOR = "#eef0f2";

export function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Colour of a value on a stepped legend. */
export function binColor(value: number, legend: BinLegend): string {
  const { boundaries, colors, under, over } = legend;
  if (value < boundaries[0]) return under;
  for (let index = 1; index < boundaries.length; index += 1) {
    if (value < boundaries[index]) return colors[index - 1];
  }
  return over;
}

export interface Outlook {
  category: Category | "none";
  chance: number;
}

/** Most likely tercile from the below and above percentages. */
export function outlookOf(below: number, above: number): Outlook {
  const near = 100 - below - above;
  const chance = Math.max(below, near, above);
  if (below === above && below === chance) return { category: "none", chance };
  if (near === chance) return { category: "near", chance };
  return { category: below === chance ? "below" : "above", chance };
}

export function tercileColor(outlook: Outlook, legend: TercileLegend): string {
  if (outlook.category === "none" || outlook.chance < legend.steps[0]) return legend.none;
  if (outlook.category === "near") return legend.near;
  let step = 0;
  while (step + 1 < legend.steps.length && outlook.chance >= legend.steps[step + 1]) step += 1;
  return legend[outlook.category][step];
}

/** What a map shades: a pixel colour for any position, or null to leave it clear. */
export interface Shader {
  rgbAt(week: number, latitude: number, longitude: number, smooth: boolean): Rgb | null;
}

class ColorTable {
  private readonly cache = new Map<string, Rgb>();
  rgb(hex: string): Rgb {
    let rgb = this.cache.get(hex);
    if (!rgb) {
      rgb = parseHex(hex);
      this.cache.set(hex, rgb);
    }
    return rgb;
  }
}

export function fieldShader(field: FieldData, layer: number, legend: BinLegend): Shader {
  const table = new ColorTable();
  return {
    rgbAt(week, latitude, longitude, smooth) {
      const value = field.sample(layer, week, latitude, longitude, smooth);
      return Number.isNaN(value) ? null : table.rgb(binColor(value, legend));
    },
  };
}

export function tercileShader(field: FieldData, legend: TercileLegend): Shader {
  const table = new ColorTable();
  const [below, above] = [field.layerIndex("below"), field.layerIndex("above")];
  return {
    rgbAt(week, latitude, longitude, smooth) {
      const b = field.sample(below, week, latitude, longitude, smooth);
      const a = field.sample(above, week, latitude, longitude, smooth);
      if (Number.isNaN(a + b)) {
        return isDryAt(field, below, week, latitude, longitude) ? table.rgb(NEUTRAL_COLOR) : null;
      }
      return table.rgb(tercileColor(outlookOf(b, a), legend));
    },
  };
}

function isDryAt(field: FieldData, layer: number, week: number, latitude: number, longitude: number): boolean {
  const row = Math.min(120, Math.max(0, Math.round((90 - latitude) / 1.5)));
  const col = Math.round((((longitude % 360) + 360) % 360) / 1.5) % 240;
  return field.isDry(layer, week, row, col);
}

export function windSpeedShader(field: FieldData, legend: BinLegend): Shader {
  const table = new ColorTable();
  const [u, v] = [field.layerIndex("u"), field.layerIndex("v")];
  return {
    rgbAt(week, latitude, longitude, smooth) {
      const speed = Math.hypot(
        field.sample(u, week, latitude, longitude, smooth),
        field.sample(v, week, latitude, longitude, smooth),
      );
      return Number.isNaN(speed) ? null : table.rgb(binColor(speed, legend));
    },
  };
}
