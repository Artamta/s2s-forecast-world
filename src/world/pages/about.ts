import type { App, Issue } from "../lib/app";
import { h } from "../lib/dom";
import { formatFullDate, formatSigned } from "../lib/format";

function block(title: string, ...paragraphs: string[]): HTMLElement {
  return h("section", { class: "wabout__section" }, h("h3", {}, title), ...paragraphs.map((text) => h("p", {}, text)));
}

function driftSentence(issue: Issue): string {
  const departure = issue.manifest.climate?.mean_departure_60s_60n?.t2m;
  if (!departure) return "No drift check is available for this issue.";
  const weeks = departure.map((value, index) => `W${index + 1} ${formatSigned(value, 2)}`).join(", ");
  return `Mean temperature departure from normal over 60°S–60°N in this issue, by week: ${weeks} °C. A steady slide across the weeks would be model drift, not a forecast signal.`;
}

/** What the page shows, how it is made and where it should not be trusted. */
export function renderAbout(root: HTMLElement, app: App, issue: Issue): () => void {
  const { manifest } = issue;
  const coarse = app.regions.regions.filter((region) => region.tier !== "A").length;
  root.append(
    h("div", { class: "wstage__title" }, h("h2", {}, "About this outlook"), h("p", {}, "Experimental research guidance. Not an operational forecast, warning or decision trigger.")),
    h(
      "div",
      { class: "wabout" },
      block(
        "What it shows",
        `A six-week outlook from one global ${manifest.members}-member ensemble run of a machine-learning subseasonal model, issued ${formatFullDate(manifest.issue_date)}. Every region on this site is a mask over the same global fields.`,
        "Weeks are consecutive seven-day blocks from the issue date. Rainfall is the weekly total; temperature is the weekly mean two metres above the surface; wind is at 850 hPa, about 1.5 km up.",
      ),
      block(
        "Normal, anomaly and outlook",
        manifest.climate
          ? `Normal is the model's own climate: ${manifest.climate.members_per_year}-member hindcasts for ${manifest.climate.years[0]}–${manifest.climate.years[1]} at the same lead and time of year. An anomaly is the departure from that normal.`
          : "This issue was exported without the model climate, so only absolute values are shown.",
        "The outlook is the share of ensemble members below, within and above the middle third of that climate. These are raw ensemble fractions and are not calibrated against observations.",
        "Where a week is normally almost rainless, it is treated as dry season and no rainfall outlook is given.",
      ),
      block(
        "Regions and the grid",
        "The model grid is 1.5° (about 165 km at the equator). Islands and small countries span only a few cells; detail finer than that comes from interpolation, not from the model.",
        `Region values are area means over land. Of ${app.regions.regions.length} regions, ${coarse} are small enough to be flagged as coarse.`,
      ),
      block(
        "Known limits",
        "The model climate comes from reanalysis-initialised hindcasts, while this forecast starts from an operational analysis, so anomalies can carry an offset.",
        driftSentence(issue),
        "Temperature over inland Antarctica drifts far too cold after week 2 and should be ignored.",
        "Boundaries follow Natural Earth's India-view edition and are for orientation only.",
      ),
    ),
  );
  root.dataset.ready = "true";
  return () => undefined;
}
