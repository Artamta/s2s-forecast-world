import { createLegend } from "../components/legend";
import { pointPanel } from "../components/pointPanel";
import { regionPanel } from "../components/regionPanel";
import { regionPicker } from "../components/regionPicker";
import { availableProducts, countryAt, landShare, legendFor, seasonOf, SKILL_ROOT, type App, type Issue } from "../lib/app";
import { loadField, loadJson, type FieldData } from "../lib/data";
import { clear, h } from "../lib/dom";
import { digitsFor, formatLatitude, formatLongitude, formatNumber, formatRange } from "../lib/format";
import { writeUrl, type UrlState } from "../lib/url";
import { RegionMap, type MapPoint } from "../map/RegionMap";
import { fieldShader, tercileShader, windSpeedShader, type Shader } from "../map/shading";
import type { BinLegend, Product, RegionDocument, RegionInfo, RegionSkillDocument, TercileLegend } from "../types";

const DRIFT_LIMIT = 0.3;

interface State {
  region: RegionInfo;
  product: Product;
  week: number;
  cells: boolean;
  wind: boolean;
  hatch: boolean;
  fadeSea: boolean;
  point: MapPoint | null;
}

interface Loaded {
  product: Product;
  field: FieldData;
  shader: Shader;
}

function buildShader(app: App, product: Product, field: FieldData): Shader {
  const legend = legendFor(app, product);
  if (product.kind === "tercile") return tercileShader(field, legend as TercileLegend);
  if (product.kind === "wind") return windSpeedShader(field, legend as BinLegend);
  return fieldShader(field, field.layerIndex(product.layer), legend as BinLegend);
}

function describeValue(loaded: Loaded, legend: BinLegend | TercileLegend, week: number, point: MapPoint): string {
  const { product, field } = loaded;
  const at = (layer: string): number => field.sample(field.layerIndex(layer), week, point.latitude, point.longitude, false);
  if (product.kind === "tercile") {
    const [below, above] = [at("below"), at("above")];
    if (Number.isNaN(below + above)) return "Dry season: no outlook";
    const terciles = legend as TercileLegend;
    return `${terciles.below_label} ${Math.round(below)}% · near normal ${Math.round(100 - below - above)}% · ${terciles.above_label.toLowerCase()} ${Math.round(above)}%`;
  }
  if (product.kind === "wind") {
    const [u, v] = [at("u"), at("v")];
    const from = (Math.atan2(-u, -v) * 180) / Math.PI;
    return `${formatNumber(Math.hypot(u, v), 1)} m/s from ${Math.round((from + 360) % 360)}°`;
  }
  const value = at(product.layer);
  return Number.isNaN(value) ? "No value" : `${formatNumber(value, digitsFor(product.units))} ${product.units}`;
}

/** The forecast page: pick a region and a map, step through six weeks, read the side panel. */
export function renderForecast(root: HTMLElement, app: App, issue: Issue, url: UrlState): () => void {
  const products = availableProducts(app, issue.manifest);
  const state: State = {
    region: app.regionById.get(url.region ?? "") ?? (app.regionById.get(app.regions.default_region) as RegionInfo),
    product: products.find((product) => product.id === url.product) ?? products[0],
    week: (url.week ?? 1) - 1,
    cells: url.cells,
    wind: false,
    hatch: true,
    fadeSea: true,
    point: url.point,
  };
  let loaded: Loaded | null = null;
  let windField: FieldData | null = null;
  let pastSkill: FieldData | null = null;
  let disposed = false;

  const controls = h("div", { class: "wcontrols" });
  const mapHost = h("div", { class: "wmap" });
  const tooltip = h("div", { class: "wmap__tooltip", hidden: true });
  const caption = h("div", { class: "wmap__caption" });
  const weeks = h("div", { class: "wweeks", role: "group", "aria-label": "Forecast week" });
  const note = h("p", { class: "wnote" });
  const pointHost = h("div");
  const regionHost = h("div");
  const zoomButtons = h("div", { class: "wmap__zoom" });
  mapHost.append(tooltip, zoomButtons);
  root.append(
    controls,
    h(
      "div",
      { class: "wlayout" },
      h("div", { class: "wmain" }, weeks, mapHost, caption, note),
      h("aside", { class: "wside" }, pointHost, regionHost),
    ),
  );

  const map = new RegionMap(mapHost, app.geography, {
    interactive: true,
    onHover: (point, x, y) => showTooltip(point, x, y),
    onSelect: (point) => setPoint(point),
  });
  for (const [label, name, action] of [
    ["+", "Zoom in", () => map.zoom(1.5)],
    ["−", "Zoom out", () => map.zoom(1 / 1.5)],
    ["⤢", "Fit region", () => map.resetView()],
  ] as Array<[string, string, () => void]>) {
    const button = h("button", { type: "button", "aria-label": name, title: name }, label);
    button.addEventListener("click", action);
    zoomButtons.append(button);
  }
  const weekButtons = issue.manifest.weeks.map((window, index) => {
    const button = h(
      "button",
      { type: "button" },
      h("strong", {}, `Week ${window.week}`),
      h("span", {}, formatRange(window.valid_start, window.valid_end)),
    );
    button.addEventListener("click", () => setWeek(index));
    weeks.append(button);
    return button;
  });

  const fadesSea = (): boolean => state.fadeSea && (state.product.variable === "rain" || state.product.variable === "t2m");
  const showsHatch = (): boolean => app.skill !== null && state.product.kind === "tercile";

  function syncUrl(): void {
    writeUrl({
      region: state.region.id,
      product: state.product.id,
      week: String(state.week + 1),
      cells: state.cells ? "1" : null,
      point: state.point ? `${state.point.latitude.toFixed(2)},${state.point.longitude.toFixed(2)}` : null,
    });
  }

  function showTooltip(point: MapPoint | null, x: number, y: number): void {
    if (!point || !loaded) {
      tooltip.hidden = true;
      return;
    }
    const country = countryAt(app, point.latitude, point.longitude);
    const place = `${formatLatitude(Math.round(point.latitude * 10) / 10)}, ${formatLongitude(Math.round(point.longitude * 10) / 10)}`;
    tooltip.replaceChildren(
      h("strong", {}, describeValue(loaded, legendFor(app, loaded.product), state.week, point)),
      h("span", {}, country ? `${country.label} · ${place}` : place),
    );
    tooltip.hidden = false;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.classList.toggle("wmap__tooltip--left", x > mapHost.clientWidth * 0.6);
  }

  function productSelect(): HTMLElement {
    const select = h("select", { "aria-label": "Map" });
    for (const group of [...new Set(products.map((product) => product.group))]) {
      const options = products
        .filter((product) => product.group === group)
        .map((product) => h("option", { value: product.id, selected: product.id === state.product.id }, product.label));
      select.append(h("optgroup", { label: group }, ...options));
    }
    select.addEventListener("change", () => {
      state.product = products.find((product) => product.id === select.value) ?? products[0];
      renderControls();
      void refreshProduct();
    });
    return h("label", {}, h("span", {}, "Map"), select);
  }

  function optionsMenu(): HTMLElement {
    const toggle = (label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement => {
      const input = h("input", { type: "checkbox", checked });
      input.addEventListener("change", () => onChange(input.checked));
      return h("label", { class: "wtoggle" }, input, h("span", {}, label));
    };
    const menu = h("div", { class: "wopts__menu" });
    if (state.product.variable === "rain" || state.product.variable === "t2m") {
      menu.append(toggle("Fade the sea", state.fadeSea, (value) => { state.fadeSea = value; paint(); }));
    }
    if (showsHatch()) {
      menu.append(toggle("Hatch where past forecasts had no skill", state.hatch, (value) => { state.hatch = value; paint(); }));
    }
    if ("wind850" in issue.manifest.fields && state.product.kind !== "wind") {
      menu.append(toggle("Wind arrows", state.wind, (value) => { state.wind = value; void refreshWind(); }));
    }
    menu.append(toggle("Show model grid cells", state.cells, (value) => { state.cells = value; paint(); }));
    return h("details", { class: "wopts" }, h("summary", {}, "Options"), menu);
  }

  function renderControls(): void {
    clear(controls);
    controls.append(regionPicker(app, state.region, (regionId) => void setRegion(regionId)), productSelect(), optionsMenu());
  }

  /** True where smoothed hindcast BSS for this lead week and season is not above zero. */
  function noSkillMask(): ((latitude: number, longitude: number) => boolean) | null {
    const field = pastSkill;
    if (!field || !state.hatch || !showsHatch()) return null;
    const season = field.layerIndex(seasonOf(issue.manifest.weeks[state.week].valid_start));
    const landOnly = fadesSea();
    return (latitude, longitude) =>
      field.sample(season, state.week, latitude, longitude, false) <= 0 &&
      (!landOnly || landShare(app, latitude, longitude) > 0.5);
  }

  /** Flag weeks where the whole globe has slid away from the model normal. */
  function driftWarning(): string {
    const departure = issue.manifest.climate?.mean_departure_60s_60n?.t2m;
    const usesNormal = state.product.variable === "t2m" && state.product.id !== "t2m_mean";
    if (!departure || !usesNormal) return "";
    const slide = departure[state.week] - departure[0];
    if (Math.abs(slide) < DRIFT_LIMIT) return "";
    return ` Caution: by this week the run has drifted ${formatNumber(Math.abs(slide), 1)} °C ${slide < 0 ? "cooler" : "warmer"} than normal across the globe, so this map leans ${slide < 0 ? "cool" : "warm"} everywhere.`;
  }

  function paint(): void {
    if (!loaded) return;
    const showWind = state.wind || state.product.kind === "wind";
    const arrows = state.product.kind === "wind" ? loaded.field : windField;
    const mask = noSkillMask();
    map.update({
      shader: loaded.shader,
      week: state.week,
      smooth: !state.cells,
      wind: showWind ? arrows : null,
      selection: state.point,
      mask,
      land: fadesSea() ? (latitude, longitude) => landShare(app, latitude, longitude) : null,
    });
    weekButtons.forEach((button, index) => {
      button.classList.toggle("is-selected", index === state.week);
      button.setAttribute("aria-pressed", String(index === state.week));
    });
    clear(caption);
    caption.append(
      createLegend(state.product, legendFor(app, state.product)),
      h("p", { class: "wmap__keys" },
        state.product.kind === "tercile" ? "Grey: near normal or no clear lean." : "",
        mask ? " Hatched: past forecasts were no better than climatology there." : ""),
    );
    note.textContent = `${state.product.description}${driftWarning()}`;
    syncUrl();
  }

  async function refreshWind(): Promise<void> {
    const record = issue.manifest.fields.wind850;
    if (record && state.wind && !windField) windField = await loadField(issue.base, record);
    if (!disposed) paint();
  }

  async function refreshProduct(): Promise<void> {
    const product = state.product;
    const field = await loadField(issue.base, issue.manifest.fields[product.field]);
    const skillRecord = product.kind === "tercile" ? app.skill?.fields[`bss3_${product.variable}_era5`] : undefined;
    const skillField = skillRecord ? await loadField(SKILL_ROOT, skillRecord) : null;
    if (disposed || product !== state.product) return;
    pastSkill = skillField;
    loaded = { product, field, shader: buildShader(app, product, field) };
    await refreshWind();
  }

  async function refreshRegionPanel(): Promise<void> {
    const region = state.region;
    const version = encodeURIComponent(issue.manifest.generated_at);
    const [document, skill] = await Promise.all([
      loadJson<RegionDocument>(`${issue.base}regions/${region.id}.json?v=${version}`),
      app.skill
        ? loadJson<RegionSkillDocument>(`${SKILL_ROOT}regions/${region.id}.json?v=${encodeURIComponent(app.skill.generated_at)}`).catch(() => null)
        : null,
    ]);
    if (disposed || region !== state.region) return;
    const open = regionHost.querySelector("details")?.open ?? false;
    clear(regionHost);
    regionHost.append(
      regionPanel({ app, issue, region, document, skill, week: state.week, onRegion: (id) => void setRegion(id), onWeek: setWeek }),
    );
    const details = regionHost.querySelector("details");
    if (details) details.open = open;
  }

  async function refreshPointPanel(): Promise<void> {
    const point = state.point;
    if (!point) {
      clear(pointHost);
      return;
    }
    const panel = await pointPanel({
      app, issue, point, week: state.week, onWeek: setWeek,
      onRegion: (id) => void setRegion(id),
      onClose: () => setPoint(null),
    });
    if (!disposed && point === state.point) pointHost.replaceChildren(panel);
  }

  function setWeek(week: number): void {
    state.week = week;
    paint();
    void refreshRegionPanel();
    void refreshPointPanel();
  }

  function setPoint(point: MapPoint | null): void {
    state.point = point;
    paint();
    void refreshPointPanel();
  }

  async function setRegion(regionId: string): Promise<void> {
    state.region = app.regionById.get(regionId) ?? state.region;
    renderControls();
    map.setView(state.region.view);
    const outline = state.region.kind === "group" ? [] : await app.geography.outline(state.region.id);
    if (disposed) return;
    map.update({ outline });
    paint();
    await refreshRegionPanel();
  }

  root.dataset.ready = "false";
  void Promise.all([refreshProduct(), setRegion(state.region.id), refreshPointPanel()]).then(() => {
    root.dataset.ready = "true";
  });

  return () => {
    disposed = true;
    map.destroy();
  };
}
