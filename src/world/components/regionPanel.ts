import { ancestors, seasonOf, tercileLegendOf, tierNote, type App, type Issue } from "../lib/app";
import { h } from "../lib/dom";
import { formatNumber, formatSigned } from "../lib/format";
import type { RegionDocument, RegionInfo, RegionSkillDocument, RegionWeekValue, Variable } from "../types";
import { headline, outlookStrip, type StripCell } from "./outlookStrip";
import { outlookTable, type OutlookRow } from "./outlookTable";
import { plumeChart } from "./plumeChart";

const TITLES: Record<Variable, { name: string; table: string; plume: string; units: string; daily: string; digits: number }> = {
  rain: { name: "Rainfall", table: "Rainfall, weekly total", plume: "Daily rainfall", units: "mm", daily: "mm/day", digits: 0 },
  t2m: { name: "Temperature", table: "Temperature, weekly mean", plume: "Daily mean temperature", units: "°C", daily: "°C", digits: 1 },
};

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

interface PanelOptions {
  app: App;
  issue: Issue;
  region: RegionInfo;
  document: RegionDocument;
  skill: RegionSkillDocument | null;
  week: number;
  onRegion: (regionId: string) => void;
  onWeek: (week: number) => void;
}

/** One line on how well hindcasts did for this region, week and season. */
function skillNote(options: PanelOptions): string | null {
  const season = seasonOf(options.document.weeks[options.week].valid_start);
  const parts = (["rain", "t2m"] as Variable[]).flatMap((variable) => {
    const bss = options.skill?.pairs[`${variable}_era5`]?.[season]?.bss[options.week];
    if (bss == null) return [];
    const verdict = bss > 0.01 ? "better than climatology" : "no better than climatology";
    return [`${TITLES[variable].name.toLowerCase()} ${verdict} (BSS ${formatSigned(bss, 2)})`];
  });
  return parts.length ? `Past skill for week ${options.week + 1}: ${parts.join("; ")}.` : null;
}

function linkButton(region: RegionInfo, onRegion: (regionId: string) => void): HTMLElement {
  const button = h("button", { type: "button", class: "wlink" }, region.label);
  button.addEventListener("click", () => onRegion(region.id));
  return button;
}

/** Side panel for the selected region: a short outlook first, numbers on request. */
export function regionPanel(options: PanelOptions): HTMLElement {
  const { app, issue, region, document: doc } = options;
  const hasClimate = issue.manifest.climate !== null;
  const trail = ancestors(app, region).flatMap((parent) => [linkButton(parent, options.onRegion), " › "]);
  const children = region.kind === "group" ? [] : region.children.map((id) => app.regionById.get(id) as RegionInfo);
  const note = tierNote(region);
  const skill = skillNote(options);
  const panel = h(
    "section",
    { class: "wpanel" },
    trail.length > 0 && h("p", { class: "wpanel__trail" }, ...trail),
    h("h2", {}, region.label),
    note && h("p", { class: "wpanel__tier" }, note),
    children.length > 0 &&
      h("div", { class: "wpanel__children" }, ...children.map((child) => linkButton(child, options.onRegion))),
  );
  const details = h("details", { class: "wpanel__details" }, h("summary", {}, "Numbers and daily charts"));
  for (const variable of ["rain", "t2m"] as Variable[]) {
    const title = TITLES[variable];
    const legend = tercileLegendOf(app, variable);
    const cells = doc.weeks.map((week) => toCell(week[variable], variable));
    panel.append(
      h(
        "div",
        { class: "wpanel__block" },
        h("h3", {}, title.name),
        hasClimate && h("p", { class: "wpanel__headline" }, headline(cells, legend)),
        outlookStrip({ cells, legend, selected: options.week, onWeek: options.onWeek }),
      ),
    );
    details.append(
      outlookTable({
        title: title.table,
        units: title.units,
        digits: title.digits,
        weeks: doc.weeks,
        rows: doc.weeks.map((week) => toRow(week[variable])),
        legend,
        hasClimate,
        selectedWeek: options.week,
        onWeek: options.onWeek,
      }),
      plumeChart(doc.daily[variable], {
        title: title.plume,
        units: title.daily,
        digits: 1,
        firstDay: issue.manifest.first_day,
        zeroFloor: variable === "rain",
      }),
    );
  }
  panel.append(
    h("p", { class: "wpanel__foot" }, "▼ below normal · ● near normal · ▲ above normal, with the chance of that category. Underneath: departure from normal."),
  );
  if (skill) panel.append(h("p", { class: "wpanel__foot" }, skill));
  panel.append(details);
  return panel;
}
