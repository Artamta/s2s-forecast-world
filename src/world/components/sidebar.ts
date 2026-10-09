import { areaOf, type App } from "../lib/app";
import { h } from "../lib/dom";
import type { RegionInfo } from "../types";

/** Short names for the area buttons; anything missing falls back to the full label. */
const AREA_SHORT: Record<string, string> = {
  world: "World",
  seasia: "Southeast Asia",
  easia: "East Asia",
  sasia: "South Asia",
  wcasia: "West & Central Asia",
  pacific: "Australia & Pacific",
  africa: "Africa",
  europe: "Europe",
  namerica: "North America",
  samerica: "South America",
};

export function areaLabel(region: RegionInfo): string {
  return AREA_SHORT[region.id] ?? region.label;
}

/** A titled block of the side panel. */
export function section(title: string, ...children: Array<HTMLElement | null | false>): HTMLElement {
  return h("section", { class: "wsb__section" }, h("h3", {}, title), ...children);
}

/** One button per part of the world. */
export function areaButtons(app: App, selectedId: string, onPick: (areaId: string) => void): HTMLElement {
  const grid = h("div", { class: "wsb__areas", role: "group", "aria-label": "Area" });
  for (const id of app.regions.groups) {
    const area = app.regionById.get(id) as RegionInfo;
    const button = h(
      "button",
      { type: "button", class: id === selectedId ? "is-selected" : "", "aria-pressed": String(id === selectedId) },
      areaLabel(area),
    );
    button.addEventListener("click", () => onPick(id));
    grid.append(button);
  }
  return grid;
}

interface ListItem {
  region: RegionInfo;
  label: string;
  depth: number;
}

function listItems(app: App, area: RegionInfo, selected: RegionInfo, query: string): ListItem[] {
  const get = (id: string): RegionInfo => app.regionById.get(id) as RegionInfo;
  const children = area.children.map(get);
  if (query) {
    const matches = (region: RegionInfo): boolean => region.label.toLowerCase().includes(query);
    return children
      .flatMap((child) => [child, ...(area.id === "world" ? [] : child.children.map(get))])
      .filter(matches)
      .map((region) => ({ region, label: region.label, depth: 0 }));
  }
  const items: ListItem[] = [{ region: area, label: area.id === "world" ? "Whole world" : `All of ${areaLabel(area)}`, depth: 0 }];
  const places = children.filter((child) => child.kind !== "climate_box");
  for (const child of places) {
    items.push({ region: child, label: area.id === "world" ? areaLabel(child) : child.label, depth: 0 });
    const open = area.id !== "world" && (selected.id === child.id || selected.parent === child.id);
    if (open) for (const id of child.children) items.push({ region: get(id), label: get(id).label, depth: 1 });
  }
  for (const box of children.filter((child) => child.kind === "climate_box")) {
    items.push({ region: box, label: box.label, depth: 0 });
  }
  return items;
}

/** A search box and a scrolling list of the regions in the selected area. */
export function regionList(app: App, selected: RegionInfo, onPick: (regionId: string) => void): HTMLElement {
  const area = areaOf(app, selected);
  const search = h("input", { type: "search", id: "region-search", placeholder: "Find a country or region", "aria-label": "Find a region" });
  const list = h("ul", { class: "wsb__list" });
  const draw = (): void => {
    const items = listItems(app, area, selected, search.value.trim().toLowerCase());
    list.replaceChildren(
      ...items.map(({ region, label, depth }) => {
        const chosen = region.id === selected.id;
        const button = h(
          "button",
          { type: "button", class: `wsb__region wsb__region--${depth}${chosen ? " is-selected" : ""}`, "aria-current": chosen ? "true" : null },
          label,
        );
        button.addEventListener("click", () => onPick(region.id));
        return h("li", {}, button);
      }),
    );
    if (!items.length) list.append(h("li", { class: "wsb__empty" }, "No region matches."));
  };
  search.addEventListener("input", draw);
  draw();
  window.setTimeout(() => list.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" }), 0);
  return h("div", { class: "wsb__regions" }, search, list);
}

/** A row of mutually exclusive buttons. */
export function segmented<T extends string>(
  name: string,
  options: Array<{ id: T; label: string }>,
  selected: T,
  onPick: (id: T) => void,
): HTMLElement {
  const row = h("div", { class: "wseg", role: "group", "aria-label": name });
  for (const option of options) {
    const chosen = option.id === selected;
    const button = h("button", { type: "button", class: chosen ? "is-selected" : "", "aria-pressed": String(chosen) }, option.label);
    button.addEventListener("click", () => onPick(option.id));
    row.append(button);
  }
  return row;
}

/** A labelled on/off switch. */
export function switchRow(id: string, label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox", id, checked });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "wswitch", for: id }, input, h("span", { class: "wswitch__track", "aria-hidden": "true" }), h("span", {}, label));
}
