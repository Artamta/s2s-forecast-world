#!/usr/bin/env python3
"""Build the static map geography: coastlines, borders and region outlines.

Lines are stored as delta-encoded integer coordinates. The world layer comes
from Natural Earth 1:50m; detail tiles for zoomed views come from 1:10m.
Borders follow Natural Earth's India point of view.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import shapely
from shapely.geometry.base import BaseGeometry

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from world import regions  # noqa: E402
from world.pipeline.common import load_paths, write_json  # noqa: E402

TILE_DEGREES = 30
BASE = {"tolerance": 0.04, "quantum": 0.01}
DETAIL = {"tolerance": 0.008, "quantum": 0.002}
OUTLINE = {"tolerance": 0.02, "quantum": 0.01}
INTERNATIONAL = "International boundary (verify)"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths", type=Path, default=ROOT / "world/config/paths.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/geo/world")
    return parser.parse_args()


def line_parts(geometry: BaseGeometry) -> list[np.ndarray]:
    """Coordinate arrays of every line or polygon ring in a geometry."""

    if geometry.is_empty or geometry.geom_type in ("Point", "MultiPoint"):
        return []
    if geometry.geom_type in ("LineString", "LinearRing"):
        return [shapely.get_coordinates(geometry)]
    if geometry.geom_type == "Polygon":
        return [shapely.get_coordinates(ring) for ring in (geometry.exterior, *geometry.interiors)]
    return [line for part in geometry.geoms for line in line_parts(part)]


def encode_lines(geometry: BaseGeometry, *, tolerance: float, quantum: float) -> list[list[int]]:
    """Simplify, snap to an integer grid and delta-encode as [x0, y0, dx, dy, ...]."""

    simplified = shapely.simplify(geometry, tolerance, preserve_topology=False)
    encoded = []
    for coordinates in line_parts(simplified):
        points = np.rint(coordinates / quantum).astype(np.int64)
        keep = np.concatenate([[True], np.any(np.diff(points, axis=0) != 0, axis=1)])
        points = points[keep]
        if len(points) < 2:
            continue
        deltas = np.vstack([points[:1], np.diff(points, axis=0)])
        encoded.append(deltas.ravel().tolist())
    return encoded


def india_view_borders(features: list[regions.Feature]) -> BaseGeometry:
    """Only the lines India treats as international boundaries.

    Lines of control and disputed or indefinite lines are left out everywhere.
    """

    kept = [
        geometry
        for record, geometry in features
        if (record.get("FCLASS_IN") or record["FEATURECLA"]) == INTERNATIONAL
    ]
    return shapely.union_all(kept)


def write_base(sources: regions.Sources, output: Path) -> None:
    coast = shapely.union_all([g for _, g in sources.layer("physical/ne_50m_coastline.shp")])
    borders = india_view_borders(sources.layer("cultural/ne_50m_admin_0_boundary_lines_land.shp"))
    write_json(output / "base.json", {
        "quantum": BASE["quantum"],
        "coast": encode_lines(coast, **BASE),
        "borders": encode_lines(borders, **BASE),
    })


def write_detail_tiles(sources: regions.Sources, output: Path) -> None:
    """Cut the 1:10m coastline into tiles; ocean-only tiles are not written."""

    lines = np.asarray([g for _, g in sources.layer("physical/ne_10m_coastline.shp")], dtype=object)
    tree = shapely.STRtree(lines)
    tiles = []
    for west in range(-180, 180, TILE_DEGREES):
        for south in range(-90, 90, TILE_DEGREES):
            box = shapely.box(west, south, west + TILE_DEGREES, south + TILE_DEGREES)
            hits = tree.query(box, predicate="intersects")
            if hits.size == 0:
                continue
            clipped = shapely.union_all(shapely.intersection(lines[hits], box))
            encoded = encode_lines(clipped, **DETAIL)
            if not encoded:
                continue
            name = f"tile_{west}_{south}.json"
            write_json(output / "detail" / name, {"quantum": DETAIL["quantum"], "coast": encoded})
            tiles.append({"path": f"detail/{name}", "west": west, "south": south})
    write_json(output / "detail" / "index.json", {"tile_degrees": TILE_DEGREES, "tiles": tiles})


def write_region_outlines(registry: list[dict[str, Any]], sources: regions.Sources, output: Path) -> None:
    """One outline per region, except the large land-area groups."""

    for entry in registry:
        if entry["kind"] == "group":
            continue
        geometry = regions.resolve_geometry(entry["geometry"], sources)
        write_json(output / "regions" / f"{entry['id']}.json", {
            "quantum": OUTLINE["quantum"],
            "outline": encode_lines(geometry, **OUTLINE),
        })


def main() -> None:
    args = parse_args()
    paths = load_paths(args.paths)
    sources = regions.Sources(Path(paths["natural_earth"]), Path(paths["admin0_countries"]))
    registry = json.loads(
        (Path(paths["private_root"]) / "static" / "registry.json").read_text(encoding="utf-8")
    )["regions"]
    write_base(sources, args.output_dir)
    write_detail_tiles(sources, args.output_dir)
    write_region_outlines(registry, sources, args.output_dir)
    total = sum(path.stat().st_size for path in args.output_dir.rglob("*.json"))
    print(f"geography written to {args.output_dir}: {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
