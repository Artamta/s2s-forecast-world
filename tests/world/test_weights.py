"""Cell fractions and region means on the global 1.5-degree grid."""

from __future__ import annotations

import numpy as np
import pytest
import shapely

from world import grid, weights


def box(west: float, south: float, east: float, north: float) -> shapely.Polygon:
    return shapely.box(west, south, east, north)


def sampled_fractions(polygon: shapely.Polygon, samples: int = 20) -> np.ndarray:
    """Independent estimate: share of equal-area sample points inside the polygon."""

    lon_edges = grid.longitude_edges()
    sin_edges = np.sin(np.deg2rad(grid.latitude_edges()))
    offsets = (np.arange(samples) + 0.5) / samples
    fractions = np.zeros(grid.SHAPE)
    for row in range(grid.SHAPE[0]):
        sines = sin_edges[row] + (sin_edges[row + 1] - sin_edges[row]) * offsets
        latitude = np.rad2deg(np.arcsin(sines))
        for col in range(grid.SHAPE[1]):
            longitude = lon_edges[col] + grid.SPACING * offsets
            lon_grid, lat_grid = np.meshgrid(longitude, latitude)
            fractions[row, col] = shapely.contains_xy(polygon, lon_grid, lat_grid).mean()
    return fractions


def test_grid_edges_and_row_area() -> None:
    assert grid.latitude_edges()[[0, 1, -1]].tolist() == [90.0, 89.25, -90.0]
    assert grid.longitude_edges()[[0, -1]].tolist() == [-0.75, 359.25]
    assert grid.row_area().sum() == pytest.approx(2.0)


def test_box_inside_one_cell_and_half_cell() -> None:
    inside = weights.cell_fractions(box(119.25, -0.75, 120.75, 0.75))
    assert inside[60, 80] == pytest.approx(1.0)
    assert inside.sum() == pytest.approx(1.0)
    half = weights.cell_fractions(box(119.25, -0.75, 120.0, 0.75))
    assert half[60, 80] == pytest.approx(0.5)


def test_tiny_polygon_is_tier_c() -> None:
    tiny = weights.cell_fractions(box(103.7, 1.2, 103.9, 1.4))
    assert tiny.sum() == pytest.approx(0.2 * 0.2 / 1.5**2, rel=0.01)
    assert weights.tier(weights.effective_cells(tiny)) == "C"


def test_antimeridian_box_equals_its_two_halves() -> None:
    whole = weights.cell_fractions(box(175.0, -10.0, 185.0, 10.0))
    east = weights.cell_fractions(box(175.0, -10.0, 180.0, 10.0))
    west = weights.cell_fractions(box(-180.0, -10.0, -175.0, 10.0))
    np.testing.assert_allclose(whole, east + west, atol=1e-6)
    assert whole[:, 120].max() == pytest.approx(1.0)


def test_greenwich_cell_is_covered_from_both_sides() -> None:
    fractions = weights.cell_fractions(box(-0.75, -0.75, 0.75, 0.75))
    assert fractions[60, 0] == pytest.approx(1.0)
    assert fractions.sum() == pytest.approx(1.0)


def test_southern_mirror_gives_mirrored_fractions() -> None:
    north = weights.cell_fractions(box(100.3, 3.1, 111.8, 14.6))
    south = weights.cell_fractions(box(100.3, -14.6, 111.8, -3.1))
    np.testing.assert_allclose(north, south[::-1], atol=1e-6)


def test_adjacent_polygons_sum_to_their_union() -> None:
    left = weights.cell_fractions(box(95.2, -5.4, 104.1, 6.3))
    right = weights.cell_fractions(box(104.1, -5.4, 110.6, 6.3))
    union = weights.cell_fractions(box(95.2, -5.4, 110.6, 6.3))
    np.testing.assert_allclose(left + right, union, atol=1e-6)


def test_polar_half_cells() -> None:
    cap = weights.cell_fractions(box(-180.0, 80.0, 180.0, 90.0))
    assert cap[0].min() == pytest.approx(1.0)
    assert weights.effective_cells(cap) < 240 * 7


def test_exact_fractions_match_point_sampling() -> None:
    triangle = shapely.Polygon([(96.0, -6.0), (118.5, 2.0), (104.0, 19.5)])
    exact = weights.cell_fractions(triangle)
    np.testing.assert_allclose(exact, sampled_fractions(triangle), atol=0.02)


def test_region_mean_of_constant_and_of_latitude() -> None:
    fractions = weights.cell_fractions(box(90.0, -30.0, 150.0, 30.0))
    constant = np.full(grid.SHAPE, 7.5)
    assert weights.region_mean(constant, fractions) == pytest.approx(7.5)
    latitude = np.broadcast_to(grid.LATITUDE[:, None], grid.SHAPE)
    assert weights.region_mean(latitude, fractions) == pytest.approx(0.0, abs=1e-9)
    stacked = np.stack([constant, constant * 2.0])
    np.testing.assert_allclose(weights.region_mean(stacked, fractions), [7.5, 15.0])


def test_view_crosses_the_antimeridian() -> None:
    view = weights.view_from_fractions(weights.cell_fractions(box(170.0, -20.0, 190.0, -10.0)))
    assert view["west"] < 170.0 < 190.0 < view["east"] <= view["west"] + 360.0
    assert view["south"] < -20.0 and view["north"] > -10.0
