#!/usr/bin/env python3
"""Independent checks of the public world package before it is built or shared."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from world import grid, quantize  # noqa: E402

FORBIDDEN = ("/storage/", "/home/")
ISSUE_BUDGET_BYTES = 12_000_000


def reject_constant(name: str) -> None:
    raise ValueError(f"non-finite JSON value {name}")


def read_json(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    for pattern in FORBIDDEN:
        if pattern in text:
            raise ValueError(f"{path} contains a private path ({pattern})")
    return json.loads(text, parse_constant=reject_constant)


def check_field(folder: Path, name: str, record: dict[str, Any]) -> np.ndarray:
    """Size, checksum and value range of one binary field; returns decoded values."""

    path = folder / record["path"]
    dtype = quantize.DTYPES[record["dtype"]]
    expected = int(np.prod(record["shape"])) * dtype.itemsize
    if path.stat().st_size != expected or record["bytes"] != expected:
        raise ValueError(f"{path} has {path.stat().st_size} bytes, expected {expected}")
    if quantize.sha256(path) != record["sha256"]:
        raise ValueError(f"{path} does not match its recorded checksum")
    if record["shape"][-2:] != list(grid.SHAPE) or record["shape"][0] != len(record["layers"]):
        raise ValueError(f"{name} has shape {record['shape']} for layers {record['layers']}")
    stored = np.frombuffer(path.read_bytes(), dtype=dtype).reshape(record["shape"])
    values = quantize.decode(stored, dtype=record["dtype"], scale=record["scale"], offset=record["offset"])
    if "dry" in record:
        values = np.where(stored == record["dry"], np.nan, values)
    finite = values[np.isfinite(values)]
    slack = record["scale"]
    if finite.size and (finite.min() < record["minimum"] - slack or finite.max() > record["maximum"] + slack):
        raise ValueError(f"{name} decodes outside its recorded range")
    return values


def check_probabilities(name: str, values: np.ndarray) -> None:
    below, above = values
    total = below + above
    if np.nanmin(values) < 0.0 or np.nanmax(total) > 100.5:
        raise ValueError(f"{name}: below + above exceeds 100%")


def check_region(document: dict[str, Any], has_climate: bool) -> None:
    if len(document["weeks"]) != 6:
        raise ValueError(f"region {document['id']} does not have six weeks")
    for week in document["weeks"]:
        for variable in ("rain", "t2m"):
            record = week[variable]
            if not record["p10"] <= record["p50"] <= record["p90"]:
                raise ValueError(f"region {document['id']} week {week['week']} quantiles are not ordered")
            tercile = record.get("tercile") if has_climate else None
            if tercile and tercile["below"] + tercile["near"] + tercile["above"] != 100:
                raise ValueError(f"region {document['id']} week {week['week']} chances do not sum to 100")
    for variable in ("rain", "t2m"):
        if len(document["daily"][variable]["p50"]) != 42:
            raise ValueError(f"region {document['id']} has no 42-day plume")


def check_issue(public_dir: Path, entry: dict[str, Any], region_ids: list[str]) -> None:
    manifest_path = public_dir / entry["manifest"]
    if quantize.sha256(manifest_path) != entry["manifest_sha256"]:
        raise ValueError(f"{manifest_path} does not match the catalog checksum")
    manifest = read_json(manifest_path)
    folder = manifest_path.parent
    has_climate = manifest["climate"] is not None
    for name, record in manifest["fields"].items():
        values = check_field(folder, name, record)
        if name.endswith("_prob"):
            check_probabilities(name, values)
    for region_id in region_ids:
        check_region(read_json(folder / "regions" / f"{region_id}.json"), has_climate)
    summary = read_json(folder / "regions" / "summary.json")
    if sorted(summary["regions"]) != sorted(region_ids):
        raise ValueError(f"{folder} summary does not list every region")
    size = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
    if size > ISSUE_BUDGET_BYTES:
        raise ValueError(f"{folder} is {size / 1e6:.1f} MB, over the per-issue budget")
    print(f"ok {manifest['source']}/{manifest['issue']}: {len(manifest['fields'])} fields, "
          f"{len(region_ids)} regions, {size / 1e6:.1f} MB, climate={'yes' if has_climate else 'no'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public/data/world")
    public_dir = parser.parse_args().public_dir
    catalog = read_json(public_dir / "catalog.json")
    regions = read_json(public_dir / "regions.json")
    read_json(public_dir / "products.json")
    region_ids = [region["id"] for region in regions["regions"]]
    if (public_dir / "cell-country.bin").stat().st_size != grid.SHAPE[0] * grid.SHAPE[1] * 2:
        raise ValueError("cell-country.bin has an unexpected size")
    if (public_dir / "land-fraction.bin").stat().st_size != grid.SHAPE[0] * grid.SHAPE[1]:
        raise ValueError("land-fraction.bin has an unexpected size")
    for source in catalog["sources"]:
        for entry in source["issues"]:
            check_issue(public_dir, entry, region_ids)
    print("public world package is valid")


if __name__ == "__main__":
    main()
