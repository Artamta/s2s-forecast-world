"""Tropical climate indices as weighted box means of anomaly fields."""

from __future__ import annotations

from typing import Any

import numpy as np
import shapely
from numpy.typing import NDArray

from world import grid, weights

INDICES: list[dict[str, Any]] = [
    {
        "id": "nino34", "label": "Niño 3.4 sea-surface temperature", "units": "°C", "variable": "sst", "surface": "ocean",
        "terms": [(1.0, (190, 240, -5, 5))],
        "description": "Central Pacific warmth (5°S–5°N, 170–120°W). Sustained values above +0.5 °C are El Niño conditions, "
                       "which usually bring drier weather to Indonesia, the Philippines and northern Australia.",
    },
    {
        "id": "dmi", "label": "Indian Ocean Dipole", "units": "°C", "variable": "sst", "surface": "ocean",
        "terms": [(1.0, (50, 70, -10, 10)), (-1.0, (90, 110, -10, 0))],
        "description": "Western minus eastern tropical Indian Ocean temperature. Positive values mean cooler water off "
                       "Sumatra and Java and usually less rain over western Indonesia.",
    },
    {
        "id": "wnpsm", "label": "Western North Pacific monsoon", "units": "m/s", "variable": "u850", "surface": "all",
        "terms": [(1.0, (100, 130, 5, 15)), (-1.0, (110, 140, 20, 30))],
        "description": "850 hPa westerlies over 5–15°N, 100–130°E minus those over 20–30°N, 110–140°E. Positive values "
                       "mean a stronger monsoon trough over the Philippines and South China Sea.",
    },
    {
        "id": "ausm", "label": "Australian monsoon", "units": "m/s", "variable": "u850", "surface": "all",
        "terms": [(1.0, (110, 130, -15, -5))],
        "description": "850 hPa westerly wind over 15–5°S, 110–130°E. Positive values mean stronger monsoon westerlies "
                       "over southern Indonesia and northern Australia.",
    },
]
HOVMOLLER_BAND = (-15.0, 15.0)


def box_weights(box: tuple[float, float, float, float], surface: NDArray[np.floating]) -> NDArray[np.float64]:
    """Normalised weights of a (west, east, south, north) box times a surface share per cell."""

    west, east, south, north = box
    share = weights.cell_fractions(shapely.box(west, south, east, north)) * surface
    return weights.area_weights(share)


def index_weights(definition: dict[str, Any], land_fraction: NDArray[np.floating]) -> NDArray[np.float64]:
    """Signed weights whose dot product with an anomaly field gives the index."""

    surface = 1.0 - np.clip(land_fraction, 0.0, 1.0) if definition["surface"] == "ocean" else np.ones(grid.SHAPE)
    total = np.zeros(grid.SHAPE)
    for sign, box in definition["terms"]:
        total += sign * box_weights(box, surface)
    return total


def apply_weights(field: NDArray[np.floating], signed: NDArray[np.floating], rows: slice) -> NDArray[np.float64]:
    """Index of a field given on a latitude band (rows of the global grid)."""

    outside = np.abs(signed).sum() - np.abs(signed[rows]).sum()
    if outside > 1e-9:
        raise ValueError("index box reaches outside the stored latitude band")
    band = signed[rows]
    picked_rows, picked_cols = np.nonzero(band)
    return field[..., picked_rows, picked_cols].astype(np.float64) @ band[picked_rows, picked_cols]


def band_mean(field: NDArray[np.floating], south: float, north: float) -> NDArray[np.float64]:
    """Area mean over a latitude band of a field on the global grid, keeping longitude."""

    rows = (grid.LATITUDE >= south) & (grid.LATITUDE <= north)
    area = grid.row_area()[rows]
    return np.tensordot(field[..., rows, :], area / area.sum(), axes=([-2], [0]))
