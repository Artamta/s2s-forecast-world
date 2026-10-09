import { h } from "../lib/dom";
import type { Category, TercileLegend } from "../types";

const ORDER: Category[] = ["below", "near", "above"];
const INSIDE_LABEL_MINIMUM = 22;

function inkOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance = 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
  return luminance > 150 ? "#102d3c" : "#ffffff";
}

/** Three-part bar of the chances of below, near and above normal. */
export function tercileBar(
  chance: Record<Category, number> | null | undefined,
  legend: TercileLegend,
  dry = false,
): HTMLElement {
  if (dry) return h("span", { class: "wterc wterc--empty" }, "Dry season");
  if (!chance) return h("span", { class: "wterc wterc--empty" }, "–");
  const names: Record<Category, string> = {
    below: legend.below_label,
    near: legend.near_label,
    above: legend.above_label,
  };
  const summary = ORDER.map((category) => `${names[category]} ${Math.round(chance[category])}%`).join(", ");
  const bar = h("span", { class: "wterc", role: "img", "aria-label": summary, title: summary });
  for (const category of ORDER) {
    const share = Math.round(chance[category]);
    if (share <= 0) continue;
    const segment = h("span", { class: "wterc__part" }, share >= INSIDE_LABEL_MINIMUM ? `${share}` : "");
    segment.style.flexGrow = String(share);
    segment.style.backgroundColor = legend.bar[category];
    segment.style.color = inkOn(legend.bar[category]);
    bar.append(segment);
  }
  return bar;
}
