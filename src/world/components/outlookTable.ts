import { h } from "../lib/dom";
import { formatNumber, formatRange, formatSigned } from "../lib/format";
import type { Category, TercileLegend, WeekWindow } from "../types";
import { tercileBar } from "./tercileBar";

/** One week of one variable, for a region or a single grid cell. */
export interface OutlookRow {
  mean: number;
  p10: number;
  p90: number;
  anom?: number | null;
  chance?: Record<Category, number> | null;
  dry?: boolean;
}

interface TableOptions {
  title: string;
  units: string;
  digits: number;
  weeks: WeekWindow[];
  rows: OutlookRow[];
  legend: TercileLegend;
  hasClimate: boolean;
  selectedWeek: number;
  onWeek: (week: number) => void;
  footnote?: string | null;
}

/** Six-week table: value, range, departure from normal and tercile chances. */
export function outlookTable(options: TableOptions): HTMLElement {
  const { units, digits, legend } = options;
  const head = h(
    "tr",
    {},
    h("th", { scope: "col" }, "Week"),
    h("th", { scope: "col", class: "wtable__num" }, units),
    h("th", { scope: "col", class: "wtable__num" }, "10–90%"),
    options.hasClimate && h("th", { scope: "col", class: "wtable__num" }, "vs normal"),
    options.hasClimate && h("th", { scope: "col" }, "Chance"),
  );
  const body = h("tbody");
  options.rows.forEach((row, index) => {
    const window = options.weeks[index];
    const line = h(
      "tr",
      { class: index === options.selectedWeek ? "is-selected" : "", tabindex: 0 },
      h("th", { scope: "row" }, h("strong", {}, `W${window.week}`), h("span", {}, formatRange(window.valid_start, window.valid_end))),
      h("td", { class: "wtable__num" }, formatNumber(row.mean, digits)),
      h("td", { class: "wtable__num wtable__range" }, `${formatNumber(row.p10, digits)}–${formatNumber(row.p90, digits)}`),
      options.hasClimate && h("td", { class: "wtable__num" }, row.anom == null ? "–" : formatSigned(row.anom, digits)),
      options.hasClimate && h("td", {}, tercileBar(row.chance, legend, row.dry)),
    );
    line.addEventListener("click", () => options.onWeek(index));
    line.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        options.onWeek(index);
      }
    });
    body.append(line);
  });
  const keys = options.hasClimate
    ? h(
        "div",
        { class: "wtable__keys" },
        ...(["below", "near", "above"] as Category[]).map((category) => {
          const mark = h("span", { class: "wtable__key" });
          mark.style.backgroundColor = legend.bar[category];
          return h("span", {}, mark, legend[`${category}_label` as const]);
        }),
      )
    : null;
  return h(
    "section",
    { class: "wtable" },
    h("h3", {}, options.title),
    h("table", {}, h("thead", {}, head), body),
    keys,
    options.footnote ? h("p", { class: "wtable__note" }, options.footnote) : null,
  );
}
