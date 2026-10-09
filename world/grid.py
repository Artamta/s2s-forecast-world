"""The fixed FuXi-S2S global grid: 121 x 240 cell centres at 1.5 degrees."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

SPACING = 1.5
SHAPE = (121, 240)
LATITUDE = np.linspace(90.0, -90.0, SHAPE[0])
LONGITUDE = np.linspace(0.0, 358.5, SHAPE[1])
WEST_EDGE = -SPACING / 2.0


def latitude_edges() -> NDArray[np.float64]:
    """Cell edges north to south; the two polar rows are half cells."""

    inner = (LATITUDE[:-1] + LATITUDE[1:]) / 2.0
    return np.concatenate([[90.0], inner, [-90.0]])


def longitude_edges() -> NDArray[np.float64]:
    """Cell edges eastward from the western edge of the Greenwich cell."""

    return WEST_EDGE + SPACING * np.arange(SHAPE[1] + 1)


def row_area() -> NDArray[np.float64]:
    """Relative spherical area of one cell in each latitude row."""

    sines = np.sin(np.deg2rad(latitude_edges()))
    return sines[:-1] - sines[1:]


def wrap_longitude(longitude: float) -> float:
    """Map any longitude into the grid frame [-0.75, 359.25)."""

    return (float(longitude) - WEST_EDGE) % 360.0 + WEST_EDGE


def validate_coordinates(latitude: NDArray, longitude: NDArray, label: str) -> None:
    if not np.allclose(latitude, LATITUDE):
        raise ValueError(f"{label} has an unexpected latitude coordinate")
    if not np.allclose(longitude, LONGITUDE):
        raise ValueError(f"{label} has an unexpected longitude coordinate")
