#!/usr/bin/env python3
"""Reduce one global run's raw member files to a compact per-issue store.

Members cannot be regenerated, so daily rainfall and temperature are kept for
every member on the full grid. Circulation fields are kept per member in the
tropics and as ensemble mean and spread everywhere.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import date
from multiprocessing import Pool
from pathlib import Path

import netCDF4
import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from world import grid, timing  # noqa: E402
from world.pipeline.common import load_paths  # noqa: E402

MEMBER_GLOBAL = ("tp", "t2m")
MEMBER_TROPICS = ("sst", "ttr", "u850", "v850", "u250", "u200")
ENSEMBLE = ("u850", "v850", "ttr", "sst", "z500", "msl", "tcwv", "u250", "v250")
ENSEMBLE_NAMES = (*ENSEMBLE, "wspd850")
TROPICS = slice(40, 81)
RAW_VARIABLE = "__xarray_dataarray_variable__"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--issue", required=True, help="issue date YYYYMMDD")
    parser.add_argument("--source", required=True, choices=("ifs", "gfs", "era5"))
    parser.add_argument("--members", type=int, default=100)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--delete-raw", action="store_true")
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    return parser.parse_args()


def raw_path(raw_dir: Path, member: int, lead_day: int) -> Path:
    return raw_dir / "member" / f"{member:02d}" / f"{lead_day:02d}.nc"


def read_raw(path: Path, state_day: date) -> dict[str, np.ndarray]:
    """Read every needed channel of one member-day as float32 (121, 240)."""

    needed = set(MEMBER_GLOBAL) | set(MEMBER_TROPICS) | set(ENSEMBLE)
    with netCDF4.Dataset(path) as source:
        units = source.variables["time"].units
        if not units.startswith(f"days since {state_day.isoformat()}"):
            raise ValueError(f"{path} starts from '{units}', expected {state_day}")
        grid.validate_coordinates(source.variables["lat"][:], source.variables["lon"][:], str(path))
        channels = [str(name) for name in source.variables["channel"][:]]
        values = np.asarray(source.variables[RAW_VARIABLE][0, 0], dtype=np.float32)
    fields = {name: values[channels.index(name)] for name in needed}
    for name, field in fields.items():
        if not np.isfinite(field).all():
            raise ValueError(f"{path} has non-finite {name}")
    return fields


def reduce_member(task: tuple[Path, int, date]) -> dict[str, np.ndarray]:
    """Stack the 42 lead days of one member."""

    raw_dir, member, state_day = task
    days = [read_raw(raw_path(raw_dir, member, lead), state_day) for lead in range(1, timing.LEAD_DAYS + 1)]
    stack = lambda name: np.stack([day[name] for day in days])  # noqa: E731
    ensemble = np.stack([stack(name) for name in ENSEMBLE])
    speed = np.hypot(ensemble[0], ensemble[1])[None]
    return {
        "tp": np.maximum(stack("tp"), 0.0) * 24.0,
        "t2m": stack("t2m"),
        "tropics": np.stack([stack(name)[:, TROPICS] for name in MEMBER_TROPICS]),
        "ensemble": np.concatenate([ensemble, speed]),
    }


def reduce_run(raw_dir: Path, members: int, state_day: date, workers: int) -> dict[str, np.ndarray]:
    """Collect member arrays and running ensemble moments."""

    leads, (rows, cols) = timing.LEAD_DAYS, grid.SHAPE
    tp = np.empty((members, leads, rows, cols), dtype=np.float32)
    t2m = np.empty_like(tp)
    tropics = np.empty((len(MEMBER_TROPICS), members, leads, 41, cols), dtype=np.float32)
    total = np.zeros((len(ENSEMBLE_NAMES), leads, rows, cols), dtype=np.float64)
    squares = np.zeros_like(total)
    tasks = [(raw_dir, member, state_day) for member in range(members)]
    with Pool(workers) as pool:
        for member, result in enumerate(pool.imap(reduce_member, tasks)):
            tp[member], t2m[member] = result["tp"], result["t2m"]
            tropics[:, member] = result["tropics"]
            total += result["ensemble"]
            squares += result["ensemble"].astype(np.float64) ** 2
            print(f"member {member:02d} reduced", flush=True)
    mean = total / members
    spread = np.sqrt(np.maximum(squares / members - mean**2, 0.0))
    return {"tp": tp, "t2m": t2m, "tropics": tropics, "mean": mean, "spread": spread}


def to_dataset(arrays: dict[str, np.ndarray], issue: date, source: str, raw_dir: Path) -> xr.Dataset:
    members = arrays["tp"].shape[0]
    member_dims = ("member", "lead_day", "latitude", "longitude")
    tropic_dims = ("tropical_variable", "member", "lead_day", "tropical_latitude", "longitude")
    ensemble_dims = ("ensemble_variable", "lead_day", "latitude", "longitude")
    return xr.Dataset(
        data_vars={
            "tp_daily": (member_dims, arrays["tp"], {"units": "mm/day", "note": "clip(tp, 0) * 24"}),
            "t2m_daily": (member_dims, arrays["t2m"], {"units": "K"}),
            "tropics_daily": (tropic_dims, arrays["tropics"], {"note": "native units, 30S-30N"}),
            "ens_mean": (ensemble_dims, arrays["mean"].astype(np.float32)),
            "ens_std": (ensemble_dims, arrays["spread"].astype(np.float32), {"note": "ddof=0"}),
        },
        coords={
            "member": np.arange(members, dtype=np.int16),
            "lead_day": np.arange(1, timing.LEAD_DAYS + 1, dtype=np.int16),
            "latitude": grid.LATITUDE.astype(np.float32),
            "longitude": grid.LONGITUDE.astype(np.float32),
            "tropical_latitude": grid.LATITUDE[TROPICS].astype(np.float32),
            "tropical_variable": list(MEMBER_TROPICS),
            "ensemble_variable": list(ENSEMBLE_NAMES),
        },
        attrs={
            "model": "FuXi-S2S",
            "issue_date": issue.isoformat(),
            "model_state_day": timing.model_state_day(issue).isoformat(),
            "source": source,
            "members": members,
            "raw_dir": str(raw_dir),
            "raw_file_count": members * timing.LEAD_DAYS,
        },
    )


def write_compact(dataset: xr.Dataset, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".part")
    encoding = {name: {"zlib": True, "complevel": 4, "shuffle": True} for name in dataset.data_vars}
    dataset.to_netcdf(temporary, engine="netcdf4", encoding=encoding)
    temporary.replace(output)


def validate_compact(output: Path, members: int) -> None:
    """Re-open the written file and check it is complete and physical."""

    with xr.open_dataset(output) as dataset:
        expected = (members, timing.LEAD_DAYS, *grid.SHAPE)
        tp, t2m = dataset["tp_daily"].values, dataset["t2m_daily"].values
        if tp.shape != expected or t2m.shape != expected:
            raise ValueError(f"{output} member fields have shape {tp.shape}")
        for name in dataset.data_vars:
            if not np.isfinite(dataset[name].values).all():
                raise ValueError(f"{output} has non-finite {name}")
        if tp.min() < 0.0 or tp.max() > 2000.0:
            raise ValueError(f"{output} rainfall range {tp.min()} to {tp.max()} mm/day")
        # The model drifts to about 140 K over inland Antarctica after week 2.
        if t2m.min() < 120.0 or t2m.max() > 350.0:
            raise ValueError(f"{output} temperature range {t2m.min()} to {t2m.max()} K")


def delete_raw(raw_dir: Path, world_raw: Path, operational_root: Path) -> None:
    """Remove raw members: the world raw folder, or an operational run's work folder."""

    resolved = raw_dir.resolve()
    in_world = world_raw.resolve() in resolved.parents
    in_work = operational_root.resolve() in resolved.parents and "work" in resolved.parts
    if not (in_world or in_work):
        raise ValueError(f"refusing to delete {resolved}: not a raw member folder")
    shutil.rmtree(resolved)


def main() -> None:
    args = parse_args()
    paths = load_paths(args.paths)
    issue = timing.parse_issue(args.issue)
    private_root = Path(paths["private_root"])
    output = args.output or private_root / "compact" / args.source / f"{issue:%Y%m%d}.nc"
    arrays = reduce_run(args.raw_dir, args.members, timing.model_state_day(issue), args.workers)
    write_compact(to_dataset(arrays, issue, args.source, args.raw_dir), output)
    validate_compact(output, args.members)
    print(f"compact store written: {output} ({output.stat().st_size / 1e9:.2f} GB)")
    if args.delete_raw:
        delete_raw(args.raw_dir, private_root / "raw", Path(paths["operational_root"]))
        print(f"raw members deleted: {args.raw_dir}")


if __name__ == "__main__":
    main()
