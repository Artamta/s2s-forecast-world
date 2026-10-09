#!/usr/bin/env python3
"""Score one calendar slot of the hindcast against ERA5 and IMERG.

Cases are the 2017-2021 starts only: the model was trained on earlier years,
which inflates skill there. Model terciles and means come from 2002-2016
hindcasts; observed ones from the same years of each truth dataset. Sums are
written per cell and per region, to be added across slots by export_skill.py.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from science.zarr_v2 import read_array, read_axis0_slice  # noqa: E402
from world import climate, grid, scores, timing  # noqa: E402
from world.pipeline.build_slot_climate import weekly_members, weight_matrix, write_dataset  # noqa: E402
from world.pipeline.common import load_paths, load_region_weights  # noqa: E402

EVALUATION_YEARS = range(2017, 2022)
CLIMATE_YEARS = range(2002, 2017)
CLIMATE_OFFSETS = (-4, 0, 4)
MODEL_YEAR_SET = "y2002_2016"
PAIRS = (("rain", "era5"), ("t2m", "era5"), ("rain", "imerg"))
DRY_WEEK_MM = 1.0
KELVIN = 273.15
MINIMUM_REGION_COVERAGE = 0.8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-index", type=int, required=True, help="0-103, one calendar slot")
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    return parser.parse_args()


class Truth:
    """Weekly truth fields by the first UTC day of the week, in display units."""

    def __init__(self, paths: dict[str, str], variable: str, source: str) -> None:
        self.variable, self.source = variable, source
        if source == "era5":
            self.store, self.name = Path(paths["era5_truth"]), "tp_L7" if variable == "rain" else "t2m_L7"
            self.epoch, self.chunk = date(1961, 1, 1), 366
        else:
            self.store, self.name = Path(paths["imerg_daily"]), "tp"
            self.epoch, self.chunk = date(2002, 1, 1), 31
        self.length = int(read_array(self.store, "time").shape[0])

    @lru_cache(maxsize=24)  # noqa: B019 - one instance per job
    def _chunk(self, index: int) -> np.ndarray:
        start = index * self.chunk
        return read_axis0_slice(self.store, self.name, start, min(self.length, start + self.chunk))

    def _days(self, first: int, count: int) -> np.ndarray:
        """Consecutive stored days, read through the chunk cache."""

        if first < 0 or first + count > self.length:
            raise ValueError(f"{self.source} has no data for day index {first}")
        rows = [self._chunk(day // self.chunk)[day % self.chunk] for day in range(first, first + count)]
        return np.stack(rows)

    def has(self, start: date) -> bool:
        index = (start - self.epoch).days
        return index >= 0 and index + 7 <= self.length

    def week(self, start: date) -> np.ndarray:
        index = (start - self.epoch).days
        if self.source == "imerg":
            return self._days(index, 7).sum(axis=0)
        value = self._days(index, 1)[0]
        return value - KELVIN if self.variable == "t2m" else value


def same_day(year: int, day: date) -> date:
    """The same calendar day in another year; 29 February becomes the 28th."""

    return date(year, day.month, 28 if (day.month, day.day) == (2, 29) else day.day)


def observed_samples(truth: Truth, start: date) -> np.ndarray:
    """Truth weeks around the same calendar day in each climate year: (45, lat, lon)."""

    starts = [same_day(year, start) + timedelta(days=offset) for year in CLIMATE_YEARS for offset in CLIMATE_OFFSETS]
    return np.stack([truth.week(day) for day in starts if truth.has(day)])


def summarise(samples: np.ndarray) -> dict[str, np.ndarray]:
    """Mean and tercile edges over axis 0."""

    lower, upper = np.quantile(samples, [1.0 / 3.0, 2.0 / 3.0], axis=0)
    return {"mean": samples.mean(axis=0), "lower": lower, "upper": upper}


def region_means(field: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Region means of (..., lat, lon); NaN where too little of the region has data."""

    flat = field.reshape(*field.shape[:-2], -1)
    present = np.isfinite(flat)
    coverage = present.astype(np.float32) @ matrix.T
    totals = np.where(present, flat, 0.0).astype(np.float32) @ matrix.T
    return np.where(coverage >= MINIMUM_REGION_COVERAGE, totals / np.maximum(coverage, 1e-9), np.nan)


def scoreable(variable: str, model: dict[str, np.ndarray], observed: dict[str, np.ndarray]) -> np.ndarray:
    """Tercile categories exist: distinct edges and, for rainfall, not a dry-season week."""

    defined = (model["lower"] < model["upper"]) & (observed["lower"] < observed["upper"])
    if variable == "rain":
        defined &= (model["upper"] >= DRY_WEEK_MM) & (observed["upper"] >= DRY_WEEK_MM)
    return defined


def observed_climate(truth: Truth, start: date, matrix: np.ndarray) -> dict[str, object]:
    """Observed samples and their summaries, for cells and for regions."""

    samples = observed_samples(truth, start)
    region_samples = region_means(samples, matrix)
    return {
        "samples": samples, "summary": summarise(samples),
        "region_samples": region_samples, "region_summary": summarise(region_samples),
    }


def add(total: dict[str, np.ndarray], week: int, sums: dict[str, np.ndarray]) -> None:
    for name, value in sums.items():
        total[name][week] += value


def empty_sums(shape: tuple[int, ...]) -> dict[str, np.ndarray]:
    return {name: np.zeros(shape, dtype=np.float64) for name in scores.SUMS}


def to_dataset(cell: dict, region: dict, ids: list[str]) -> xr.Dataset:
    data = {}
    for (variable, source), sums in cell.items():
        for name, value in sums.items():
            data[f"cell_{variable}_{source}_{name}"] = (("week", "latitude", "longitude"), value.astype(np.float32))
    for (variable, source), sums in region.items():
        for name, value in sums.items():
            data[f"region_{variable}_{source}_{name}"] = (("week", "region"), value)
    return xr.Dataset(data, coords={
        "week": np.arange(1, timing.WEEKS + 1), "latitude": grid.LATITUDE, "longitude": grid.LONGITUDE, "region": ids,
    })


def main() -> None:
    args = parse_args()
    paths = load_paths(args.paths)
    store, private_root = Path(paths["window_cache"]), Path(paths["private_root"])
    days = climate.init_days(read_array(store, "init"))
    slots = climate.slot_index(days)
    slot = list(slots)[args.task_index]
    positions = [p for p in slots[slot] if days[p].year in EVALUATION_YEARS]
    ids, fractions, digest = load_region_weights(private_root)
    matrix = weight_matrix(fractions)
    truths = {pair: Truth(paths, *pair) for pair in PAIRS}
    cells_path = private_root / "climate_v1/cells" / f"slot_{slot}.nc"
    regions_path = private_root / "climate_v1" / f"regions_{digest}" / f"slot_{slot}.nc"
    cell = {pair: empty_sums((timing.WEEKS, *grid.SHAPE)) for pair in PAIRS}
    region = {pair: empty_sums((timing.WEEKS, len(ids))) for pair in PAIRS}
    observed_cache: dict[tuple, dict] = {}

    with xr.open_dataset(cells_path) as cells, xr.open_dataset(regions_path) as region_climate:
        for variable in climate.VARIABLES:
            members = weekly_members(store, variable, positions)
            quantiles = cells[f"{variable}_q"].sel(year_set=MODEL_YEAR_SET).values
            model_mean = cells[f"{variable}_mean"].sel(year_set=MODEL_YEAR_SET).values
            early = region_climate[f"{variable}_region"].sel(year=list(CLIMATE_YEARS)).values
            region_model = summarise(early.reshape(-1, *early.shape[2:]))
            for case, position in enumerate(positions):
                region_members = members[case].reshape(*members[case].shape[:2], -1) @ matrix.T
                for week in range(timing.WEEKS):
                    start = timing.hindcast_week_start(days[position], week + 1)
                    model = {"mean": model_mean[week], "lower": quantiles[climate.LOWER_TERCILE, week], "upper": quantiles[climate.UPPER_TERCILE, week]}
                    model_region = {key: value[week] for key, value in region_model.items()}
                    for pair in PAIRS:
                        if pair[0] != variable:
                            continue
                        key = (pair, start.month, start.day)
                        if key not in observed_cache:
                            observed_cache[key] = observed_climate(truths[pair], start, matrix)
                        seen = observed_cache[key]
                        truth = truths[pair].week(start)
                        add(cell[pair], week, scores.case_sums(
                            members[case][:, week], truth, model, seen["summary"], seen["samples"],
                            scoreable(variable, model, seen["summary"])))
                        add(region[pair], week, scores.case_sums(
                            region_members[:, week], region_means(truth, matrix), model_region, seen["region_summary"],
                            seen["region_samples"], scoreable(variable, model_region, seen["region_summary"])))
            print(f"slot {slot}: {variable} scored for {len(positions)} starts", flush=True)

    dataset = to_dataset(cell, region, ids)
    dataset.attrs = {
        "slot": slot, "registry_hash": digest, "init_month": days[positions[0]].month,
        "evaluation_years": "2017-2021", "climate_years": "2002-2016",
    }
    write_dataset(dataset, private_root / "skill_v1" / f"slot_{slot}.nc")


if __name__ == "__main__":
    main()
