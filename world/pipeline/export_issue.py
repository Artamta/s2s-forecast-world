#!/usr/bin/env python3
"""Export one issue's public world package from its compact store.

Global weekly fields are written as small binaries the browser crops to any
region; each region gets a small JSON with its ensemble summary. Anomalies and
tercile probabilities are added when the model climate is available.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from science.formulas import ensemble_quantile_summary, weekly_mean, weekly_total  # noqa: E402
from world import climate, grid, indices, probability, quantize, timing  # noqa: E402
from world.pipeline.build_catalog import write_catalog  # noqa: E402
from world.pipeline.build_slot_climate import weight_matrix  # noqa: E402
from world.pipeline.common import load_paths, load_region_weights, rounded, write_json  # noqa: E402

KELVIN = 273.15
FIELD_QUANTILES = (0.10, 0.50, 0.90)
DIGITS = {"rain": 1, "t2m": 2}
YEAR_SET = "y2002_2021"
CIRCULATION = ("sst", "ttr", "u850", "v850", "u250")
TROPICS = slice(40, 81)
OCEAN_LAND_LIMIT = 0.5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--issue", required=True, help="issue date YYYYMMDD")
    parser.add_argument("--source", required=True, choices=("ifs", "gfs", "era5"))
    parser.add_argument("--no-climate", action="store_true")
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    parser.add_argument("--products", type=Path, default=ROOT / "world/config/products.json")
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public/data/world")
    return parser.parse_args()


def load_members(compact: Path) -> dict[str, np.ndarray]:
    """Weekly and daily member fields in display units, plus weekly mean wind."""

    with xr.open_dataset(compact) as dataset:
        rain_daily = dataset["tp_daily"].values
        t2m_daily = dataset["t2m_daily"].values - KELVIN
        wind = dataset["ens_mean"].sel(ensemble_variable=["u850", "v850"]).values
        ens_mean = {name: dataset["ens_mean"].sel(ensemble_variable=name).values for name in CIRCULATION}
        tropics = {name: dataset["tropics_daily"].sel(tropical_variable=name).values for name in ("sst", "u850")}
        attrs = dict(dataset.attrs)
    return {
        "rain_daily": rain_daily,
        "t2m_daily": t2m_daily,
        "rain": weekly_total(rain_daily, day_axis=1).astype(np.float32),
        "t2m": weekly_mean(t2m_daily, day_axis=1).astype(np.float32),
        "wind": weekly_mean(wind, day_axis=1).astype(np.float32),
        "ens_mean": ens_mean,
        "tropics": tropics,
        "attrs": attrs,
    }


def open_slot(private_root: Path, kind: str, slot: str) -> xr.Dataset:
    return xr.open_dataset(private_root / "climate_v1" / kind / f"slot_{slot}.nc")


def load_climate(private_root: Path, issue: date, digest: str) -> dict[str, Any] | None:
    """Model climate interpolated to the issue's model-state day, or None."""

    cells_dir = private_root / "climate_v1" / "cells"
    slots = sorted(path.stem[5:] for path in cells_dir.glob("slot_*.nc"))
    if len(slots) != 104:
        return None
    left, right, weight = climate.bracket(slots, timing.slot_target(issue))
    result: dict[str, Any] = {"left_slot": left, "right_slot": right, "right_weight": weight}
    with open_slot(private_root, "cells", left) as a, open_slot(private_root, "cells", right) as b:
        for variable in climate.VARIABLES:
            for stat in ("mean", "q"):
                name = f"{variable}_{stat}"
                result[name] = climate.interpolate(
                    a[name].sel(year_set=YEAR_SET).values, b[name].sel(year_set=YEAR_SET).values, weight
                )
    kind = f"regions_{digest}"
    with open_slot(private_root, kind, left) as a, open_slot(private_root, kind, right) as b:
        for variable in climate.VARIABLES:
            pooled = [
                d[f"{variable}_region"].values.reshape(-1, timing.WEEKS, d.sizes["region"]) for d in (a, b)
            ]
            stats = [climate.pooled_statistics(samples) for samples in pooled]
            for stat in ("mean", "q"):
                result[f"{variable}_region_{stat}"] = climate.interpolate(
                    stats[0][stat], stats[1][stat], weight
                )
            result[f"{variable}_region_daily"] = climate.interpolate(
                a[f"{variable}_region_daily"].values, b[f"{variable}_region_daily"].values, weight
            )
    return result


def load_circulation(private_root: Path, issue: date) -> dict[str, np.ndarray] | None:
    """Daily circulation climate (lead_day, lat, lon) per variable at the issue's date, or None."""

    folder = private_root / "climate_v1" / "circulation"
    slots = sorted(path.stem[5:] for path in folder.glob("slot_*.nc"))
    if len(slots) != 104:
        return None
    left, right, weight = climate.bracket(slots, timing.slot_target(issue))
    with xr.open_dataset(folder / f"slot_{left}.nc") as a, xr.open_dataset(folder / f"slot_{right}.nc") as b:
        mean = climate.interpolate(a["mean"].values, b["mean"].values, weight)
        names = [str(name) for name in a["variable"].values]
    return {name: mean[index] for index, name in enumerate(names)}


def circulation_fields(members: dict[str, Any], circulation: dict[str, np.ndarray], land: np.ndarray) -> dict[str, Any]:
    """Weekly ensemble-mean anomalies of 850 hPa wind, OLR and sea-surface temperature."""

    weekly = {name: weekly_mean(members["ens_mean"][name] - circulation[name], day_axis=0) for name in CIRCULATION}
    return {
        "wind850_anom": {"values": np.stack([weekly["u850"], weekly["v850"]])},
        "olr_anom": {"values": -weekly["ttr"][None]},
        "sst_anom": {"values": np.where(land > OCEAN_LAND_LIMIT, np.nan, weekly["sst"])[None]},
    }


def drivers_document(members: dict[str, Any], circulation: dict[str, np.ndarray], land: np.ndarray, issue: date) -> dict[str, Any]:
    """Member plumes of the tropical indices and the equatorial OLR time-longitude section."""

    documents = []
    for definition in indices.INDICES:
        signed = indices.index_weights(definition, land)
        name = definition["variable"]
        normal = indices.apply_weights(circulation[name][:, TROPICS], signed, TROPICS)
        series = indices.apply_weights(members["tropics"][name], signed, TROPICS) - normal
        summary = ensemble_quantile_summary(series)
        documents.append({
            **{key: definition[key] for key in ("id", "label", "units", "description")},
            "plume": {key: rounded(summary[key], 2) for key in ("mean", "p10", "p50", "p90")},
            "weekly": rounded(weekly_mean(summary["mean"]), 2),
        })
    olr_anomaly = -(members["ens_mean"]["ttr"] - circulation["ttr"])
    return {
        "first_day": issue.isoformat(),
        "indices": documents,
        "hovmoller": {
            "label": "Outgoing longwave radiation anomaly",
            "units": "W/m²",
            "band": list(indices.HOVMOLLER_BAND),
            "longitude": grid.LONGITUDE.tolist(),
            "values": rounded(indices.band_mean(olr_anomaly, *indices.HOVMOLLER_BAND), 1),
        },
    }


def cell_fields(members: dict[str, np.ndarray], clim: dict[str, Any] | None, dry_mm: float) -> dict[str, Any]:
    """Every public field as (layer, week, lat, lon), with optional flags."""

    fields: dict[str, Any] = {"wind850": {"values": members["wind"]}}
    for variable in climate.VARIABLES:
        weekly = members[variable]
        mean = weekly.mean(axis=0)
        fields[f"{variable}_mean"] = {"values": mean[None]}
        fields[f"{variable}_q"] = {"values": np.quantile(weekly, FIELD_QUANTILES, axis=0)}
        if clim is None:
            continue
        lower = clim[f"{variable}_q"][climate.LOWER_TERCILE]
        upper = clim[f"{variable}_q"][climate.UPPER_TERCILE]
        chance = probability.tercile_probabilities(weekly, lower, upper)
        fields[f"{variable}_anom"] = {"values": (mean - clim[f"{variable}_mean"])[None]}
        fields[f"{variable}_terc"] = {"values": np.stack([lower, upper])}
        fields[f"{variable}_prob"] = {"values": np.stack([chance["below"], chance["above"]])}
        if variable == "rain":
            dry = probability.dry_weeks(upper, dry_mm)
            fields["rain_prob"]["values"][:, dry] = np.nan
            fields["rain_prob"]["dry"] = np.broadcast_to(dry, (2, *dry.shape))
    return fields


def mean_departure(anomaly: np.ndarray) -> list[float]:
    """Area-mean anomaly over 60S-60N per week; a steady slide away from zero is model drift."""

    rows = np.abs(grid.LATITUDE) <= 60.0
    weights = grid.row_area()[rows]
    zonal = anomaly[:, rows].mean(axis=-1)
    return rounded(zonal @ (weights / weights.sum()), 2)


def write_fields(fields: dict[str, Any], specs: dict[str, Any], folder: Path) -> dict[str, Any]:
    records = {}
    for name, field in fields.items():
        spec = specs[name]
        flags = {spec["dry"]: field["dry"]} if "dry" in field else None
        record = quantize.write_field(folder / f"{name}.bin", field["values"], spec, flags)
        records[name] = {**record, "layers": spec["layers"], "units": spec["units"]}
        if "dry" in spec:
            records[name]["dry"] = spec["dry"]
    return records


def tercile_record(members: np.ndarray, lower: float, upper: float, dry: bool) -> dict[str, Any] | None:
    """Whole-percent tercile chances for one region and week, or None."""

    if dry or not lower < upper:
        return None
    chance = probability.tercile_probabilities(members, np.asarray(lower), np.asarray(upper))
    whole = probability.whole_percentages(*(float(chance[key]) for key in probability.CATEGORIES))
    return {**whole, "dominant": probability.dominant(whole)}


def region_week(
    variable: str, members: np.ndarray, summary: dict[str, np.ndarray], week: int, region: int,
    clim: dict[str, Any] | None, dry_mm: float,
) -> dict[str, Any]:
    digits = DIGITS[variable]
    record = {key: rounded(summary[key][week, region], digits) for key in ("mean", "p10", "p25", "p50", "p75", "p90")}
    if clim is None:
        return record
    quantiles = clim[f"{variable}_region_q"][:, week, region]
    lower, upper = float(quantiles[climate.LOWER_TERCILE]), float(quantiles[climate.UPPER_TERCILE])
    normal = float(clim[f"{variable}_region_mean"][week, region])
    dry = variable == "rain" and upper < dry_mm
    record.update(
        clim_mean=rounded(normal, digits),
        anom=rounded(summary["mean"][week, region] - normal, digits),
        clim_q33=rounded(lower, digits),
        clim_q67=rounded(upper, digits),
        dry=bool(dry),
        tercile=tercile_record(members[:, week, region], lower, upper, dry),
    )
    return record


def region_documents(
    members: dict[str, np.ndarray], matrix: np.ndarray, described: list[dict[str, Any]],
    clim: dict[str, Any] | None, issue: date, dry_mm: float,
) -> list[dict[str, Any]]:
    """One document per region: weekly summaries and a daily plume."""

    flat = lambda values: values.reshape(*values.shape[:2], -1) @ matrix.T  # noqa: E731
    weekly = {v: flat(members[v]) for v in climate.VARIABLES}
    daily = {v: flat(members[f"{v}_daily"]) for v in climate.VARIABLES}
    weekly_summary = {v: ensemble_quantile_summary(weekly[v]) for v in climate.VARIABLES}
    daily_summary = {v: ensemble_quantile_summary(daily[v]) for v in climate.VARIABLES}
    documents = []
    for index, region in enumerate(described):
        weeks = []
        for week in range(timing.WEEKS):
            start, end = timing.week_window(issue, week + 1)
            entry: dict[str, Any] = {"week": week + 1, "valid_start": start.isoformat(), "valid_end": end.isoformat()}
            for variable in climate.VARIABLES:
                entry[variable] = region_week(
                    variable, weekly[variable], weekly_summary[variable], week, index, clim, dry_mm
                )
            weeks.append(entry)
        plume = {}
        for variable in climate.VARIABLES:
            plume[variable] = {
                key: rounded(daily_summary[variable][key][:, index], DIGITS[variable])
                for key in ("mean", "p10", "p50", "p90")
            }
            if clim is not None:
                plume[variable]["clim"] = rounded(clim[f"{variable}_region_daily"][:, index], DIGITS[variable])
        documents.append({
            "id": region["id"],
            "label": region["label"],
            "tier": region["tier"],
            "effective_cells": region["effective_cells"],
            "weeks": weeks,
            "daily": plume,
        })
    return documents


def summary_document(documents: list[dict[str, Any]]) -> dict[str, Any]:
    """Per region and week: the outlook category and the headline numbers."""

    def cell(week: dict[str, Any], variable: str) -> dict[str, Any]:
        record = week[variable]
        tercile = record.get("tercile")
        return {
            "mean": record["mean"],
            "anom": record.get("anom"),
            "dominant": tercile["dominant"] if tercile else None,
            "chance": tercile[tercile["dominant"]] if tercile and tercile["dominant"] != "none" else None,
            "dry": record.get("dry", False),
        }

    return {
        "regions": {
            document["id"]: {v: [cell(week, v) for week in document["weeks"]] for v in climate.VARIABLES}
            for document in documents
        }
    }


def issue_manifest(
    issue: date, source: str, attrs: dict[str, Any], records: dict[str, Any],
    clim: dict[str, Any] | None, digest: str, departure: dict[str, list[float]], has_drivers: bool,
) -> dict[str, Any]:
    weeks = []
    for week in range(1, timing.WEEKS + 1):
        start, end = timing.week_window(issue, week)
        weeks.append({"week": week, "valid_start": start.isoformat(), "valid_end": end.isoformat()})
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "issue": issue.strftime("%Y%m%d"),
        "issue_date": issue.isoformat(),
        "model_state_day": timing.model_state_day(issue).isoformat(),
        "members": int(attrs["members"]),
        "status": "experimental",
        "weeks": weeks,
        "first_day": issue.isoformat(),
        "lead_days": timing.LEAD_DAYS,
        "grid": {"shape": list(grid.SHAPE), "spacing": grid.SPACING, "lat_first": 90.0, "lon_first": 0.0,
                 "order": "layer, week, latitude north to south, longitude eastward"},
        "climate": None if clim is None else {
            "years": [2002, 2021],
            "members_per_year": 51,
            "left_slot": clim["left_slot"],
            "right_slot": clim["right_slot"],
            "right_weight": round(clim["right_weight"], 4),
            "probability_type": "raw member fractions against pooled member terciles; not calibrated",
            "mean_departure_60s_60n": departure,
        },
        "fields": records,
        "drivers": "drivers.json" if has_drivers else None,
        "registry_hash": digest,
    }


def main() -> None:
    args = parse_args()
    paths = load_paths(args.paths)
    private_root = Path(paths["private_root"])
    issue = timing.parse_issue(args.issue)
    products = json.loads(args.products.read_text(encoding="utf-8"))
    dry_mm = float(products["dry_week_threshold_mm"])
    described = json.loads((args.public_dir / "regions.json").read_text(encoding="utf-8"))["regions"]
    ids, fractions, digest = load_region_weights(private_root)
    if ids != [region["id"] for region in described]:
        raise ValueError("public regions.json does not match the region weights; rerun geo_weights")

    members = load_members(private_root / "compact" / args.source / f"{issue:%Y%m%d}.nc")
    if members["attrs"]["issue_date"] != issue.isoformat():
        raise ValueError(f"compact store is for {members['attrs']['issue_date']}, not {issue}")
    clim = None if args.no_climate else load_climate(private_root, issue, digest)

    folder = args.public_dir / "issues" / args.source / f"{issue:%Y%m%d}"
    shutil.rmtree(folder / "regions", ignore_errors=True)
    (folder / "regions").mkdir(parents=True, exist_ok=True)
    fields = cell_fields(members, clim, dry_mm)
    circulation = None if clim is None else load_circulation(private_root, issue)
    land = fractions[ids.index("world")]
    if circulation is not None:
        fields.update(circulation_fields(members, circulation, land))
        write_json(folder / "drivers.json", drivers_document(members, circulation, land, issue))
    departure = {v: mean_departure(fields[f"{v}_anom"]["values"][0]) for v in climate.VARIABLES} if clim else {}
    records = write_fields(fields, products["fields"], folder)
    documents = region_documents(members, weight_matrix(fractions), described, clim, issue, dry_mm)
    for document in documents:
        write_json(folder / "regions" / f"{document['id']}.json", document)
    write_json(folder / "regions" / "summary.json", summary_document(documents))
    write_json(folder / "issue.json", issue_manifest(
        issue, args.source, members["attrs"], records, clim, digest, departure, circulation is not None))
    shutil.copyfile(args.products, args.public_dir / "products.json")
    write_catalog(args.public_dir)
    size = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
    print(f"issue {args.source}/{issue:%Y%m%d} exported to {folder}: {size / 1e6:.1f} MB, climate={'yes' if clim else 'no'}")


if __name__ == "__main__":
    main()
