import type { App, Issue } from "../lib/app";
import { h } from "../lib/dom";
import { formatFullDate, formatSigned } from "../lib/format";

function section(title: string, ...paragraphs: string[]): HTMLElement {
  return h("section", { class: "wabout__section" }, h("h3", {}, title), ...paragraphs.map((text) => h("p", {}, text)));
}

function driftSentence(issue: Issue): string {
  const departure = issue.manifest.climate?.mean_departure_60s_60n?.t2m;
  if (!departure) return "No drift diagnostic is available for this issue.";
  const weeks = departure.map((value, index) => `W${index + 1} ${formatSigned(value, 2)}`).join(", ");
  return `Mean temperature departure from the model normal over 60°S–60°N in this issue, by week: ${weeks} °C. A steady slide across the weeks is model drift from the starting analysis, not a forecast signal, and it pushes temperature outlooks the same way everywhere.`;
}

/** What the page shows, how it is made and where it should not be trusted. */
export function renderAbout(root: HTMLElement, app: App, issue: Issue): () => void {
  const { manifest } = issue;
  const tiers = app.regions.regions.reduce<Record<string, number>>((count, region) => {
    count[region.tier] = (count[region.tier] ?? 0) + 1;
    return count;
  }, {});
  root.append(
    h("h2", { class: "wpage__title" }, "About this page"),
    h(
      "div",
      { class: "wabout" },
      section(
        "What it shows",
        `An experimental six-week outlook from one global ${manifest.members}-member ensemble run of a machine-learning subseasonal model, issued ${formatFullDate(manifest.issue_date)}. The same run feeds every region on this page: a region is a mask over the global fields, not a separate forecast.`,
        "Weeks are consecutive seven-day blocks starting on the issue date. Rainfall is the weekly total; temperature is the weekly mean two metres above the surface.",
      ),
      section(
        "Normal, anomaly and outlook",
        manifest.climate
          ? `“Normal” is the model's own climate: ${manifest.climate.members_per_year}-member hindcasts for ${manifest.climate.years[0]}–${manifest.climate.years[1]}, at the same lead week and time of year. Anomalies are departures from that model normal, so the model's average bias is removed.`
          : "This issue was exported without the model climate, so only absolute values are shown.",
        "The outlook is the share of ensemble members falling below, within and above the middle third of that model climate. These are raw member fractions and have not been calibrated against observations.",
        "Where the upper third of the model climate is under 1 mm in a week, the week is treated as dry season and no rainfall outlook is given.",
      ),
      section(
        "Regions and the grid",
        "The model grid is 1.5° (about 165 km at the equator). Islands and small countries span only a few cells, and detail below that size comes from interpolation, not from the model.",
        `Region values are area means using the exact share of each cell that lies inside the region. Of ${app.regions.regions.length} regions, ${tiers.A ?? 0} cover at least ${app.regions.tiers.A} cells, ${tiers.B ?? 0} are flagged coarse, and ${tiers.C ?? 0} are smaller than ${app.regions.tiers.B} cells and shown as nearest-cell guidance only.`,
      ),
      section(
        "Known limits",
        "The model climate comes from ERA5-initialised hindcasts, while this forecast starts from an operational analysis, so anomalies can carry an offset from that difference.",
        driftSentence(issue),
        "Near-surface temperature drifts far too cold over inland Antarctica after week 2. Temperature there should be ignored.",
        "Boundaries follow Natural Earth's India-view edition and are for orientation only.",
      ),
    ),
  );
  root.dataset.ready = "true";
  return () => undefined;
}
