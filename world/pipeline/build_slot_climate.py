#!/usr/bin/env python3
"""Build the model climate of one hindcast calendar slot.

Writes cell statistics (mean, spread, quantiles of weekly rainfall and
temperature) and region-mean member samples. ``--regions-only`` recomputes the
region file alone, which is all a new region needs.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from science.zarr_v2 import read_array, read_axis0_slice  # noqa: E402
from world import climate, grid, timing, weights  # noqa: E402
from world.pipeline.common import load_paths, load_region_weights  # noqa: E402

CACHE_ARRAYS = {"rain": "tp_member_window", "t2m": "t2m_member_window"}
DAILY_ARRAYS = {"rain": "tp_daily_ensmean", "t2m": "t2m_daily_ensmean"}
KELVIN = 273.15


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-index", type=int, required=True, help="0-103, one calendar slot")
    parser.add_argument("--regions-only", action="store_true")
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    return parser.parse_args()


def read_inits(store: Path, name: str, positions: list[int]) -> np.ndarray:
    """Read whole hindcast starts by position along the init axis."""

    return np.concatenate([read_axis0_slice(store, name, p, p + 1) for p in positions])


def weekly_members(store: Path, variable: str, positions: list[int]) -> np.ndarray:
    """Weeks 1-6 for every year and member: (year, member, week, lat, lon)."""

    values = read_inits(store, CACHE_ARRAYS[variable], positions)[:, :, : timing.WEEKS]
    if not np.isfinite(values).all():
        raise ValueError(f"{CACHE_ARRAYS[variable]} has non-finite values")
    return values - KELVIN if variable == "t2m" else values


def daily_climate(store: Path, variable: str, positions: list[int]) -> np.ndarray:
    """Mean over years of the daily ensemble mean: (lead_day, lat, lon)."""

    values = read_inits(store, DAILY_ARRAYS[variable], positions).mean(axis=0)
    return values - KELVIN if variable == "t2m" else values


def weight_matrix(fractions: np.ndarray) -> np.ndarray:
    """Normalised area weights of every region as rows of (region, cell)."""

    rows = [weights.area_weights(region).ravel() for region in fractions]
    return np.asarray(rows, dtype=np.float32)


def cell_dataset(samples: dict[str, np.ndarray], years: list[int]) -> xr.Dataset:
    """Pooled statistics per cell and week, for each set of hindcast years."""

    stat_dims = ("year_set", "week", "latitude", "longitude")
    data = {}
    for variable, values in samples.items():
        stats = []
        for first, last in climate.YEAR_SETS.values():
            chosen = [i for i, year in enumerate(years) if first <= year <= last]
            pooled = values[chosen].reshape(-1, *values.shape[2:])
            stats.append(climate.pooled_statistics(pooled))
        data[f"{variable}_mean"] = (stat_dims, np.stack([s["mean"] for s in stats]))
        data[f"{variable}_std"] = (stat_dims, np.stack([s["std"] for s in stats]))
        data[f"{variable}_q"] = (
            ("year_set", "quantile", "week", "latitude", "longitude"),
            np.stack([s["q"] for s in stats]),
        )
    return xr.Dataset(data, coords={
        "year_set": list(climate.YEAR_SETS),
        "quantile": np.asarray(climate.QUANTILES),
        "week": np.arange(1, timing.WEEKS + 1),
        "latitude": grid.LATITUDE,
        "longitude": grid.LONGITUDE,
    })


def region_dataset(
    samples: dict[str, np.ndarray], daily: dict[str, np.ndarray], matrix: np.ndarray,
    ids: list[str], years: list[int],
) -> xr.Dataset:
    """Region-mean member samples per week, and the daily climate per region."""

    data = {}
    for variable, values in samples.items():
        flat = values.reshape(*values.shape[:3], -1)
        data[f"{variable}_region"] = (("year", "member", "week", "region"), flat @ matrix.T)
        flat_daily = daily[variable].reshape(daily[variable].shape[0], -1)
        data[f"{variable}_region_daily"] = (("lead_day", "region"), flat_daily @ matrix.T)
    return xr.Dataset(data, coords={
        "year": years,
        "week": np.arange(1, timing.WEEKS + 1),
        "lead_day": np.arange(1, timing.LEAD_DAYS + 1),
        "region": ids,
    })


def write_dataset(dataset: xr.Dataset, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".part")
    encoding = {name: {"zlib": True, "complevel": 3, "shuffle": True} for name in dataset.data_vars}
    dataset.to_netcdf(temporary, engine="netcdf4", encoding=encoding)
    temporary.replace(output)


def main() -> None:
    args = parse_args()
    paths = load_paths(args.paths)
    store, private_root = Path(paths["window_cache"]), Path(paths["private_root"])
    days = climate.init_days(read_array(store, "init"))
    slots = climate.slot_index(days)
    slot = list(slots)[args.task_index]
    positions = slots[slot]
    years = [days[p].year for p in positions]
    if len(slots) != 104 or years != list(range(2002, 2022)):
        raise ValueError(f"slot {slot} has years {years} among {len(slots)} slots")

    ids, fractions, digest = load_region_weights(private_root)
    samples = {v: weekly_members(store, v, positions) for v in climate.VARIABLES}
    daily = {v: daily_climate(store, v, positions) for v in climate.VARIABLES}
    attrs = {"slot": slot, "source_store": str(store), "rain_units": "mm/week", "t2m_units": "degC"}

    regions = region_dataset(samples, daily, weight_matrix(fractions), ids, years)
    regions.attrs = {**attrs, "registry_hash": digest}
    write_dataset(regions, private_root / "climate_v1" / f"regions_{digest}" / f"slot_{slot}.nc")
    if not args.regions_only:
        cells = cell_dataset(samples, years)
        cells.attrs = attrs
        write_dataset(cells, private_root / "climate_v1" / "cells" / f"slot_{slot}.nc")
    print(f"slot {slot}: {len(positions)} starts, {len(ids)} regions, registry {digest}")


if __name__ == "__main__":
    main()
