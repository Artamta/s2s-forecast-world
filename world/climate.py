"""Model climate of weekly rainfall and temperature from hindcast members.

Statistics pool every member of every hindcast year at one calendar slot, so
tercile thresholds describe the same kind of sample as a forecast member.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import numpy as np
from numpy.typing import NDArray

from science.calendar import calendar_bracket, native_slot
from science.formulas import calendar_interpolation

QUANTILES = (0.05, 0.10, 0.20, 0.25, 1.0 / 3.0, 0.50, 2.0 / 3.0, 0.75, 0.80, 0.90, 0.95)
LOWER_TERCILE, MEDIAN, UPPER_TERCILE = 4, 5, 6
YEAR_SETS = {"y2002_2021": (2002, 2021), "y2002_2016": (2002, 2016)}
VARIABLES = ("rain", "t2m")


def init_days(nanoseconds: NDArray[np.int64]) -> list[date]:
    """Decode the cache's init coordinate (nanoseconds since 1970)."""

    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return [(epoch + timedelta(seconds=int(value) // 10**9)).date() for value in nanoseconds]


def slot_index(days: list[date]) -> dict[str, list[int]]:
    """Positions of every hindcast start, grouped by calendar slot (MMDD)."""

    slots: dict[str, list[int]] = {}
    for position, day in enumerate(days):
        slots.setdefault(native_slot(day.strftime("%Y%m%d")), []).append(position)
    return dict(sorted(slots.items()))


def pooled_statistics(samples: NDArray[np.float32]) -> dict[str, NDArray[np.float32]]:
    """Mean, spread and quantiles over axis 0 (years x members pooled)."""

    return {
        "mean": samples.mean(axis=0, dtype=np.float64).astype(np.float32),
        "std": samples.std(axis=0, dtype=np.float64).astype(np.float32),
        "q": np.quantile(samples, QUANTILES, axis=0).astype(np.float32),
    }


def bracket(slots: list[str], target: str) -> tuple[str, str, float]:
    """The two slots around a model-state day and the weight of the later one."""

    return calendar_bracket(slots, target, cyclic=True, native_february=True)


def interpolate(left: NDArray, right: NDArray, right_weight: float) -> NDArray[np.float64]:
    return calendar_interpolation(left, right, right_weight)
