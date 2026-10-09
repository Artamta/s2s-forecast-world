import { headline, inkOn, outlookStrip, type StripCell } from "../components/outlookStrip";
import { outlookTable, type OutlookRow } from "../components/outlookTable";
import { plumeChart } from "../components/plumeChart";
import { areaButtons, section, segmented } from "../components/sidebar";
import { areaOf, tercileLegendOf, tierNote, type App, type Issue } from "../lib/app";
import { loadMember } from "../lib/data";
import { clear, h } from "../lib/dom";
import { formatNumber, formatRange, formatSigned } from "../lib/format";
import { writeUrl, type UrlState } from "../lib/url";
import { tercileColor } from "../map/shading";
import type { RegionDocument, RegionInfo, RegionWeekValue, SummaryCell, TercileLegend, Variable } from "../types";

const GLYPH = { below: "▼", near: "●", above: "▲", none: "–" } as const;
const TITLES: Record<Variable, { name: string; table: string; plume: string; units: string; daily: string; digits: number }> = {
  rain: { name: "Rainfall", table: "Weekly total", plume: "Daily rainfall", units: "mm", daily: "mm/day", digits: 0 },
  t2m: { name: "Temperature", table: "Weekly mean", plume: "Daily mean temperature", units: "°C", daily: "°C", digits: 1 },
};

function outlookCell(cell: SummaryCell, legend: TercileLegend, variable: Variable): HTMLElement {
  const { digits, units } = TITLES[variable];
  const value = cell.anom === null ? `${formatNumber(cell.mean, digits)} ${units}` : `${formatSigned(cell.anom, digits)} ${units}`;
  if (cell.dry) return h("td", { class: "wmatrix__cell wmatrix__cell--dry", title: "Dry season: no outlook" }, "dry");
  if (!cell.dominant || cell.chance === null) return h("td", { class: "wmatrix__cell" }, value);
  const names = { below: legend.below_label, near: legend.near_label, above: legend.above_label, none: "No clear lean" };
  const color = tercileColor({ category: cell.dominant, chance: cell.chance }, legend);
  const td = h(
    "td",
    { class: "wmatrix__cell", title: `${names[cell.dominant]} most likely (${cell.chance}%); ${value} against normal` },
    `${GLYPH[cell.dominant]} ${cell.chance}%`,
  );
  td.style.backgroundColor = color;
  td.style.color = inkOn(color);
  return td;
}

function regionRows(app: App, area: RegionInfo): Array<{ region: RegionInfo; depth: number }> {
  const get = (id: string): RegionInfo => app.regionById.get(id) as RegionInfo;
  const rows = [{ region: area, depth: 0 }];
  for (const child of area.children.map(get)) {
    if (area.id !== "world" && child.tier === "C") continue;
    rows.push({ region: child, depth: 1 });
    if (area.id === "world") continue;
    for (const part of child.children.map(get)) if (part.tier !== "C") rows.push({ region: part, depth: 2 });
  }
  return rows;
}

function toRow(value: RegionWeekValue): OutlookRow {
  return { mean: value.mean, p10: value.p10, p90: value.p90, anom: value.anom, chance: value.tercile, dry: value.dry };
}

function toCell(value: RegionWeekValue, variable: Variable): StripCell {
  const { units, digits } = TITLES[variable];
  const tercile = value.tercile ?? null;
  return {
    dominant: tercile ? tercile.dominant : null,
    chance: tercile && tercile.dominant !== "none" ? tercile[tercile.dominant] : null,
    value: value.anom == null ? `${formatNumber(value.mean, digits)} ${units}` : `${formatSigned(value.anom, digits)} ${units}`,
    dry: value.dry ?? false,
  };
}

/** Regions by weeks, with the selected region's numbers and daily charts beside the table. */
export function renderRegions(
  root: HTMLElement,
  app: App,
  issue: Issue,
  url: UrlState,
  openOnMap: (regionId: string) => void,
): () => void {
  let selected = app.regionById.get(url.region ?? "") ?? (app.regionById.get(app.regions.default_region) as RegionInfo);
  let variable: Variable = "rain";
  let week = (url.week ?? 1) - 1;
  let disposed = false;
  const hasClimate = issue.manifest.climate !== null;
  const sidebar = h("aside", { class: "wsb", "aria-label": "Table controls" });
  const tableHost = h("div", { class: "wmatrix__scroll" });
  const detail = h("aside", { class: "wdetail", "aria-live": "polite" });
  root.append(
    h(
      "div",
      { class: "wrg" },
      sidebar,
      h(
        "section",
        { class: "wrg__main" },
        h("div", { class: "wstage__title" },
          h("h2", {}, "Outlook by region"),
          h("p", {}, "Most likely category and its chance: ▲ above normal, ● near normal, ▼ below normal. Select a row for its numbers.")),
        tableHost,
      ),
      detail,
    ),
  );

  function drawSidebar(): void {
    clear(sidebar);
    sidebar.append(
      section("Area", areaButtons(app, areaOf(app, selected).id, (areaId) => select(areaId))),
      section("Variable", segmented("Variable", [{ id: "rain", label: "Rainfall" }, { id: "t2m", label: "Temperature" }], variable, (id) => {
        variable = id as Variable;
        drawSidebar();
        drawTable();
      })),
    );
  }

  function drawTable(): void {
    const legend = tercileLegendOf(app, variable);
    const head = h("tr", {}, h("th", { scope: "col" }, "Region"));
    for (const window of issue.manifest.weeks) {
      head.append(h("th", { scope: "col" }, h("strong", {}, `Week ${window.week}`), h("span", {}, formatRange(window.valid_start, window.valid_end))));
    }
    const body = h("tbody");
    for (const { region, depth } of regionRows(app, areaOf(app, selected))) {
      const cells = issue.summary.regions[region.id]?.[variable];
      if (!cells) continue;
      const open = h("button", { type: "button", class: "wmatrix__name" }, region.label);
      open.addEventListener("click", () => select(region.id));
      const name = h("th", { scope: "row", class: `wmatrix__region wmatrix__region--${depth}` }, open, region.tier === "B" && h("span", { class: "wmatrix__flag" }, "coarse"));
      body.append(h("tr", { class: region.id === selected.id ? "is-selected" : "" }, name, ...cells.map((cell) => outlookCell(cell, legend, variable))));
    }
    clear(tableHost);
    tableHost.append(h("table", { class: "wmatrix" }, h("thead", {}, head), body));
  }

  async function drawDetail(): Promise<void> {
    const region = selected;
    const doc = await loadMember<RegionDocument>(`${issue.base}regions/`, region.id, issue.manifest.generated_at);
    if (disposed || region !== selected) return;
    const note = tierNote(region);
    const show = h("button", { type: "button", class: "wbutton" }, "Show on map");
    show.addEventListener("click", () => openOnMap(region.id));
    clear(detail);
    detail.append(h("div", { class: "wdetail__head" }, h("h2", {}, region.label), show));
    if (note) detail.append(h("p", { class: "wdetail__tier" }, note));
    for (const key of ["rain", "t2m"] as Variable[]) {
      const titles = TITLES[key];
      const legend = tercileLegendOf(app, key);
      const cells = doc.weeks.map((item) => toCell(item[key], key));
      detail.append(
        h(
          "section",
          { class: "wdetail__block" },
          h("h3", {}, titles.name),
          hasClimate && h("p", { class: "wdetail__headline" }, headline(cells, legend)),
          outlookStrip({ cells, legend, selected: week, onWeek: (index) => { week = index; void drawDetail(); } }),
          outlookTable({
            title: titles.table, units: titles.units, digits: titles.digits, weeks: doc.weeks,
            rows: doc.weeks.map((item) => toRow(item[key])), legend, hasClimate, selectedWeek: week,
            onWeek: (index) => { week = index; void drawDetail(); },
          }),
          plumeChart(doc.daily[key], { title: titles.plume, units: titles.daily, digits: 1, firstDay: issue.manifest.first_day, zeroFloor: key === "rain" }),
        ),
      );
    }
  }

  function select(regionId: string): void {
    selected = app.regionById.get(regionId) ?? selected;
    writeUrl({ region: selected.id });
    drawSidebar();
    drawTable();
    void drawDetail().then(() => {
      root.dataset.ready = "true";
    });
  }

  select(selected.id);
  return () => {
    disposed = true;
  };
}
