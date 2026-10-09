#!/usr/bin/env python3
"""Resolve the region registry and compute each region's cell fractions."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from world import grid, regions, weights  # noqa: E402
from world.pipeline.common import load_paths, write_json  # noqa: E402

NO_COUNTRY = 65535


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "world/config/regions.json")
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public/data/world")
    return parser.parse_args()


def describe(entry: dict[str, Any], fractions: np.ndarray) -> dict[str, Any]:
    """Public description of a region: where it is and how well the grid sees it."""

    cells = weights.effective_cells(fractions)
    return {
        "id": entry["id"],
        "label": entry["label"],
        "group": entry["group"],
        "parent": entry["parent"],
        "kind": entry["kind"],
        "effective_cells": round(cells, 2),
        "tier": weights.tier(cells),
        "view": entry.get("view") or weights.view_from_fractions(fractions),
    }


def add_children(described: list[dict[str, Any]]) -> None:
    by_id = {entry["id"]: entry for entry in described}
    for entry in described:
        entry["children"] = []
    for entry in described:
        if entry["parent"] is not None:
            by_id[entry["parent"]]["children"].append(entry["id"])


def country_grid(described: list[dict[str, Any]], fractions: np.ndarray) -> np.ndarray:
    """Index of the country covering most of each cell, for hover labels."""

    countries = [i for i, entry in enumerate(described) if entry["kind"] == "country"]
    stack = fractions[countries]
    best = stack.argmax(axis=0)
    covered = stack.max(axis=0) >= 0.2
    return np.where(covered, np.asarray(countries)[best], NO_COUNTRY).astype("<u2")


def main() -> None:
    args = parse_args()
    paths = load_paths(args.paths)
    config = regions.load_config(args.config)
    sources = regions.Sources(Path(paths["natural_earth"]), Path(paths["admin0_countries"]))
    registry = regions.build_registry(config, sources.admin0)

    fractions = np.zeros((len(registry), *grid.SHAPE), dtype=np.float32)
    described = []
    for index, entry in enumerate(registry):
        geometry = regions.resolve_geometry(entry["geometry"], sources)
        fractions[index] = weights.cell_fractions(geometry)
        if not fractions[index].any():
            raise ValueError(f"region {entry['id']} covers no grid cell")
        described.append(describe(entry, fractions[index]))
    add_children(described)

    digest = regions.registry_hash(registry)
    static = Path(paths["private_root"]) / "static"
    static.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        static / "region_weights.npz",
        ids=np.asarray([entry["id"] for entry in described]),
        fractions=fractions,
        registry_hash=digest,
    )
    write_json(static / "registry.json", {"registry_hash": digest, "regions": registry})

    args.public_dir.mkdir(parents=True, exist_ok=True)
    (args.public_dir / "cell-country.bin").write_bytes(country_grid(described, fractions).tobytes())
    land = fractions[[entry["id"] for entry in described].index("world")]
    (args.public_dir / "land-fraction.bin").write_bytes(np.rint(land * 100.0).astype("u1").tobytes())
    write_json(args.public_dir / "regions.json", {
        "schema_version": 1,
        "registry_hash": digest,
        "default_region": config["default_region"],
        "grid": {"shape": list(grid.SHAPE), "spacing": grid.SPACING, "lat_first": 90.0, "lon_first": 0.0},
        "tiers": {"A": weights.FULL_TIER_CELLS, "B": weights.COARSE_TIER_CELLS},
        "groups": [group["id"] for group in config["groups"]],
        "regions": described,
    })
    tiers = [entry["tier"] for entry in described]
    print(f"regions={len(described)} hash={digest} " + " ".join(f"{t}={tiers.count(t)}" for t in "ABC"))
    for entry in described:
        if entry["kind"] != "country":
            print(f"  {entry['id']:<20} cells={entry['effective_cells']:>8} tier={entry['tier']}")


if __name__ == "__main__":
    main()
