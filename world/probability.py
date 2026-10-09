"""Tercile probabilities from forecast members against model-climate thresholds."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from science.formulas import valid_member_tercile_probabilities

CATEGORIES = ("below", "near", "above")


def tercile_probabilities(
    members: NDArray[np.floating], lower: NDArray[np.floating], upper: NDArray[np.floating]
) -> dict[str, NDArray[np.float64]]:
    """Percent of members below, within and above the climatological terciles.

    Members are on axis 0. Cells whose two thresholds coincide have no defined
    categories and come back as NaN.
    """

    probabilities, _, _ = valid_member_tercile_probabilities(members, lower, upper)
    return {
        "below": probabilities["below_normal"],
        "near": probabilities["near_normal"],
        "above": probabilities["above_normal"],
    }


def dry_weeks(upper_tercile_mm: NDArray[np.floating], threshold_mm: float) -> NDArray[np.bool_]:
    """Weeks so dry in the model climate that rainfall categories mean nothing."""

    return np.asarray(upper_tercile_mm) < threshold_mm


def whole_percentages(below: float, near: float, above: float) -> dict[str, int]:
    """Round three percentages to integers that still sum to 100."""

    exact = np.array([below, near, above], dtype=np.float64)
    floors = np.floor(exact).astype(int)
    order = np.argsort(-(exact - floors), kind="stable")
    floors[order[: 100 - int(floors.sum())]] += 1
    return dict(zip(CATEGORIES, floors.tolist()))


def dominant(percentages: dict[str, int]) -> str:
    """The most likely category; "none" when below and above tie for first."""

    best = max(percentages.values())
    if percentages["below"] == best and percentages["above"] == best:
        return "none"
    if percentages["near"] == best:
        return "near"
    return "below" if percentages["below"] == best else "above"
