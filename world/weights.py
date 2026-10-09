"""Fraction of each grid cell covered by a polygon, and region means from it.

Areas are measured in (longitude, sin latitude), where every grid cell is a
rectangle and planar area is proportional to area on the sphere.
"""

from __future__ import annotations

import numpy as np
import shapely
import shapely.affinity
from numpy.typing import NDArray
from shapely.geometry.base import BaseGeometry

from world import grid

FULL_TIER_CELLS = 8.0
COARSE_TIER_CELLS = 2.0


def _to_equal_area(geometry: BaseGeometry) -> BaseGeometry:
    def project(points: NDArray[np.float64]) -> NDArray[np.float64]:
        latitude = np.clip(points[:, 1], -90.0, 90.0)
        return np.column_stack([points[:, 0], np.sin(np.deg2rad(latitude))])

    return shapely.transform(shapely.segmentize(geometry, 0.25), project)


def into_grid_frame(geometry: BaseGeometry) -> BaseGeometry:
    """Move a lon/lat geometry into the grid frame, which starts at -0.75 E."""

    frame = shapely.box(grid.WEST_EDGE, -90.0, grid.WEST_EDGE + 360.0, 90.0)
    copies = [
        shapely.intersection(shapely.affinity.translate(geometry, xoff=shift), frame)
        for shift in (-360.0, 0.0, 360.0)
    ]
    return shapely.union_all([part for part in copies if part.area > 0.0])


def cell_fractions(geometry: BaseGeometry) -> NDArray[np.float32]:
    """Return the covered fraction of every grid cell, shape (121, 240)."""

    fractions = np.zeros(grid.SHAPE, dtype=np.float32)
    polygon = shapely.make_valid(geometry)
    if polygon.is_empty:
        return fractions
    polygon = _to_equal_area(into_grid_frame(polygon))
    west, south, east, north = polygon.bounds
    lon_edges = grid.longitude_edges()
    sin_edges = np.sin(np.deg2rad(grid.latitude_edges()))
    cols = np.flatnonzero((lon_edges[1:] > west) & (lon_edges[:-1] < east))
    rows = np.flatnonzero((sin_edges[:-1] > south) & (sin_edges[1:] < north))
    if cols.size == 0 or rows.size == 0:
        return fractions
    row_index, col_index = np.meshgrid(rows, cols, indexing="ij")
    boxes = shapely.box(
        lon_edges[col_index],
        sin_edges[row_index + 1],
        lon_edges[col_index + 1],
        sin_edges[row_index],
    )
    shapely.prepare(polygon)
    inside = shapely.contains_properly(polygon, boxes)
    partial = shapely.intersects(polygon, boxes) & ~inside
    covered = np.zeros(boxes.shape, dtype=np.float64)
    covered[inside] = 1.0
    covered[partial] = shapely.area(
        shapely.intersection(polygon, boxes[partial])
    ) / shapely.area(boxes[partial])
    fractions[row_index, col_index] = np.clip(covered, 0.0, 1.0)
    return fractions


def effective_cells(fractions: NDArray[np.floating]) -> float:
    """Covered area expressed in equatorial grid cells."""

    equator_row = grid.row_area().max()
    return float((fractions * grid.row_area()[:, None]).sum() / equator_row)


def tier(cells: float) -> str:
    """A: full statistics. B: shown as coarse. C: nearest-cell guidance only."""

    if cells >= FULL_TIER_CELLS:
        return "A"
    return "B" if cells >= COARSE_TIER_CELLS else "C"


def area_weights(fractions: NDArray[np.floating]) -> NDArray[np.float64]:
    """Normalised weights for an area mean over the covered part of each cell."""

    weights = fractions.astype(np.float64) * grid.row_area()[:, None]
    total = weights.sum()
    if total <= 0.0:
        raise ValueError("region covers no grid cell")
    return weights / total


def region_mean(
    values: NDArray[np.floating], fractions: NDArray[np.floating]
) -> NDArray[np.float64]:
    """Area mean over the last two axes (latitude, longitude)."""

    weights = area_weights(fractions)
    rows, cols = np.nonzero(weights)
    return np.asarray(values)[..., rows, cols].astype(np.float64) @ weights[rows, cols]


def view_from_fractions(
    fractions: NDArray[np.floating], *, margin: float = 0.12, minimum_span: float = 12.0
) -> dict[str, float]:
    """Smallest map window around a region, allowed to cross the 180 meridian."""

    rows = np.flatnonzero(fractions.any(axis=1))
    occupied = fractions.any(axis=0)
    cols = np.flatnonzero(occupied)
    if rows.size == 0:
        raise ValueError("region covers no grid cell")
    doubled = np.concatenate([cols, cols + grid.SHAPE[1]])
    gaps = np.diff(doubled)[: cols.size]
    last = int(np.argmax(gaps))
    first_col = doubled[last + 1] % grid.SHAPE[1] if cols.size > 1 else cols[0]
    span_cols = grid.SHAPE[1] - (gaps[last] - 1) if cols.size > 1 else 1
    west = grid.LONGITUDE[first_col] - grid.SPACING / 2.0
    east = west + span_cols * grid.SPACING
    north = min(90.0, grid.LATITUDE[rows[0]] + grid.SPACING / 2.0)
    south = max(-90.0, grid.LATITUDE[rows[-1]] - grid.SPACING / 2.0)
    pad_x = max(margin * (east - west), (minimum_span - (east - west)) / 2.0)
    pad_y = max(margin * (north - south), (minimum_span / 2.0 - (north - south)) / 2.0)
    west, east = west - pad_x, east + pad_x
    if east - west >= 360.0:
        west, east = grid.WEST_EDGE, grid.WEST_EDGE + 360.0
    return {
        "west": round(float(west), 2),
        "east": round(float(east), 2),
        "south": round(float(max(-90.0, south - pad_y)), 2),
        "north": round(float(min(90.0, north + pad_y)), 2),
    }
