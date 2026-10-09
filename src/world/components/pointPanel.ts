import { countryAt, tercileLegendOf, type App, type Issue } from "../lib/app";
import { cellCentre, gridCell, loadField, type FieldData } from "../lib/data";
import { h } from "../lib/dom";
import { formatLatitude, formatLongitude, formatNumber, formatSigned } from "../lib/format";
import type { MapPoint } from "../map/RegionMap";
import { outlookOf } from "../map/shading";
import type { Variable } from "../types";
import { headline, outlookStrip, type StripCell } from "./outlookStrip";
import type { OutlookRow } from "./outlookTable";

const TITLES: Record<Variable, { name: string; units: string; digits: number }> = {
  rain: { name: "Rainfall", units: "mm", digits: 0 },
  t2m: { name: "Temperature", units: "°C", digits: 1 },
};

async function optionalField(issue: Issue, name: string): Promise<FieldData | null> {
  const record = issue.manifest.fields[name];
  return record ? loadField(issue.base, record) : null;
}

async function cellRows(issue: Issue, variable: Variable, row: number, col: number): Promise<OutlookRow[]> {
  const [mean, quantiles, anomaly, chance] = await Promise.all(
    ["mean", "q", "anom", "prob"].map((suffix) => optionalField(issue, `${variable}_${suffix}`)),
  );
  if (!mean || !quantiles) throw new Error(`issue has no ${variable} fields`);
  const [p10, p90] = [quantiles.layerIndex("p10"), quantiles.layerIndex("p90")];
  return issue.manifest.weeks.map((_, week) => {
    const below = chance ? chance.cell(0, week, row, col) : Number.NaN;
    const above = chance ? chance.cell(1, week, row, col) : Number.NaN;
    return {
      mean: mean.cell(0, week, row, col),
      p10: quantiles.cell(p10, week, row, col),
      p90: quantiles.cell(p90, week, row, col),
      anom: anomaly ? anomaly.cell(0, week, row, col) : null,
      chance: Number.isNaN(below + above) ? null : { below, near: 100 - below - above, above },
      dry: chance ? chance.isDry(0, week, row, col) : false,
    };
  });
}

function toCell(row: OutlookRow, variable: Variable): StripCell {
  const { units, digits } = TITLES[variable];
  const outlook = row.chance ? outlookOf(row.chance.below, row.chance.above) : null;
  return {
    dominant: outlook ? outlook.category : null,
    chance: outlook ? Math.round(outlook.chance) : null,
    value: row.anom == null ? `${formatNumber(row.mean, digits)} ${units}` : `${formatSigned(row.anom, digits)} ${units}`,
    dry: row.dry ?? false,
  };
}

interface PointOptions {
  app: App;
  issue: Issue;
  point: MapPoint;
  week: number;
  onWeek: (week: number) => void;
  onRegion: (regionId: string) => void;
  onClose: () => void;
}

/** Six-week outlook for the grid cell under a clicked point. */
export async function pointPanel(options: PointOptions): Promise<HTMLElement> {
  const { app, issue, point } = options;
  const { row, col } = gridCell(point.latitude, point.longitude);
  const centre = cellCentre(row, col);
  const country = countryAt(app, point.latitude, point.longitude);
  const close = h("button", { type: "button", class: "wpoint__close", "aria-label": "Clear selected place" }, "×");
  close.addEventListener("click", options.onClose);
  const open = country ? h("button", { type: "button", class: "wlink" }, `Open ${country.label}`) : null;
  if (country && open) open.addEventListener("click", () => options.onRegion(country.id));
  const panel = h(
    "section",
    { class: "wpanel wpoint" },
    close,
    h("p", { class: "wpanel__trail" }, "Selected place · one grid cell, about 165 km across"),
    h("h2", {}, `${formatLatitude(centre.latitude)}, ${formatLongitude(centre.longitude)}`),
    h("p", { class: "wpanel__trail" }, country ? `${country.label} · ` : "Open sea", open),
  );
  for (const variable of ["rain", "t2m"] as Variable[]) {
    const legend = tercileLegendOf(app, variable);
    const cells = (await cellRows(issue, variable, row, col)).map((item) => toCell(item, variable));
    panel.append(
      h(
        "div",
        { class: "wpanel__block" },
        h("h3", {}, TITLES[variable].name),
        issue.manifest.climate !== null && h("p", { class: "wpanel__headline" }, headline(cells, legend)),
        outlookStrip({ cells, legend, selected: options.week, onWeek: options.onWeek }),
      ),
    );
  }
  return panel;
}
