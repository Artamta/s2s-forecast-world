import { h } from "../lib/dom";
import { formatNumber, formatRange, formatSigned } from "../lib/format";
import type { WeekWindow } from "../types";

/** One week of one variable for a region. */
export interface WeekRow {
  mean: number;
  p10: number;
  p90: number;
  anom?: number | null;
}

interface TableOptions {
  units: string;
  digits: number;
  weeks: WeekWindow[];
  rows: WeekRow[];
  hasClimate: boolean;
}

/** Six-week table: the ensemble mean, its 10-90% range and the departure from normal. */
export function weekTable(options: TableOptions): HTMLElement {
  const { units, digits } = options;
  const head = h(
    "tr",
    {},
    h("th", { scope: "col" }, "Week"),
    h("th", { scope: "col", class: "wtable__num" }, units),
    h("th", { scope: "col", class: "wtable__num" }, "10–90% of members"),
    options.hasClimate && h("th", { scope: "col", class: "wtable__num" }, "Anomaly"),
  );
  const body = h("tbody");
  options.rows.forEach((row, index) => {
    const window = options.weeks[index];
    body.append(
      h(
        "tr",
        {},
        h("th", { scope: "row" }, h("strong", {}, `W${window.week}`), h("span", {}, formatRange(window.valid_start, window.valid_end))),
        h("td", { class: "wtable__num" }, formatNumber(row.mean, digits)),
        h("td", { class: "wtable__num wtable__range" }, `${formatNumber(row.p10, digits)}–${formatNumber(row.p90, digits)}`),
        options.hasClimate && h("td", { class: "wtable__num" }, row.anom == null ? "–" : formatSigned(row.anom, digits)),
      ),
    );
  });
  return h("div", { class: "wtable" }, h("table", {}, h("thead", {}, head), body));
}
