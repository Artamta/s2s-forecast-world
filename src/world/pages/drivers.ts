import { createLegend } from "../components/legend";
import { plumeChart } from "../components/plumeChart";
import { legendFor, type App, type Issue } from "../lib/app";
import { loadJson } from "../lib/data";
import { h } from "../lib/dom";
import { addDays, formatDay, formatLongitude, formatSigned } from "../lib/format";
import { binColor } from "../map/shading";
import type { BinLegend, DriverIndex, DriversDocument } from "../types";

const WEST = 40;
const EAST = 280;
const MARITIME = [100, 140];
const MARGIN = { left: 58, right: 10, top: 22, bottom: 24 };

function indexCard(index: DriverIndex, firstDay: string): HTMLElement {
  const weekly = index.weekly.map((value, week) => `W${week + 1} ${formatSigned(value, 2)}`).join(" · ");
  return h(
    "section",
    { class: "wpanel wdriver" },
    plumeChart(index.plume, { title: index.label, units: `${index.units}, departure from model normal`, digits: 2, firstDay, zeroFloor: false, zeroLine: true }),
    h("p", { class: "wdriver__weeks" }, `Ensemble mean by week: ${weekly} ${index.units}`),
    h("p", { class: "wtable__note" }, index.description),
  );
}

/** Time-longitude section of equatorial convection: eastward-moving bands are the MJO. */
function hovmoller(document: DriversDocument, legend: BinLegend): HTMLElement {
  const { values, longitude } = document.hovmoller;
  const canvas = h("canvas", { class: "whov__canvas", role: "img", "aria-label": "Time-longitude section of the outgoing longwave radiation anomaly near the equator" });
  const tooltip = h("div", { class: "wmap__tooltip", hidden: true });
  const host = h("div", { class: "whov" }, canvas, tooltip);
  const columns = longitude.map((lon, index) => ({ lon, index })).filter(({ lon }) => lon >= WEST && lon <= EAST);
  const days = values.length;

  const draw = (): void => {
    const width = Math.max(320, host.clientWidth);
    const height = 430;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const [cellWidth, cellHeight] = [plotWidth / columns.length, plotHeight / days];
    const x = (lon: number): number => MARGIN.left + ((lon - WEST) / (EAST - WEST)) * plotWidth;
    values.forEach((row, day) => {
      columns.forEach(({ index }, column) => {
        context.fillStyle = binColor(row[index], legend);
        context.fillRect(MARGIN.left + column * cellWidth, MARGIN.top + day * cellHeight, cellWidth + 0.6, cellHeight + 0.6);
      });
    });
    context.font = "11px system-ui, sans-serif";
    context.fillStyle = "#47606a";
    context.strokeStyle = "rgb(16 45 60 / 55%)";
    context.lineWidth = 1;
    context.textBaseline = "middle";
    for (let day = 0; day < days; day += 7) {
      context.fillText(formatDay(addDays(document.first_day, day)), 6, MARGIN.top + day * cellHeight + 6);
    }
    context.textBaseline = "top";
    context.textAlign = "center";
    for (let lon = 60; lon <= EAST; lon += 30) context.fillText(formatLongitude(lon), x(lon), height - 16);
    context.beginPath();
    for (const lon of MARITIME) {
      context.moveTo(x(lon), MARGIN.top);
      context.lineTo(x(lon), height - MARGIN.bottom);
    }
    context.stroke();
    context.fillStyle = "#102d3c";
    context.fillText("Maritime Continent", x((MARITIME[0] + MARITIME[1]) / 2), 4);
    context.textAlign = "left";
  };

  canvas.addEventListener("pointermove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    const plotWidth = bounds.width - MARGIN.left - MARGIN.right;
    const plotHeight = bounds.height - MARGIN.top - MARGIN.bottom;
    const column = Math.floor(((event.clientX - bounds.left - MARGIN.left) / plotWidth) * columns.length);
    const day = Math.floor(((event.clientY - bounds.top - MARGIN.top) / plotHeight) * days);
    tooltip.hidden = !(columns[column] && values[day]);
    if (tooltip.hidden) return;
    tooltip.replaceChildren(
      h("strong", {}, `${formatSigned(values[day][columns[column].index], 1)} ${document.hovmoller.units}`),
      h("span", {}, `${formatDay(addDays(document.first_day, day))} · ${formatLongitude(columns[column].lon)}`),
    );
    tooltip.style.left = `${event.clientX - bounds.left}px`;
    tooltip.style.top = `${event.clientY - bounds.top}px`;
    tooltip.classList.toggle("wmap__tooltip--left", event.clientX - bounds.left > bounds.width * 0.6);
  });
  canvas.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
  });
  const observer = new ResizeObserver(draw);
  observer.observe(host);
  window.setTimeout(draw, 0);
  return host;
}

/** Large-scale tropical drivers of the next six weeks, from the same ensemble. */
export function renderDrivers(root: HTMLElement, app: App, issue: Issue): () => void {
  const product = app.products.products.find((item) => item.id === "olr_anom");
  root.append(
    h("h2", { class: "wpage__title" }, "Tropical drivers"),
    h("p", { class: "wnote" },
      "What the same ensemble says about the slow tropical patterns that steer rainfall over Southeast Asia. All values are departures from the model's own normal for the same lead and time of year; shading on each chart is the middle 80% of members."),
  );
  void loadJson<DriversDocument>(`${issue.base}${issue.manifest.drivers}?v=${encodeURIComponent(issue.manifest.generated_at)}`).then((document) => {
    const cards = h("div", { class: "wdrivers" }, ...document.indices.map((index) => indexCard(index, document.first_day)));
    root.append(cards);
    if (product) {
      const legend = legendFor(app, product) as BinLegend;
      const [south, north] = document.hovmoller.band;
      root.append(
        h(
          "section",
          { class: "wpanel" },
          h("div", { class: "wmap__caption" },
            h("div", { class: "wmap__title" },
              h("strong", {}, "Equatorial convection by longitude and time"),
              h("span", {}, `${document.hovmoller.label}, ensemble mean, ${Math.abs(south)}°S–${north}°N`)),
            createLegend(product, legend)),
          hovmoller(document, legend),
          h("p", { class: "wtable__note" },
            "Time runs downward. Blue is more deep convection than normal, brown is less. A blue band sloping down to the right is an active phase of the Madden–Julian Oscillation moving east; it brings a wetter spell when it crosses the Maritime Continent. The ensemble mean smooths this signal at longer leads."),
        ),
      );
    }
    root.dataset.ready = "true";
  });
  return () => undefined;
}
