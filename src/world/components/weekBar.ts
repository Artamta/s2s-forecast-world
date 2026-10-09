import { h } from "../lib/dom";
import { formatRange } from "../lib/format";
import type { WeekWindow } from "../types";

export interface WeekBar {
  element: HTMLElement;
  setWeek(week: number): void;
  setPlaying(playing: boolean): void;
}

/** Play button and one button per forecast week. */
export function weekBar(weeks: WeekWindow[], onWeek: (week: number) => void, onTogglePlay: () => void): WeekBar {
  const play = h("button", { type: "button", class: "wweeks__play", id: "play-weeks", "aria-pressed": "false" }, "▶ Play");
  play.addEventListener("click", onTogglePlay);
  const buttons = weeks.map((window, index) => {
    const button = h(
      "button",
      { type: "button", class: "wweeks__week" },
      h("strong", {}, `Week ${window.week}`),
      h("span", {}, formatRange(window.valid_start, window.valid_end)),
    );
    button.addEventListener("click", () => onWeek(index));
    return button;
  });
  const element = h("div", { class: "wweeks", role: "group", "aria-label": "Forecast week" }, play, ...buttons);
  return {
    element,
    setWeek(week) {
      buttons.forEach((button, index) => {
        button.classList.toggle("is-selected", index === week);
        button.setAttribute("aria-pressed", String(index === week));
      });
    },
    setPlaying(playing) {
      play.textContent = playing ? "❚❚ Pause" : "▶ Play";
      play.setAttribute("aria-pressed", String(playing));
      play.classList.toggle("is-playing", playing);
    },
  };
}
