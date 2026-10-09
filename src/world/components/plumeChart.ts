import { h, svg } from "../lib/dom";
import { addDays, formatDay, formatNumber } from "../lib/format";
import type { Plume } from "../types";

const WIDTH = 520;
const HEIGHT = 190;
const MARGIN = { left: 40, right: 12, top: 10, bottom: 26 };
const FORECAST = "#1f6fa5";
const NORMAL = "#8a949d";

interface PlumeOptions {
  title: string;
  units: string;
  digits: number;
  firstDay: string;
  zeroFloor: boolean;
  /** Draw a baseline at zero and keep it in view: for anomaly series. */
  zeroLine?: boolean;
}

function niceTicks(low: number, high: number, count = 4): number[] {
  const span = high - low || 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let tick = Math.floor(low / step) * step; tick <= high + step * 0.5; tick += step) {
    ticks.push(Number(tick.toFixed(6)));
  }
  return ticks;
}

function key(kind: "line" | "band", color: string, label: string): HTMLElement {
  const mark = h("span", { class: `wplume__key wplume__key--${kind}` });
  mark.style.backgroundColor = color;
  return h("span", { class: "wplume__legend-item" }, mark, label);
}

/** Daily ensemble plume: median, 10-90% band and the model normal. */
export function plumeChart(plume: Plume, options: PlumeOptions): HTMLElement {
  const days = plume.p50.length;
  const all = [...plume.p10, ...plume.p90, ...(plume.clim ?? []), ...(options.zeroLine ? [0] : [])];
  const ticks = niceTicks(options.zeroFloor ? 0 : Math.min(...all), Math.max(...all));
  const [low, high] = [ticks[0], ticks[ticks.length - 1]];
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (day: number): number => MARGIN.left + (day / (days - 1)) * plotWidth;
  const y = (value: number): number => MARGIN.top + (1 - (value - low) / (high - low)) * plotHeight;
  const path = (values: number[]): string =>
    values.map((value, day) => `${day ? "L" : "M"}${x(day).toFixed(1)},${y(value).toFixed(1)}`).join("");

  const chart = svg("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "wplume__svg", role: "img" });
  chart.setAttribute("aria-label", `${options.title}: daily median with 10 to 90 percent range over 42 days`);
  for (const tick of ticks) {
    chart.append(
      svg("line", { x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: y(tick), y2: y(tick), class: "wplume__grid" }),
      svg("text", { x: MARGIN.left - 6, y: y(tick) + 3.5, class: "wplume__tick", "text-anchor": "end" },
        formatNumber(tick, tick % 1 ? 1 : 0)),
    );
  }
  for (let week = 0; week < days / 7; week += 1) {
    const start = x(week * 7);
    if (week) chart.append(svg("line", { x1: start, x2: start, y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom, class: "wplume__week" }));
    chart.append(svg("text", { x: start + 2, y: HEIGHT - 8, class: "wplume__tick" }, formatDay(addDays(options.firstDay, week * 7))));
  }
  if (options.zeroLine) {
    chart.append(svg("line", { x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: y(0), y2: y(0), class: "wplume__week" }));
  }
  const band = `${path(plume.p90)}${[...plume.p10].reverse().map((value, index) => `L${x(days - 1 - index).toFixed(1)},${y(value).toFixed(1)}`).join("")}Z`;
  chart.append(svg("path", { d: band, fill: FORECAST, "fill-opacity": 0.14 }));
  if (plume.clim) chart.append(svg("path", { d: path(plume.clim), class: "wplume__line", stroke: NORMAL }));
  chart.append(svg("path", { d: path(plume.p50), class: "wplume__line", stroke: FORECAST }));

  const cross = svg("line", { y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom, class: "wplume__cross", visibility: "hidden" });
  const dot = svg("circle", { r: 4, fill: FORECAST, stroke: "#fcfcfb", "stroke-width": 2, visibility: "hidden" });
  const hit = svg("rect", { x: MARGIN.left, y: MARGIN.top, width: plotWidth, height: plotHeight, fill: "transparent", tabindex: 0 });
  chart.append(cross, dot, hit);

  const tooltip = h("div", { class: "wplume__tooltip", hidden: true });
  let focused = 0;
  const show = (day: number): void => {
    focused = Math.min(days - 1, Math.max(0, day));
    cross.setAttribute("x1", String(x(focused)));
    cross.setAttribute("x2", String(x(focused)));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", String(x(focused)));
    dot.setAttribute("cy", String(y(plume.p50[focused])));
    dot.setAttribute("visibility", "visible");
    const fmt = (value: number): string => formatNumber(value, options.digits);
    tooltip.replaceChildren(
      h("span", { class: "wplume__tooltip-date" }, `${formatDay(addDays(options.firstDay, focused))} · day ${focused + 1}`),
      h("strong", {}, `${fmt(plume.p50[focused])} ${options.units}`),
      h("span", {}, `10–90%: ${fmt(plume.p10[focused])} to ${fmt(plume.p90[focused])}`),
      plume.clim ? h("span", {}, `Model normal: ${fmt(plume.clim[focused])}`) : "",
    );
    tooltip.hidden = false;
    tooltip.style.left = `${(x(focused) / WIDTH) * 100}%`;
    tooltip.classList.toggle("wplume__tooltip--left", focused > days * 0.6);
  };
  const hide = (): void => {
    tooltip.hidden = true;
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
  };
  hit.addEventListener("pointermove", (event) => {
    const bounds = hit.getBoundingClientRect();
    show(Math.round(((event.clientX - bounds.left) / bounds.width) * (days - 1)));
  });
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", () => show(focused));
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") show(focused + 1);
    else if (event.key === "ArrowLeft") show(focused - 1);
    else return;
    event.preventDefault();
  });

  const legend = h(
    "div",
    { class: "wplume__legend" },
    key("line", FORECAST, "Median"),
    key("band", FORECAST, "10–90% of members"),
    plume.clim ? key("line", NORMAL, "Model normal") : null,
  );
  return h(
    "figure",
    { class: "wplume" },
    h("figcaption", {}, h("strong", {}, options.title), h("span", { class: "wplume__units" }, options.units)),
    legend,
    h("div", { class: "wplume__plot" }, chart as unknown as Node, tooltip),
  );
}
