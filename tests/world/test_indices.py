"""Tropical indices as signed box means."""

from __future__ import annotations

import numpy as np
import pytest

from world import grid, indices

TROPICS = slice(40, 81)
NINO34, DIPOLE = indices.INDICES[0], indices.INDICES[1]


def test_single_box_index_of_a_constant_field_is_the_constant() -> None:
    signed = indices.index_weights(NINO34, np.zeros(grid.SHAPE))
    assert signed.sum() == pytest.approx(1.0)
    field = np.full((3, 41, 240), 1.7)
    np.testing.assert_allclose(indices.apply_weights(field, signed, TROPICS), 1.7)


def test_difference_index_is_zero_for_a_uniform_field() -> None:
    signed = indices.index_weights(DIPOLE, np.zeros(grid.SHAPE))
    assert signed.sum() == pytest.approx(0.0, abs=1e-12)
    west_only = np.zeros((41, 240))
    west_only[:, (grid.LONGITUDE >= 50) & (grid.LONGITUDE <= 70)] = 2.0
    assert indices.apply_weights(west_only, signed, TROPICS) == pytest.approx(2.0, rel=0.05)


def test_ocean_index_ignores_land_cells() -> None:
    land = np.zeros(grid.SHAPE)
    land[:, grid.LONGITUDE >= 215] = 1.0
    signed = indices.index_weights(NINO34, land)
    assert signed[:, grid.LONGITUDE >= 216].sum() == 0.0
    assert signed.sum() == pytest.approx(1.0)


def test_box_outside_the_stored_band_is_rejected() -> None:
    signed = indices.index_weights({"surface": "all", "terms": [(1.0, (100, 130, 35, 45))]}, np.zeros(grid.SHAPE))
    with pytest.raises(ValueError, match="outside"):
        indices.apply_weights(np.zeros((41, 240)), signed, TROPICS)


def test_band_mean_keeps_longitude() -> None:
    field = np.broadcast_to(grid.LONGITUDE, (5, *grid.SHAPE))
    mean = indices.band_mean(field, -15.0, 15.0)
    assert mean.shape == (5, 240)
    np.testing.assert_allclose(mean[0], grid.LONGITUDE)
