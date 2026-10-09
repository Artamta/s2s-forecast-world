#!/usr/bin/env python3
"""Daily model climate of circulation fields for one hindcast calendar slot.

Reads only the channel chunks it needs from the full hindcast store and
averages over all years and members. Used for wind, OLR and SST anomalies and
for the tropical indices.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import xarray as xr
import zarr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from science.zarr_v2 import read_array  # noqa: E402
from world import climate, grid, timing  # noqa: E402
from world.pipeline.build_slot_climate import write_dataset  # noqa: E402
from world.pipeline.common import load_paths  # noqa: E402

VARIABLES = ("sst", "ttr", "u850", "v850", "u250")
CHANNEL_CHUNK = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-index", type=int, required=True, help="0-103, one calendar slot")
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    return parser.parse_args()


def chunk_groups(channels: list[str]) -> dict[int, list[str]]:
    """Wanted variables grouped by the stored channel chunk that holds them."""

    groups: dict[int, list[str]] = {}
    for name in VARIABLES:
        groups.setdefault(channels.index(name) // CHANNEL_CHUNK, []).append(name)
    return groups


def member_mean(forecast: zarr.Array, position: int, channels: list[str], groups: dict[int, list[str]]) -> np.ndarray:
    """Ensemble mean of one start: (variable, lead_day, lat, lon)."""

    means = {}
    for group, names in groups.items():
        first = group * CHANNEL_CHUNK
        block = forecast[position, :, :, first : first + CHANNEL_CHUNK]
        if not np.isfinite(block).all():
            raise ValueError(f"start {position} has non-finite circulation fields")
        for name in names:
            means[name] = block[:, :, channels.index(name) - first].mean(axis=0, dtype=np.float64)
    return np.stack([means[name] for name in VARIABLES])


def main() -> None:
    args = parse_args()
    paths = load_paths(args.paths)
    store = Path(paths["native_reforecast"])
    days = climate.init_days(read_array(store, "init"))
    slots = climate.slot_index(days)
    slot = list(slots)[args.task_index]
    positions = slots[slot]
    if len(slots) != 104 or len(positions) != 20:
        raise ValueError(f"slot {slot} has {len(positions)} starts among {len(slots)} slots")
    channels = [str(name) for name in read_array(store, "channel")]
    groups = chunk_groups(channels)
    forecast = zarr.open_array(str(store / "forecast"), mode="r")

    total = np.zeros((len(VARIABLES), timing.LEAD_DAYS, *grid.SHAPE), dtype=np.float64)
    for position in positions:
        total += member_mean(forecast, position, channels, groups)
        print(f"slot {slot}: {days[position]} read", flush=True)
    dataset = xr.Dataset(
        {"mean": (("variable", "lead_day", "latitude", "longitude"), (total / len(positions)).astype(np.float32))},
        coords={
            "variable": list(VARIABLES),
            "lead_day": np.arange(1, timing.LEAD_DAYS + 1),
            "latitude": grid.LATITUDE,
            "longitude": grid.LONGITUDE,
        },
        attrs={"slot": slot, "source_store": str(store), "units": "native: K, W m-2 (ttr, downward positive), m s-1"},
    )
    write_dataset(dataset, Path(paths["private_root"]) / "climate_v1" / "circulation" / f"slot_{slot}.nc")


if __name__ == "__main__":
    main()
