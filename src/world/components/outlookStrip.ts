import { h } from "../lib/dom";
import { tercileColor } from "../map/shading";
import type { Category, TercileLegend } from "../types";

const GLYPH: Record<Category | "none", string> = { below: "▼", near: "●", above: "▲", none: "–" };

/** One week of one variable, reduced to what the strip shows. */
export interface StripCell {
  dominant: Category | "none" | null;
  chance: number | null;
  value: string;
  dry: boolean;
}

export function inkOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance = 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
  return luminance > 150 ? "#1c2b36" : "#ffffff";
}

function weekRanges(weeks: number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < weeks.length; index += 1) {
    let end = index;
    while (end + 1 < weeks.length && weeks[end + 1] === weeks[end] + 1) end += 1;
    parts.push(end > index ? `${weeks[index]}–${weeks[end]}` : `${weeks[index]}`);
    index = end;
  }
  const label = weeks.length > 1 ? "weeks" : "week";
  return `${label} ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}`;
}

/** One sentence: which weeks lean which way with at least an even chance. */
export function headline(cells: StripCell[], legend: TercileLegend): string {
  const leaning = (category: Category): number[] =>
    cells.flatMap((cell, index) => (cell.dominant === category && (cell.chance ?? 0) >= 50 ? [index + 1] : []));
  const [below, above] = [leaning("below"), leaning("above")];
  const parts: string[] = [];
  if (below.length) parts.push(`${legend.below_label} than normal in ${weekRanges(below)}`);
  if (above.length) parts.push(`${legend.above_label.toLowerCase()} than normal in ${weekRanges(above)}`);
  if (!parts.length) return "No clear lean in any week.";
  const text = parts.join("; ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

interface StripOptions {
  cells: StripCell[];
  legend: TercileLegend;
  selected: number;
  onWeek: (week: number) => void;
}

/** Six week tiles: the likeliest category, its chance and the departure from normal. */
export function outlookStrip(options: StripOptions): HTMLElement {
  const { legend } = options;
  const names: Record<Category | "none", string> = {
    below: `${legend.below_label} than normal`,
    near: legend.near_label,
    above: `${legend.above_label} than normal`,
    none: "No clear lean",
  };
  const strip = h("div", { class: "wstrip2", role: "group" });
  options.cells.forEach((cell, index) => {
    const known = cell.dominant !== null && cell.chance !== null;
    const color = known ? tercileColor({ category: cell.dominant as Category | "none", chance: cell.chance as number }, legend) : legend.near;
    const text = cell.dry ? "dry" : known ? `${GLYPH[cell.dominant as Category | "none"]} ${cell.chance}%` : "–";
    const tile = h("span", { class: "wstrip2__tile" }, text);
    tile.style.backgroundColor = color;
    tile.style.color = inkOn(color);
    const summary = cell.dry
      ? "dry season, no outlook"
      : known
        ? `${names[cell.dominant as Category | "none"]} most likely, ${cell.chance}%`
        : "no outlook";
    const button = h(
      "button",
      { type: "button", class: `wstrip2__week${index === options.selected ? " is-selected" : ""}`, title: `Week ${index + 1}: ${summary}; ${cell.value}`, "aria-pressed": String(index === options.selected) },
      h("span", { class: "wstrip2__label" }, `W${index + 1}`),
      tile,
      h("span", { class: "wstrip2__value" }, cell.value),
    );
    button.addEventListener("click", () => options.onWeek(index));
    strip.append(button);
  });
  return strip;
}
