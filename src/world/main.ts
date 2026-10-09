import "./styles/world.css";
import { findIssue, loadApp, loadIssue, type App, type Issue } from "./lib/app";
import { clear, h } from "./lib/dom";
import { formatFullDate } from "./lib/format";
import { readUrl, ROUTES, writeUrl, type Route } from "./lib/url";

const NAV: Record<Route, { label: string; hint: string }> = {
  forecast: { label: "Forecast", hint: "Weekly maps" },
  regions: { label: "Regions", hint: "By country" },
  briefing: { label: "Briefing", hint: "Analysis" },
  about: { label: "About", hint: "Method & limits" },
};

const root = document.getElementById("app") as HTMLElement;
let cleanup: () => void = () => undefined;

/** Screenshot tools capture at the load event; this keeps it pending while the page draws. */
function holdLoadForSnapshot(): void {
  document.body.append(h("img", { src: "./__hold", alt: "", hidden: true }));
}

function header(app: App, issue: Issue, route: Route): HTMLElement {
  const nav = h("nav", { class: "wnav", "aria-label": "Sections" });
  for (const item of ROUTES) {
    nav.append(
      h("a", { href: `#${item}`, class: item === route ? "is-current" : "", "aria-current": item === route ? "page" : null },
        h("strong", {}, NAV[item].label), h("small", {}, NAV[item].hint)),
    );
  }
  const issues = h("select", { id: "issue-select", "aria-label": "Forecast issue" });
  for (const source of app.catalog.sources) {
    for (const entry of source.issues) {
      const selected = source.id === issue.manifest.source && entry.id === issue.manifest.issue;
      issues.append(h("option", { value: `${source.id}/${entry.id}`, selected }, formatFullDate(entry.issue_date)));
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
    h(
      "div",
      { class: "wheader__inner" },
      h("div", { class: "wbrand" },
        h("a", { href: "#forecast", class: "wbrand__name" }, h("strong", {}, "S2S Forecast"), h("small", {}, "World outlook")),
        h("span", { class: "wbrand__tag" }, "Experimental")),
      nav,
      h("label", { class: "wheader__issue", for: "issue-select" }, h("span", {}, "Issued"), issues),
    ),
  );
}

function footer(): HTMLElement {
  return h(
    "footer",
    { class: "wfooter" },
    h("strong", {}, "S2S Research"),
    h("span", {}, "Experimental research guidance · Not an operational forecast, warning or decision trigger."),
  );
}

async function render(): Promise<void> {
  const url = readUrl();
  const app = await appPromise;
  const { entry } = findIssue(app.catalog, url.source, url.issue);
  const issue = await loadIssue(entry);
  const route = url.route;
  cleanup();
  clear(root);
  const page = h("main", { id: "content", class: `wpage wpage--${route}` });
  root.append(header(app, issue, route), page, footer());
  const openOnMap = (regionId: string): void => {
    writeUrl({ region: regionId });
    window.location.hash = "forecast";
  };
  if (route === "regions") {
    cleanup = (await import("./pages/regions")).renderRegions(page, app, issue, url, openOnMap);
  } else if (route === "briefing") {
    cleanup = (await import("./pages/briefing")).renderBriefing(page, issue);
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
