import "./styles/world.css";
import { findIssue, loadApp, loadIssue, type App, type Issue } from "./lib/app";
import { clear, h } from "./lib/dom";
import { formatFullDate } from "./lib/format";
import { readUrl, writeUrl, type Route } from "./lib/url";

const ROUTE_LABELS: Record<Route, string> = {
  forecast: "Map",
  outlook: "Regions",
  skill: "Skill",
  drivers: "Drivers",
  about: "About",
};

const root = document.getElementById("app") as HTMLElement;
let cleanup: () => void = () => undefined;

/** Screenshot tools capture at the load event; this keeps it pending while the page draws. */
function holdLoadForSnapshot(): void {
  const pending = h("img", { src: "./__hold", alt: "", hidden: true });
  document.body.append(pending);
}

function availableRoutes(app: App, issue: Issue): Route[] {
  const routes: Route[] = ["forecast", "outlook"];
  if (issue.manifest.drivers) routes.push("drivers");
  if (app.skill) routes.push("skill");
  return [...routes, "about"];
}

function header(app: App, issue: Issue, route: Route): HTMLElement {
  const nav = h("nav", { class: "wnav", "aria-label": "World outlook sections" });
  for (const item of availableRoutes(app, issue)) {
    nav.append(h("a", { href: `#${item}`, class: item === route ? "is-current" : "", "aria-current": item === route ? "page" : null }, ROUTE_LABELS[item]));
  }
  const issues = h("select", { "aria-label": "Forecast issue" });
  for (const source of app.catalog.sources) {
    for (const entry of source.issues) {
      const selected = source.id === issue.manifest.source && entry.id === issue.manifest.issue;
      issues.append(h("option", { value: `${source.id}/${entry.id}`, selected }, `${formatFullDate(entry.issue_date)} · ${source.label}`));
    }
  }
  issues.addEventListener("change", () => {
    const [source, id] = issues.value.split("/");
    writeUrl({ source, issue: id });
    void render();
  });
  return h(
    "header",
    { class: "wheader" },
    h("div", { class: "wheader__brand" },
      h("a", { href: "./index.html", class: "wheader__home" }, "S2S Research"),
      h("h1", {}, "World subseasonal outlook"),
      h("span", { class: "wheader__badge" }, "Experimental")),
    nav,
    h("label", { class: "wheader__issue" }, h("span", {}, "Issue"), issues),
  );
}

async function render(): Promise<void> {
  const url = readUrl();
  const app = await appPromise;
  const { entry } = findIssue(app.catalog, url.source, url.issue);
  const issue = await loadIssue(entry);
  const route = availableRoutes(app, issue).includes(url.route) ? url.route : "forecast";
  cleanup();
  clear(root);
  const page = h("main", { id: "content", class: `wpage wpage--${route}` });
  root.append(header(app, issue, route), page);
  const openRegion = (regionId: string): void => {
    writeUrl({ region: regionId });
    window.location.hash = "forecast";
  };
  if (route === "outlook") {
    cleanup = (await import("./pages/outlook")).renderOutlook(page, app, issue, openRegion);
  } else if (route === "drivers") {
    cleanup = (await import("./pages/drivers")).renderDrivers(page, app, issue);
  } else if (route === "skill" && app.skill) {
    cleanup = (await import("./pages/skill")).renderSkill(page, app, app.skill, issue, url);
  } else if (route === "about") {
    cleanup = (await import("./pages/about")).renderAbout(page, app, issue);
  } else {
    cleanup = (await import("./pages/forecast")).renderForecast(page, app, issue, url);
  }
}

function fail(error: unknown): void {
  clear(root);
  root.append(
    h("div", { class: "wblocked" },
      h("h1", {}, "The world outlook could not be loaded"),
      h("p", {}, error instanceof Error ? error.message : String(error))),
  );
}

// A page that fails while loading shows the reason instead of a half-drawn view.
window.addEventListener("unhandledrejection", (event) => fail(event.reason));
window.addEventListener("error", (event) => fail(event.error ?? event.message));

if (readUrl().snapshot) holdLoadForSnapshot();
const appPromise = loadApp();
window.addEventListener("hashchange", () => void render().catch(fail));
void render().catch(fail);
