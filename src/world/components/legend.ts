import { h } from "../lib/dom";
import type { BinLegend, Product, TercileLegend } from "../types";

function swatch(color: string): HTMLElement {
  const element = h("span", { class: "wlegend__swatch" });
  element.style.backgroundColor = color;
  return element;
}

function ticks(labels: Array<[string, number]>): HTMLElement {
  const row = h("div", { class: "wlegend__ticks" });
  for (const [text, position] of labels) {
    const tick = h("span", {}, text);
    tick.style.left = `${position * 100}%`;
    row.append(tick);
  }
  return row;
}

function binLegend(legend: BinLegend, units: string): HTMLElement {
  const colors = [legend.under, ...legend.colors, legend.over];
  const every = legend.boundaries.length > 11 ? 2 : 1;
  const labels = legend.boundaries
    .map((boundary, index): [string, number] => [String(boundary).replace("-", "−"), (index + 1) / colors.length])
    .filter((_, index) => index % every === 0);
  return h(
    "div",
    { class: "wlegend" },
    h("div", { class: "wlegend__ends" }, h("span", {}, units)),
    h("div", { class: "wlegend__bar" }, ...colors.map(swatch)),
    ticks(labels),
  );
}

/** One bar: likelier below normal to the left, likelier above normal to the right. */
function tercileLegend(legend: TercileLegend): HTMLElement {
  const count = legend.steps.length;
  const colors = [...[...legend.below].reverse(), legend.near, ...legend.above];
  const labels: Array<[string, number]> = [];
  legend.steps.forEach((step, index) => {
    const text = index === count - 1 ? `${step}%+` : `${step}`;
    labels.push([text, (count - index - 0.5) / colors.length], [text, (count + 1 + index + 0.5) / colors.length]);
  });
  return h(
    "div",
    { class: "wlegend" },
    h("div", { class: "wlegend__ends" }, h("span", {}, `${legend.below_label} likely`), h("span", {}, `${legend.above_label} likely`)),
    h("div", { class: "wlegend__bar" }, ...colors.map(swatch)),
    ticks(labels),
  );
}

/** Legend for the product on the map. */
export function createLegend(product: Product, legend: BinLegend | TercileLegend): HTMLElement {
  const body =
    product.kind === "tercile" ? tercileLegend(legend as TercileLegend) : binLegend(legend as BinLegend, product.units);
  body.setAttribute("aria-label", `Legend: ${product.label}`);
  return body;
}
