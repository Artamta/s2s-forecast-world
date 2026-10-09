#!/usr/bin/env python3
"""Cross-check the world pipeline against products that already exist.

reduction  compact store of the 2026-07-28 run vs the published global bins
climate    slot climate cropped to India vs the India dashboard's climatology
india      a world issue cropped to India vs the India forecast of that issue
alignment  hindcast week 1 vs ERA5 one day early, on time and one day late
skill      land-mean cell scores by week, to compare with the bias-correction project
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from science.formulas import weekly_mean, weekly_total  # noqa: E402
from science.zarr_v2 import read_array, read_axis0_slice  # noqa: E402
from world import climate, grid, quantize, timing, weights  # noqa: E402
from world.pipeline.build_hindcast_scores import Truth  # noqa: E402
from world.pipeline.common import load_paths, load_region_weights  # noqa: E402

FUXI = Path("/storage/raj.ayush/s2s_final_data/final_iteration/model-runs/fuxi")
GLOBAL_BINS = FUXI / "atmosphere42_global_20260728/public-v2"
INDIA_CLIMATE = FUXI / "native_reforecast_full_year_2002_2021/fuxi_s2s_full_year_model_climatology_2002_2021_loyo.nc"
INDIA_ROWS, INDIA_COLS = slice(34, 61), slice(40, 67)
KELVIN = 273.15


def report(name: str, value: float, limit: float, *, higher_is_better: bool = False) -> bool:
    passed = value >= limit if higher_is_better else value <= limit
    print(f"  [{'PASS' if passed else 'FAIL'}] {name}: {value:.5g} (limit {limit:g})")
    return passed


def read_bin(name: str) -> np.ndarray:
    """Decode one published daily ensemble-mean field (lead, lat, lon)."""

    record = json.loads((GLOBAL_BINS / "metadata.json").read_text())["variables"][name]
    stored = np.frombuffer((GLOBAL_BINS / record["path"]).read_bytes(), dtype="<u2")
    return stored.reshape(timing.LEAD_DAYS, *grid.SHAPE) * record["scale"] + record["offset"]


def check_reduction(private_root: Path) -> bool:
    print("reduction: compact 20260728 ensemble mean vs published global bins")
    with xr.open_dataset(private_root / "compact/gfs/20260728.nc") as dataset:
        rain = dataset["tp_daily"].values.mean(axis=0, dtype=np.float64)
        temperature = dataset["t2m_daily"].values.mean(axis=0, dtype=np.float64) - KELVIN
    return all([
        report("rainfall max |difference| mm/day", np.abs(rain - read_bin("precipitation")).max(), 0.006),
        report("temperature max |difference| degC", np.abs(temperature - read_bin("temperature")).max(), 0.006),
    ])


def check_climate(private_root: Path, slots: list[str]) -> bool:
    print("climate: world slot means cropped to India vs the India climatology")
    passed = True
    with xr.open_dataset(INDIA_CLIMATE) as india:
        available = [str(value) for value in india["init_slot"].values]
        for slot in slots or available[::13]:
            daily_rain = india["tp_model_climatology_mean"].sel(init_slot=slot).values
            daily_t2m = india["t2m_model_climatology_mean"].sel(init_slot=slot).values - KELVIN
            with xr.open_dataset(private_root / "climate_v1/cells" / f"slot_{slot}.nc") as world:
                rain = world["rain_mean"].sel(year_set="y2002_2021").values[:, INDIA_ROWS, INDIA_COLS]
                t2m = world["t2m_mean"].sel(year_set="y2002_2021").values[:, INDIA_ROWS, INDIA_COLS]
            passed &= report(f"slot {slot} rainfall max |difference| mm/week", np.abs(rain - weekly_total(daily_rain)).max(), 0.02)
            passed &= report(f"slot {slot} temperature max |difference| degC", np.abs(t2m - weekly_mean(daily_t2m)).max(), 0.002)
    return passed


def pattern_correlation(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.corrcoef(a.ravel(), b.ravel())[0, 1])


def check_india(private_root: Path, operational_root: Path, source: str, issue: str) -> bool:
    """Two independent 100-member draws of one forecast should agree within sampling noise."""

    print(f"india: world {source}/{issue} cropped to India vs the India forecast file")
    india_path = operational_root / source / issue / "ens100/forecasts" / f"annual{issue[:4]}" / f"{issue}.nc"
    with xr.open_dataset(india_path) as india:
        india_rain = weekly_total(np.maximum(india["tp"].values, 0.0) * 24.0, day_axis=1)
        india_t2m = weekly_mean(india["t2m"].values - KELVIN, day_axis=1)
        grid_ok = np.allclose(india.latitude.values, grid.LATITUDE[INDIA_ROWS]) and np.allclose(india.longitude.values, grid.LONGITUDE[INDIA_COLS])
    with xr.open_dataset(private_root / "compact" / source / f"{issue}.nc") as world:
        crop = dict(latitude=INDIA_ROWS, longitude=INDIA_COLS)
        world_rain = weekly_total(world["tp_daily"].isel(**crop).values, day_axis=1)
        world_t2m = weekly_mean(world["t2m_daily"].isel(**crop).values - KELVIN, day_axis=1)
    passed = report("India crop coordinates match", float(not grid_ok), 0.0)
    for name, ours, theirs in (("rainfall", world_rain, india_rain), ("temperature", world_t2m, india_t2m)):
        difference = np.abs(ours.mean(axis=0) - theirs.mean(axis=0))
        noise = np.sqrt(ours.var(axis=0) / ours.shape[0] + theirs.var(axis=0) / theirs.shape[0])
        within = float((difference <= 4.0 * noise + 1e-6).mean())
        passed &= report(f"{name} week-1 pattern correlation", pattern_correlation(ours.mean(axis=0)[0], theirs.mean(axis=0)[0]), 0.97, higher_is_better=True)
        passed &= report(f"{name} share of cell-weeks within 4 standard errors", within, 0.99, higher_is_better=True)
    return passed


def check_alignment(paths: dict[str, str]) -> bool:
    """Lead day 1 of the hindcast must match observed daily rainfall best on init + 1.

    Daily fields are used because weekly windows one day apart share six days.
    """

    print("alignment: hindcast lead-day-1 rainfall vs IMERG daily rainfall on init + shift")
    store = Path(paths["window_cache"])
    days = climate.init_days(read_array(store, "init"))
    slots = climate.slot_index(days)
    truth = Truth(paths, "rain", "imerg")
    band = np.abs(grid.LATITUDE) <= 50.0
    passed = True
    for slot in list(slots)[5::26]:
        position = next(p for p in slots[slot] if days[p].year == 2019)
        forecast = read_axis0_slice(store, "tp_daily_ensmean", position, position + 1)[0, 0]
        scores = {}
        for shift in (0, 1, 2):
            observed = truth._days((days[position] - truth.epoch).days + shift, 1)[0]
            scores[shift] = pattern_correlation(forecast[band], np.nan_to_num(observed[band]))
        print(f"  start {days[position]}: " + ", ".join(f"init+{k} r={v:.3f}" for k, v in scores.items()))
        passed &= report(f"  best other day minus init+1 ({slot})", max(scores[0], scores[2]) - scores[1], 0.0)
    return passed


def check_skill(private_root: Path, public_dir: Path) -> bool:
    """Land-mean cell scores of the published skill fields (all starts)."""

    print("skill: land-area mean of cell scores by lead week (all 2017-2021 starts)")
    ids, fractions, _ = load_region_weights(private_root)
    land = weights.area_weights(fractions[ids.index("world")])
    manifest = json.loads((public_dir / "skill/skill.json").read_text())
    for name in ("acc_rain_era5", "bss_rain_era5", "acc_t2m_era5", "bss_t2m_era5", "acc_rain_imerg", "bss_rain_imerg"):
        record = manifest["fields"][name]
        stored = np.frombuffer((public_dir / "skill" / record["path"]).read_bytes(), dtype="u1").reshape(record["shape"])
        values = quantize.decode(stored, dtype="u8", scale=record["scale"], offset=record["offset"])[0]
        present = np.isfinite(values)
        means = (np.where(present, values, 0.0) * land).sum(axis=(1, 2)) / (present * land).sum(axis=(1, 2))
        print(f"  {name}: " + " ".join(f"{value:+.3f}" for value in means))
    print("  reference (bias-correction project, raw rainfall ACC, test years 2019-2021): 0.709 week 1, 0.286 week 3, 0.194 week 6")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("check", choices=("reduction", "climate", "india", "alignment", "skill"))
    parser.add_argument("--source", default="ifs")
    parser.add_argument("--issue", default="20261007")
    parser.add_argument("--slots", nargs="+", help="calendar slots to compare; default is every 13th")
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    args = parser.parse_args()
    paths = load_paths(args.paths)
    private_root = Path(paths["private_root"])
    if args.check == "reduction":
        passed = check_reduction(private_root)
    elif args.check == "climate":
        passed = check_climate(private_root, args.slots)
    elif args.check == "alignment":
        passed = check_alignment(paths)
    elif args.check == "skill":
        passed = check_skill(private_root, ROOT / "public/data/world")
    else:
        passed = check_india(private_root, Path(paths["operational_root"]), args.source, args.issue)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
