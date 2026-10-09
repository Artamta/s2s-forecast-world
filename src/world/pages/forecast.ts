import { createLegend } from "../components/legend";
import { areaButtons, regionList, section, segmented, switchRow } from "../components/sidebar";
import { weekBar } from "../components/weekBar";
import { areaOf, countryAt, landShare, legendFor, menuProducts, type App, type Issue } from "../lib/app";
import { loadField, type FieldData } from "../lib/data";
import { clear, h } from "../lib/dom";
import { digitsFor, formatLatitude, formatLongitude, formatNumber, formatRange } from "../lib/format";
import { writeUrl, type UrlState } from "../lib/url";
import { RegionMap, type MapPoint } from "../map/RegionMap";
import { fieldShader, tercileShader, windSpeedShader, type Shader } from "../map/shading";
import type { BinLegend, MapView, MenuVariable, Product, RegionInfo, TercileLegend } from "../types";

const DRIFT_LIMIT = 0.3;
const PLAY_INTERVAL_MS = 1400;

interface State {
  region: RegionInfo;
  product: Product;
  week: number;
  cells: boolean;
  arrows: boolean;
  contours: boolean;
  fadeSea: boolean;
  pinned: MapPoint | null;
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

function placeText(point: MapPoint): string {
  return `${formatLatitude(Math.round(point.latitude * 10) / 10)}, ${formatLongitude(Math.round(point.longitude * 10) / 10)}`;
}

/** The forecast page: controls on the side, one large map, six weeks to step or play through. */
export function renderForecast(root: HTMLElement, app: App, issue: Issue, url: UrlState): () => void {
  const products = menuProducts(app, issue.manifest);
  const state: State = {
    region: app.regionById.get(url.region ?? "") ?? (app.regionById.get(app.regions.default_region) as RegionInfo),
    product: products.find((product) => product.id === url.product) ?? products[0],
    week: (url.week ?? 1) - 1,
    cells: url.cells,
    arrows: false,
    contours: true,
    fadeSea: true,
    pinned: url.point,
  };
  let loaded: Loaded | null = null;
  let windField: FieldData | null = null;
  let hovered: string | null = null;
  let playTimer = 0;
  let disposed = false;

  const sidebar = h("aside", { class: "wsb", "aria-label": "Map controls" });
  const title = h("div", { class: "wstage__title" });
  const mapHost = h("div", { class: "wmap" });
  const tooltip = h("div", { class: "wmap__tooltip", hidden: true });
  const card = h("div", { class: "wmap__card", hidden: true });
  const zoomButtons = h("div", { class: "wmap__zoom" });
  const foot = h("div", { class: "wstage__foot" });
  const weeks = weekBar(issue.manifest.weeks, (week) => setWeek(week), () => togglePlay());
  mapHost.append(tooltip, card, zoomButtons);
  root.append(
    h(
      "div",
      { class: "wfc" },
      sidebar,
      h("section", { class: "wstage" }, h("div", { class: "wstage__head" }, title, weeks.element), mapHost, foot),
    ),
  );

  const map = new RegionMap(mapHost, app.geography, {
    interactive: true,
    onHover: (point, x, y) => void showTooltip(point, x, y),
    onSelect: (point) => setPinned(point),
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

  const variable = (): MenuVariable => state.product.variable as MenuVariable;
  const fadesSea = (): boolean => state.fadeSea && variable() !== "wind";
  const hasContours = (): boolean => state.product.kind !== "tercile";

  function syncUrl(): void {
    writeUrl({
      region: state.region.id,
      product: state.product.id,
      week: String(state.week + 1),
      cells: state.cells ? "1" : null,
      point: state.pinned ? `${state.pinned.latitude.toFixed(2)},${state.pinned.longitude.toFixed(2)}` : null,
    });
  }

  /** Outline the country under the pointer, unless it is already the selected region. */
  async function highlight(countryId: string | null): Promise<void> {
    if (countryId === hovered) return;
    hovered = countryId;
    const lines = countryId && countryId !== state.region.id ? await app.geography.outline(countryId) : [];
    if (!disposed && hovered === countryId) map.update({ highlight: lines });
  }

  async function showTooltip(point: MapPoint | null, x: number, y: number): Promise<void> {
    if (!point || !loaded) {
      tooltip.hidden = true;
      if (!state.pinned) await highlight(null);
      return;
    }
    const country = countryAt(app, point.latitude, point.longitude);
    tooltip.replaceChildren(
      h("strong", {}, country ? country.label : "Open sea"),
      h("span", {}, describeValue(loaded, legendFor(app, loaded.product), state.week, point)),
    );
    tooltip.hidden = false;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.classList.toggle("wmap__tooltip--left", x > mapHost.clientWidth * 0.6);
    if (!state.pinned) await highlight(country?.id ?? null);
  }

  /** The pinned place: its name, value and a way to open that country. */
  function renderCard(): void {
    const point = state.pinned;
    card.hidden = !point || !loaded;
    if (!point || !loaded) return;
    const country = countryAt(app, point.latitude, point.longitude);
    const close = h("button", { type: "button", class: "wmap__card-close", "aria-label": "Clear selected place" }, "×");
    close.addEventListener("click", () => setPinned(null));
    const open = country && country.id !== state.region.id ? h("button", { type: "button", class: "wbutton" }, `Open ${country.label}`) : null;
    if (country && open) open.addEventListener("click", () => void setRegion(country.id));
    card.replaceChildren(
      close,
      h("strong", {}, country ? country.label : "Open sea"),
      h("span", { class: "wmap__card-place" }, placeText(point)),
      h("span", {}, describeValue(loaded, legendFor(app, loaded.product), state.week, point)),
      open ?? "",
    );
  }

  function renderSidebar(): void {
    const area = areaOf(app, state.region);
    const views = products
      .filter((product) => product.variable === variable())
      .map((product) => ({ id: product.view as MapView, label: product.view_label ?? product.label }));
    const pick = (wanted: MenuVariable, view: MapView): void => {
      const ofVariable = products.filter((product) => product.variable === wanted);
      state.product = ofVariable.find((product) => product.view === view) ?? ofVariable[0];
      renderSidebar();
      void refreshProduct();
    };
    const display = h("div", { class: "wsb__switches" });
    if (hasContours()) display.append(switchRow("show-contours", "Contour lines", state.contours, (value) => { state.contours = value; paint(); }));
    if (variable() !== "wind" && "wind850" in issue.manifest.fields) {
      display.append(switchRow("show-arrows", "Wind arrows", state.arrows, (value) => { state.arrows = value; void refreshWind(); }));
    }
    if (variable() !== "wind") display.append(switchRow("fade-sea", "Fade the sea", state.fadeSea, (value) => { state.fadeSea = value; paint(); }));
    display.append(switchRow("show-cells", "Model grid cells", state.cells, (value) => { state.cells = value; paint(); }));
    clear(sidebar);
    sidebar.append(
      section("Area", areaButtons(app, area.id, (areaId) => void setRegion(areaId))),
      section("Region", regionList(app, state.region, (regionId) => void setRegion(regionId))),
      section("Variable", segmented("Variable", app.products.variables.filter((item) => products.some((product) => product.variable === item.id)), variable(), (id) => pick(id, state.product.view as MapView))),
      section("Map", segmented("Map", views, state.product.view as MapView, (view) => pick(variable(), view))),
      section("Display", display),
    );
  }

  /** Flag weeks where the whole globe has slid away from the model normal. */
  function driftWarning(): string {
    const departure = issue.manifest.climate?.mean_departure_60s_60n?.t2m;
    const usesNormal = state.product.variable === "t2m" && state.product.view !== "total";
    if (!departure || !usesNormal) return "";
    const slide = departure[state.week] - departure[0];
    if (Math.abs(slide) < DRIFT_LIMIT) return "";
    return ` Caution: by this week the run has drifted ${formatNumber(Math.abs(slide), 1)} °C ${slide < 0 ? "cooler" : "warmer"} than normal across the globe, so this map leans ${slide < 0 ? "cool" : "warm"} everywhere.`;
  }

  function paint(): void {
    if (!loaded) return;
    const showArrows = state.product.kind === "wind" || state.arrows;
    map.update({
      shader: loaded.shader,
      week: state.week,
      smooth: !state.cells,
      wind: showArrows ? (state.product.kind === "wind" ? loaded.field : windField) : null,
      selection: state.pinned,
      contours: state.contours && hasContours(),
      land: fadesSea() ? (latitude, longitude) => landShare(app, latitude, longitude) : null,
    });
    weeks.setWeek(state.week);
    const window = issue.manifest.weeks[state.week];
    title.replaceChildren(
      h("h2", {}, state.product.label),
      h("p", {}, `Week ${window.week} · ${formatRange(window.valid_start, window.valid_end)} · ${state.region.label}`),
    );
    clear(foot);
    foot.append(
      createLegend(state.product, legendFor(app, state.product)),
      h("p", { class: "wnote" },
        state.product.kind === "tercile" ? "Grey: near normal or no clear lean. " : "",
        `${state.product.description}${driftWarning()}`),
    );
    renderCard();
    syncUrl();
  }

  async function refreshWind(): Promise<void> {
    const record = issue.manifest.fields.wind850;
    if (record && state.arrows && !windField) windField = await loadField(issue.base, record);
    if (!disposed) paint();
  }

  async function refreshProduct(): Promise<void> {
    const product = state.product;
    const field = await loadField(issue.base, issue.manifest.fields[product.field]);
    if (disposed || product !== state.product) return;
    loaded = { product, field, shader: buildShader(app, product, field) };
    await refreshWind();
  }

  function stopPlay(): void {
    window.clearInterval(playTimer);
    playTimer = 0;
    weeks.setPlaying(false);
  }

  function togglePlay(): void {
    if (playTimer) {
      stopPlay();
      return;
    }
    weeks.setPlaying(true);
    playTimer = window.setInterval(() => {
      state.week = (state.week + 1) % issue.manifest.weeks.length;
      paint();
    }, PLAY_INTERVAL_MS);
  }

  function setWeek(week: number): void {
    stopPlay();
    state.week = week;
    paint();
  }

  function setPinned(point: MapPoint | null): void {
    state.pinned = point;
    const country = point ? countryAt(app, point.latitude, point.longitude) : null;
    void highlight(country?.id ?? null);
    paint();
  }

  async function setRegion(regionId: string): Promise<void> {
    state.region = app.regionById.get(regionId) ?? state.region;
    state.pinned = null;
    hovered = null;
    renderSidebar();
    map.setView(state.region.view);
    const outline = state.region.kind === "group" ? [] : await app.geography.outline(state.region.id);
    if (disposed) return;
    map.update({ outline, highlight: [] });
    paint();
  }

  root.dataset.ready = "false";
  void Promise.all([refreshProduct(), setRegion(state.region.id)]).then(() => {
    if (url.point) setPinned(url.point);
    root.dataset.ready = "true";
  });

  return () => {
    disposed = true;
    stopPlay();
    map.destroy();
  };
}
