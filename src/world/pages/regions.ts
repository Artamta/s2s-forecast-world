import { plumeChart } from "../components/plumeChart";
import { areaButtons, section, segmented } from "../components/sidebar";
import { weekTable } from "../components/weekTable";
import { areaOf, binLegendOf, tierNote, type App, type Issue } from "../lib/app";
import { loadMember } from "../lib/data";
import { clear, h } from "../lib/dom";
import { formatNumber, formatRange, formatSigned } from "../lib/format";
import { writeUrl, type UrlState } from "../lib/url";
import { binColor, inkOn } from "../map/shading";
import type { BinLegend, RegionDocument, RegionInfo, SummaryCell, Variable } from "../types";

type Show = "total" | "anomaly";
const TITLES: Record<Variable, { name: string; total: string; plume: string; units: string; daily: string; digits: number }> = {
  rain: { name: "Rainfall", total: "Total", plume: "Daily rainfall", units: "mm", daily: "mm/day", digits: 0 },
  t2m: { name: "Temperature", total: "Mean", plume: "Daily mean temperature", units: "°C", daily: "°C", digits: 1 },
};

function valueCell(cell: SummaryCell, show: Show, legend: BinLegend, variable: Variable): HTMLElement {
  const { digits, units } = TITLES[variable];
  const value = show === "anomaly" ? cell.anom : cell.mean;
  if (value === null) return h("td", { class: "wmatrix__cell" }, "–");
  const text = show === "anomaly" ? formatSigned(value, digits) : formatNumber(value, digits);
  const other = show === "anomaly"
    ? `ensemble mean ${formatNumber(cell.mean, digits)} ${units}`
    : cell.anom === null ? "" : `anomaly ${formatSigned(cell.anom, digits)} ${units}`;
  const color = binColor(value, legend);
  const td = h("td", { class: "wmatrix__cell", title: other }, `${text} ${units}`);
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
  let show: Show = "total";
  let disposed = false;
  const hasClimate = issue.manifest.climate !== null;
  const sidebar = h("aside", { class: "wsb", "aria-label": "Table controls" });
  const heading = h("div", { class: "wstage__title" });
  const tableHost = h("div", { class: "wmatrix__scroll" });
  const detail = h("aside", { class: "wdetail", "aria-live": "polite" });
  root.append(h("div", { class: "wrg" }, sidebar, h("section", { class: "wrg__main" }, heading, tableHost), detail));

  function drawSidebar(): void {
    const shows: Array<{ id: Show; label: string }> = [{ id: "total", label: TITLES[variable].total }];
    if (hasClimate) shows.push({ id: "anomaly", label: "Anomaly" });
    clear(sidebar);
    sidebar.append(
      section("Area", areaButtons(app, areaOf(app, selected).id, (areaId) => select(areaId))),
      section("Variable", segmented("Variable", [{ id: "rain", label: "Rainfall" }, { id: "t2m", label: "Temperature" }], variable, (id) => {
        variable = id as Variable;
        drawSidebar();
        drawTable();
      })),
      section("Show", segmented("Show", shows, show, (id) => {
        show = id;
        drawSidebar();
        drawTable();
      })),
    );
  }

  function drawTable(): void {
    const titles = TITLES[variable];
    const legend = binLegendOf(app, `${variable}_${show === "anomaly" ? "anom" : "mean"}`);
    const what = show === "anomaly"
      ? `${titles.name} anomaly: ensemble mean minus the model normal`
      : variable === "rain" ? "Weekly rainfall total, ensemble mean" : "Weekly mean temperature, ensemble mean";
    heading.replaceChildren(h("h2", {}, "Regions"), h("p", {}, `${what}, as an area mean over land. Select a row for its numbers.`));
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
      body.append(h("tr", { class: region.id === selected.id ? "is-selected" : "" }, name, ...cells.map((cell) => valueCell(cell, show, legend, variable))));
    }
    clear(tableHost);
    tableHost.append(h("table", { class: "wmatrix" }, h("thead", {}, head), body));
  }

  async function drawDetail(): Promise<void> {
    const region = selected;
    const doc = await loadMember<RegionDocument>(`${issue.base}regions/`, region.id, issue.manifest.generated_at);
    if (disposed || region !== selected) return;
    const note = tierNote(region);
    const showOnMap = h("button", { type: "button", class: "wbutton" }, "Show on map");
    showOnMap.addEventListener("click", () => openOnMap(region.id));
    clear(detail);
    detail.append(h("div", { class: "wdetail__head" }, h("h2", {}, region.label), showOnMap));
    if (note) detail.append(h("p", { class: "wdetail__tier" }, note));
    for (const key of ["rain", "t2m"] as Variable[]) {
      const titles = TITLES[key];
      detail.append(
        h(
          "section",
          { class: "wdetail__block" },
          h("h3", {}, titles.name),
          weekTable({
            units: titles.units, digits: titles.digits, weeks: doc.weeks, hasClimate,
            rows: doc.weeks.map((item) => ({ mean: item[key].mean, p10: item[key].p10, p90: item[key].p90, anom: item[key].anom })),
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
