import { tercileLegendOf, type App, type Issue } from "../lib/app";
import { clear, h } from "../lib/dom";
import { formatNumber, formatRange, formatSigned } from "../lib/format";
import { tercileColor } from "../map/shading";
import type { RegionInfo, SummaryCell, TercileLegend, Variable } from "../types";

const GLYPH = { below: "▼", near: "●", above: "▲", none: "–" } as const;
const UNITS: Record<Variable, { label: string; units: string; digits: number }> = {
  rain: { label: "Rainfall", units: "mm", digits: 0 },
  t2m: { label: "Temperature", units: "°C", digits: 1 },
};

function inkOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance = 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
  return luminance > 150 ? "#102d3c" : "#ffffff";
}

function outlookCell(cell: SummaryCell, legend: TercileLegend, variable: Variable): HTMLElement {
  const { digits, units } = UNITS[variable];
  const value = cell.anom === null ? `${formatNumber(cell.mean, digits)} ${units}` : `${formatSigned(cell.anom, digits)} ${units}`;
  if (cell.dry) return h("td", { class: "wmatrix__cell wmatrix__cell--dry", title: "Dry season: no outlook" }, "dry");
  if (!cell.dominant || cell.chance === null) {
    return h("td", { class: "wmatrix__cell" }, h("span", { class: "wmatrix__value" }, value));
  }
  const names = { below: legend.below_label, near: legend.near_label, above: legend.above_label, none: "No clear signal" };
  const color = tercileColor({ category: cell.dominant, chance: cell.chance }, legend);
  const td = h(
    "td",
    { class: "wmatrix__cell", title: `${names[cell.dominant]} most likely (${cell.chance}%); ensemble mean ${value} vs normal` },
    `${GLYPH[cell.dominant]} ${cell.chance}%`,
  );
  td.style.backgroundColor = color;
  td.style.color = inkOn(color);
  return td;
}

function regionRows(app: App, group: RegionInfo): Array<{ region: RegionInfo; depth: number }> {
  const rows = [{ region: group, depth: 0 }];
  for (const childId of group.children) {
    const child = app.regionById.get(childId) as RegionInfo;
    if (group.id === "world" || child.tier === "C") continue;
    rows.push({ region: child, depth: 1 });
    for (const id of child.children) {
      const part = app.regionById.get(id) as RegionInfo;
      if (part.tier !== "C") rows.push({ region: part, depth: 2 });
    }
  }
  if (group.id === "world") {
    for (const id of group.children) rows.push({ region: app.regionById.get(id) as RegionInfo, depth: 1 });
  }
  return rows;
}

/** Regions by weeks: the most likely category and how likely it is. */
export function renderOutlook(root: HTMLElement, app: App, issue: Issue, openRegion: (regionId: string) => void): () => void {
  let variable: Variable = "rain";
  const start = app.regionById.get(app.regions.default_region) as RegionInfo;
  let groupId = start.kind === "group" ? start.id : start.group;
  const tableHost = h("div", { class: "wmatrix__scroll" });
  const controls = h("div", { class: "wcontrols" });
  root.append(
    h("h2", { class: "wpage__title" }, "Outlook by region"),
    h("p", { class: "wnote" },
      "The most likely category for each region and week, with its chance: ▲ above normal, ● near normal, ▼ below normal. Hover a cell for the departure from normal."),
    controls,
    tableHost,
  );

  function draw(): void {
    const legend = tercileLegendOf(app, variable);
    const group = app.regionById.get(groupId) as RegionInfo;
    const head = h("tr", {}, h("th", { scope: "col" }, "Region"));
    for (const window of issue.manifest.weeks) {
      head.append(h("th", { scope: "col" }, h("strong", {}, `Week ${window.week}`), h("span", {}, formatRange(window.valid_start, window.valid_end))));
    }
    const body = h("tbody");
    for (const { region, depth } of regionRows(app, group)) {
      const cells = issue.summary.regions[region.id]?.[variable];
      if (!cells) continue;
      const open = h("button", { type: "button", class: "wlink" }, region.label);
      open.addEventListener("click", () => openRegion(region.id));
      const label = h("th", { scope: "row", class: `wmatrix__region wmatrix__region--${depth}` }, open, region.tier === "B" && h("span", { class: "wmatrix__flag" }, "coarse"));
      body.append(h("tr", {}, label, ...cells.map((cell) => outlookCell(cell, legend, variable))));
    }
    clear(tableHost);
    tableHost.append(h("table", { class: "wmatrix" }, h("thead", {}, head), body));
  }

  const groups = h("select", { "aria-label": "Part of the world" });
  for (const id of app.regions.groups) {
    groups.append(h("option", { value: id, selected: id === groupId }, (app.regionById.get(id) as RegionInfo).label));
  }
  groups.addEventListener("change", () => {
    groupId = groups.value;
    draw();
  });
  const variables = h("select", { "aria-label": "Variable" });
  for (const key of ["rain", "t2m"] as Variable[]) variables.append(h("option", { value: key }, UNITS[key].label));
  variables.addEventListener("change", () => {
    variable = variables.value as Variable;
    draw();
  });
  controls.append(h("label", {}, h("span", {}, "Area"), groups), h("label", {}, h("span", {}, "Variable"), variables));
  draw();
  root.dataset.ready = "true";
  return () => undefined;
}
