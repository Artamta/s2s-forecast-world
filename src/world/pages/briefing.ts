import type { Issue } from "../lib/app";
import { h } from "../lib/dom";
import { formatFullDate } from "../lib/format";

/** Written briefings; none has been published yet. */
export function renderBriefing(root: HTMLElement, issue: Issue): () => void {
  root.append(
    h(
      "section",
      { class: "wempty" },
      h("span", { class: "wempty__eyebrow" }, "Briefing"),
      h("h2", {}, "No briefing has been published for this issue yet."),
      h("p", {}, `Written analysis of the world outlook will appear here. The current maps are from the issue of ${formatFullDate(issue.manifest.issue_date)}.`),
      h("a", { class: "wbutton", href: "#forecast" }, "Go to the forecast maps"),
    ),
  );
  root.dataset.ready = "true";
  return () => undefined;
}
