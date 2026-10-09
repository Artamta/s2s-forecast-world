import { createLegend } from "../components/legend";
import { regionPicker } from "../components/regionPicker";
import { seasonOf, SKILL_ROOT, tierNote, type App, type Issue } from "../lib/app";
import { loadField, loadJson, type FieldData } from "../lib/data";
import { clear, h, svg } from "../lib/dom";
import { formatNumber, formatSigned } from "../lib/format";
import { writeUrl, type UrlState } from "../lib/url";
import { RegionMap } from "../map/RegionMap";
import { binColor, fieldShader } from "../map/shading";
import type { BinLegend, FieldProduct, RegionInfo, RegionScores, RegionSkillDocument, SkillDocument, Variable } from "../types";

const VARIABLES: Record<Variable, { label: string; units: string; digits: number }> = {
  rain: { label: "Rainfall", units: "mm/week", digits: 1 },
  t2m: { label: "Temperature", units: "°C", digits: 2 },
};

interface State {
  region: RegionInfo;
  variable: Variable;
  truth: string;
  metric: string;
  season: string;
  week: number;
}

function legendOf(app: App, metric: string): BinLegend {
  return metric === "acc" ? app.products.skill.legends.acc : app.products.skill.legends.score;
}

/** Bars of one score by lead week; zero is the climatology baseline. */
function weekBars(title: string, values: Array<number | null>, legend: BinLegend, selected: number): HTMLElement {
  const [width, height, left, top, bottom] = [360, 120, 20, 16, 20];
  const finite = values.filter((value): value is number => value !== null);
  const high = Math.max(0.1, ...finite) * 1.15;
  const low = Math.min(0, ...finite) * 1.15;
  const y = (value: number): number => top + ((high - value) / (high - low)) * (height - top - bottom);
  const band = (width - left - 8) / values.length;
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  chart.setAttribute("aria-label", `${title} by lead week: ${values.map((value, week) => `week ${week + 1} ${value ?? "n/a"}`).join(", ")}`);
  chart.append(
    svg("line", { x1: left, x2: width - 4, y1: y(0), y2: y(0), stroke: "#c3c2b7", "stroke-width": 1 }),
    svg("text", { x: left - 5, y: y(0) + 3.5, class: "wbars__label", "text-anchor": "end" }, "0"),
  );
  values.forEach((value, week) => {
    const centre = left + band * (week + 0.5);
    chart.append(svg("text", { x: centre, y: height - 5, class: "wbars__label", "text-anchor": "middle" }, `W${week + 1}`));
    if (value === null) return;
    const barWidth = Math.min(24, band - 6);
    const [barTop, barBottom] = [Math.min(y(value), y(0)), Math.max(y(value), y(0))];
    const bar = svg("rect", {
      x: centre - barWidth / 2, y: barTop, width: barWidth, height: Math.max(1, barBottom - barTop), rx: 3,
      fill: binColor(value, legend), stroke: week === selected ? "#1c2b36" : "rgb(28 43 54 / 18%)", "stroke-width": week === selected ? 1.5 : 0.5,
    });
    bar.append(svg("title", {}, `Week ${week + 1}: ${formatSigned(value, 3)}`));
    chart.append(bar, svg("text", { x: centre, y: value >= 0 ? barTop - 3 : barBottom + 10, class: "wbars__value", "text-anchor": "middle" }, formatSigned(value, 2)));
  });
  return h("figure", { class: "wbars" }, h("figcaption", {}, title), chart as unknown as Node);
}

function scoreCell(value: number | null, legend: BinLegend, digits = 2): HTMLElement {
  if (value === null) return h("td", {}, "–");
  const dot = h("span", { class: "wskill__dot" });
  dot.style.backgroundColor = binColor(value, legend);
  return h("td", {}, h("span", { class: "wskill__score" }, dot, formatSigned(value, digits)));
}

function scoreTable(app: App, scores: RegionScores, variable: Variable, selected: number): HTMLElement {
  const { legends } = app.products.skill;
  const { units, digits } = VARIABLES[variable];
  const number = (value: number | null): string => (value === null ? "–" : formatNumber(value, digits));
  const head = h("tr", {}, ...["Week", "BSS", "ACC", "CRPSS", `RMSE ${units}`, "Climatology", "Raw model", "Bias", "Cases"].map((label) => h("th", { scope: "col" }, label)));
  const body = h("tbody");
  for (let week = 0; week < 6; week += 1) {
    body.append(
      h(
        "tr",
        { class: week === selected ? "is-selected" : "" },
        h("th", { scope: "row" }, `W${week + 1}`),
        scoreCell(scores.bss[week], legends.score),
        scoreCell(scores.acc[week], legends.acc),
        scoreCell(scores.crpss[week], legends.score),
        h("td", {}, number(scores.rmse[week])),
        h("td", {}, number(scores.rmse_clim[week])),
        h("td", {}, number(scores.rmse_raw[week])),
        h("td", {}, scores.bias[week] === null ? "–" : formatSigned(scores.bias[week] as number, digits)),
        h("td", {}, scores.cases[week] === null ? "–" : String(Math.round(scores.cases[week] as number))),
      ),
    );
  }
  return h("div", { class: "wskill__scroll" }, h("table", {}, h("thead", {}, head), body));
}

/** Hindcast skill: a map of one score and the selected region's scores by lead week. */
export function renderSkill(root: HTMLElement, app: App, skill: SkillDocument, issue: Issue, url: UrlState): () => void {
  const { metrics, truths, seasons } = app.products.skill;
  const state: State = {
    region: app.regionById.get(url.region ?? "") ?? (app.regionById.get(app.regions.default_region) as RegionInfo),
    variable: "rain",
    truth: "era5",
    metric: "bss",
    season: seasonOf(issue.manifest.issue_date),
    week: (url.week ?? 3) - 1,
  };
  let disposed = false;
  let field: FieldData | null = null;

  const controls = h("div", { class: "wcontrols" });
  const mapHost = h("div", { class: "wmap" });
  const tooltip = h("div", { class: "wmap__tooltip", hidden: true });
  const caption = h("div", { class: "wmap__caption" });
  const weeks = h("div", { class: "wweeks", role: "group", "aria-label": "Lead week" });
  const note = h("p", { class: "wnote" });
  const side = h("aside", { class: "wside" });
  mapHost.append(tooltip);
  root.append(
    h("h2", { class: "wpage__title" }, "How good have these forecasts been?"),
    h("p", { class: "wnote" },
      `Scores of ${skill.hindcast_members}-member ${skill.initialisation}-initialised hindcasts started in ${skill.evaluation_years[0]}–${skill.evaluation_years[1]}, years the model was not trained on. Normals and tercile limits come from ${skill.climate_years[0]}–${skill.climate_years[1]}. The reference is always climatology on the same cases. Live forecasts start from a different analysis and have 100 members, so treat this as a guide.`),
    controls,
    h("div", { class: "wlayout" }, h("div", { class: "wmain" }, mapHost, caption, weeks, note), side),
  );
  const map = new RegionMap(mapHost, app.geography, {
    interactive: true,
    onHover: (point, x, y) => {
      const value = point && field ? field.sample(field.layerIndex(state.season), state.week, point.latitude, point.longitude, false) : Number.NaN;
      tooltip.hidden = Number.isNaN(value);
      if (tooltip.hidden) return;
      tooltip.replaceChildren(h("strong", {}, `${metricLabel()} ${formatSigned(value, 2)}`));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    },
  });

  const metricLabel = (): string => metrics.find((item) => item.id === state.metric)?.short_label ?? state.metric;
  const pairKey = (): string => `${state.variable}_${state.truth}`;

  function select(label: string, options: Array<[string, string]>, value: string, onChange: (value: string) => void): HTMLElement {
    const control = h("select", { "aria-label": label }, ...options.map(([id, text]) => h("option", { value: id, selected: id === value }, text)));
    control.addEventListener("change", () => onChange(control.value));
    return h("label", {}, h("span", {}, label), control);
  }

  function renderControls(): void {
    const truthOptions = Object.entries(truths).filter(([id]) => skill.pairs.includes(`${state.variable}_${id}`));
    clear(controls);
    controls.append(
      regionPicker(app, state.region, (regionId) => void setRegion(regionId)),
      select("Variable", (Object.keys(VARIABLES) as Variable[]).map((id) => [id, VARIABLES[id].label]), state.variable, (value) => {
        state.variable = value as Variable;
        if (!skill.pairs.includes(pairKey())) state.truth = "era5";
        void refresh();
      }),
      select("Verified against", truthOptions, state.truth, (value) => {
        state.truth = value;
        void refresh();
      }),
      select("Score", metrics.map((item) => [item.id, item.label]), state.metric, (value) => {
        state.metric = value;
        void refresh();
      }),
      select("Season", skill.seasons.map((id) => [id, seasons[id]]), state.season, (value) => {
        state.season = value;
        void refresh();
      }),
    );
  }

  function renderWeeks(): void {
    clear(weeks);
    for (let week = 0; week < 6; week += 1) {
      const button = h("button", { type: "button", class: week === state.week ? "is-selected" : "", "aria-pressed": String(week === state.week) }, `Week ${week + 1}`);
      button.addEventListener("click", () => {
        state.week = week;
        void refresh();
      });
      weeks.append(button);
    }
  }

  async function renderSide(): Promise<void> {
    const region = state.region;
    const document = await loadJson<RegionSkillDocument>(`${SKILL_ROOT}regions/${region.id}.json?v=${encodeURIComponent(skill.generated_at)}`);
    if (disposed || region !== state.region) return;
    const scores = document.pairs[pairKey()]?.[state.season];
    const { legends } = app.products.skill;
    const tier = tierNote(region);
    clear(side);
    if (!scores) return;
    side.append(
      h(
        "section",
        { class: "wpanel wskill" },
        h("p", { class: "wpanel__trail" }, `${VARIABLES[state.variable].label} · ${truths[state.truth]} · ${seasons[state.season]}`),
        h("h2", {}, region.label),
        h("p", { class: "wpanel__meta" }, "Scores of the region-mean forecast"),
        tier && h("p", { class: `wpanel__tier wpanel__tier--${region.tier}` }, tier),
        weekBars("Tercile Brier skill score", scores.bss, legends.score, state.week),
        weekBars("Anomaly correlation", scores.acc, legends.acc, state.week),
        weekBars("CRPS skill score", scores.crpss, legends.score, state.week),
        h("h3", {}, "All scores by lead week"),
        scoreTable(app, scores, state.variable, state.week),
        h("p", { class: "wtable__note" },
          "BSS, CRPSS above 0 beat climatology. RMSE is for the ensemble mean after removing the model's mean bias; “Climatology” is the error of forecasting the normal; “Raw model” is the error without bias removal; Bias is raw model minus truth."),
      ),
    );
  }

  async function refresh(): Promise<void> {
    renderControls();
    renderWeeks();
    const metric = metrics.find((item) => item.id === state.metric) ?? metrics[0];
    const legend = legendOf(app, metric.id);
    const loaded = await loadField(SKILL_ROOT, skill.fields[`${metric.id}_${pairKey()}`]);
    if (disposed) return;
    field = loaded;
    map.update({ shader: fieldShader(loaded, loaded.layerIndex(state.season), legend), week: state.week, smooth: false });
    const product: FieldProduct = { id: metric.id, variable: state.variable, label: metric.label, short_label: metric.short_label, description: metric.description, group: "Skill", kind: "field", field: metric.id, layer: state.season, units: "" };
    clear(caption);
    caption.append(
      h("div", { class: "wmap__title" }, h("strong", {}, `${metric.label}: ${VARIABLES[state.variable].label.toLowerCase()}, week ${state.week + 1}`), h("span", {}, `${truths[state.truth]} · ${seasons[state.season]} · ${skill.cases_per_week[state.season]} cases`)),
      createLegend(product, legend),
    );
    note.textContent = `${metric.description} Grey cells have too few cases, no truth, or (for BSS on rainfall) a dry season with no categories.`;
    writeUrl({ region: state.region.id, week: String(state.week + 1) });
    await renderSide();
    root.dataset.ready = "true";
  }

  async function setRegion(regionId: string): Promise<void> {
    state.region = app.regionById.get(regionId) ?? state.region;
    map.setView(state.region.view);
    const outline = state.region.kind === "group" ? [] : await app.geography.outline(state.region.id);
    if (disposed) return;
    map.update({ outline });
    await refresh();
  }

  void setRegion(state.region.id);
  return () => {
    disposed = true;
    map.destroy();
  };
}
