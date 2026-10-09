import type { App } from "../lib/app";
import { h } from "../lib/dom";
import type { RegionInfo } from "../types";

function option(region: RegionInfo, label: string, selected: string): HTMLOptionElement {
  return h("option", { value: region.id, selected: region.id === selected }, label);
}

function regionOptions(app: App, groupId: string, selected: string): Array<HTMLOptionElement | HTMLOptGroupElement> {
  const group = app.regionById.get(groupId) as RegionInfo;
  const members = group.children.map((id) => app.regionById.get(id) as RegionInfo);
  const items: Array<HTMLOptionElement | HTMLOptGroupElement> = [option(group, `All of ${group.label}`, selected)];
  const boxes = members.filter((region) => region.kind === "climate_box");
  const countries = members.filter((region) => region.kind === "country");
  const list = h("optgroup", { label: groupId === "world" ? "Areas" : "Countries" });
  for (const region of groupId === "world" ? members : countries) {
    list.append(option(region, region.label, selected));
    for (const childId of groupId === "world" ? [] : region.children) {
      const child = app.regionById.get(childId) as RegionInfo;
      list.append(option(child, `   ${child.label}`, selected));
    }
  }
  items.push(list);
  if (boxes.length && groupId !== "world") {
    items.push(h("optgroup", { label: "Climate boxes" }, ...boxes.map((box) => option(box, box.label, selected))));
  }
  return items;
}

/** Two selects: the part of the world, then the region inside it. */
export function regionPicker(app: App, selected: RegionInfo, onChange: (regionId: string) => void): HTMLElement {
  const groupId = selected.kind === "group" ? selected.id : selected.group;
  const groups = h(
    "select",
    { "aria-label": "Part of the world" },
    ...app.regions.groups.map((id) => option(app.regionById.get(id) as RegionInfo, (app.regionById.get(id) as RegionInfo).label, groupId)),
  );
  const regions = h("select", { "aria-label": "Region" }, ...regionOptions(app, groupId, selected.id));
  groups.addEventListener("change", () => onChange(groups.value));
  regions.addEventListener("change", () => onChange(regions.value));
  return h(
    "div",
    { class: "wpicker" },
    h("label", {}, h("span", {}, "Area"), groups),
    h("label", {}, h("span", {}, "Region"), regions),
  );
}
