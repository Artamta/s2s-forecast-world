#!/usr/bin/env python3
"""Add the per-slot verification sums and publish hindcast skill.

Scores are finished for the whole year and for each season of the start date,
per grid cell (small binaries) and per region (one JSON each).
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from world import quantize, scores  # noqa: E402
from world.pipeline.build_hindcast_scores import PAIRS  # noqa: E402
from world.pipeline.common import load_paths, load_region_weights, rounded, write_json  # noqa: E402

SEASONS = {"all": range(1, 13), "djf": (12, 1, 2), "mam": (3, 4, 5), "jja": (6, 7, 8), "son": (9, 10, 11)}
CELL_METRICS = ("bss", "bss3", "acc", "crpss", "msss")
REGION_METRICS = (
    "bss", "bss_below", "bss_above", "acc", "msss", "crpss",
    "rmse", "rmse_clim", "rmse_raw", "bias", "crps", "crps_raw", "crps_clim", "cases",
)
SCORE_SPEC = {"dtype": "u8", "scale": 0.01, "offset": -1.0}
MINIMUM_CASES = 20


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public/data/world")
    return parser.parse_args()


def add_slots(files: list[Path], digest: str) -> dict[str, dict[str, np.ndarray]]:
    """Sum every slot's arrays into each season its start month belongs to."""

    totals: dict[str, dict[str, np.ndarray]] = {season: {} for season in SEASONS}
    for path in files:
        with xr.open_dataset(path) as dataset:
            if dataset.attrs["registry_hash"] != digest:
                raise ValueError(f"{path} was scored with another region registry")
            month = int(dataset.attrs["init_month"])
            arrays = {name: dataset[name].values.astype(np.float64) for name in dataset.data_vars}
        for season, months in SEASONS.items():
            if month in months:
                for name, value in arrays.items():
                    totals[season][name] = totals[season].get(name, 0.0) + value
    return totals


def pair_sums(total: dict[str, np.ndarray], kind: str, variable: str, source: str) -> dict[str, np.ndarray]:
    return {name: total[f"{kind}_{variable}_{source}_{name}"] for name in scores.SUMS}


def smooth_3x3(field: np.ndarray) -> np.ndarray:
    """Mean of each cell and its eight neighbours, ignoring gaps and wrapping east-west."""

    padded = np.pad(field, ((0, 0), (1, 1), (0, 0)), constant_values=np.nan)
    padded = np.concatenate([padded[..., -1:], padded, padded[..., :1]], axis=-1)
    stack = [padded[:, 1 + dy : 1 + dy + field.shape[1], 1 + dx : 1 + dx + field.shape[2]] for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    present = np.isfinite(stack)
    mean = np.where(present, stack, 0.0).sum(axis=0) / np.maximum(present.sum(axis=0), 1)
    return np.where(np.isfinite(field), mean, np.nan)


def cell_scores(totals: dict, variable: str, source: str) -> dict[str, np.ndarray]:
    """Each metric as (season, week, lat, lon), clipped to the stored range."""

    by_season = [scores.finish(pair_sums(totals[season], "cell", variable, source), MINIMUM_CASES) for season in SEASONS]
    stacked = {metric: np.stack([season[metric] for season in by_season]) for metric in ("bss", "acc", "crpss", "msss")}
    stacked["bss3"] = np.stack([smooth_3x3(season["bss"]) for season in by_season])
    return {metric: np.clip(values, -1.0, 1.0) for metric, values in stacked.items()}


def region_documents(totals: dict, ids: list[str]) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = [{"id": region, "pairs": {}} for region in ids]
    for variable, source in PAIRS:
        for season in SEASONS:
            finished = scores.finish(pair_sums(totals[season], "region", variable, source), MINIMUM_CASES)
            for index, document in enumerate(documents):
                pair = document["pairs"].setdefault(f"{variable}_{source}", {})
                pair[season] = {metric: rounded(finished[metric][:, index], 3) for metric in REGION_METRICS}
    return documents


def main() -> None:
    args = parse_args()
    private_root = Path(load_paths(args.paths)["private_root"])
    ids, _, digest = load_region_weights(private_root)
    files = sorted((private_root / "skill_v1").glob("slot_*.nc"))
    if len(files) != 104:
        raise ValueError(f"expected 104 scored slots, found {len(files)}")
    totals = add_slots(files, digest)

    folder = args.public_dir / "skill"
    shutil.rmtree(folder, ignore_errors=True)
    (folder / "regions").mkdir(parents=True)
    records = {}
    for variable, source in PAIRS:
        for metric, values in cell_scores(totals, variable, source).items():
            name = f"{metric}_{variable}_{source}"
            record = quantize.write_field(folder / f"{name}.bin", values, SCORE_SPEC)
            records[name] = {**record, "layers": list(SEASONS), "units": ""}
    documents = region_documents(totals, ids)
    for document in documents:
        write_json(folder / "regions" / f"{document['id']}.json", document)
    cases = {season: int(totals[season]["cell_t2m_era5_n"].max()) for season in SEASONS}
    write_json(folder / "skill.json", {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "registry_hash": digest,
        "evaluation_years": [2017, 2021],
        "climate_years": [2002, 2016],
        "hindcast_members": 51,
        "initialisation": "ERA5",
        "seasons": list(SEASONS),
        "cases_per_week": cases,
        "pairs": [f"{variable}_{source}" for variable, source in PAIRS],
        "metrics": list(CELL_METRICS),
        "reference": "climatology of the same truth dataset, 2002-2016, same time of year",
        "fields": records,
    })
    world = next(document for document in documents if document["id"] == "world")
    for pair, seasons in world["pairs"].items():
        print(f"world land {pair}: BSS {seasons['all']['bss']} ACC {seasons['all']['acc']} CRPSS {seasons['all']['crpss']}")
    size = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
    print(f"skill exported to {folder}: {size / 1e6:.1f} MB, cases per week {cases}")


if __name__ == "__main__":
    main()
