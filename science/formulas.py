"""Single authoritative implementation of dashboard scientific formulas."""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

FloatArray = NDArray[np.float64]


def _float_array(values: ArrayLike) -> FloatArray:
    """Return values as a finite-capable float64 NumPy array."""

    return np.asarray(values, dtype=np.float64)


def tp_mm_hour_to_mm_day(tp_mm_hour: ArrayLike) -> FloatArray:
    """Convert FuXi mean precipitation rate from mm h-1 to mm day-1."""

    return _float_array(tp_mm_hour) * 24.0


def kelvin_to_celsius(t2m_kelvin: ArrayLike) -> FloatArray:
    """Convert absolute temperature in Kelvin to degrees Celsius."""

    return _float_array(t2m_kelvin) - 273.15


def geopotential_to_height_dam(
    geopotential_m2_s2: ArrayLike, *, gravity_m_s2: float = 9.80665
) -> FloatArray:
    """Convert geopotential in m2 s-2 to geopotential height in decametres."""

    if gravity_m_s2 <= 0:
        raise ValueError("gravity must be positive")
    return _float_array(geopotential_m2_s2) / gravity_m_s2 / 10.0


def wind_speed(u_component: ArrayLike, v_component: ArrayLike) -> FloatArray:
    """Return vector magnitude from eastward and northward wind components."""

    return np.hypot(_float_array(u_component), _float_array(v_component))


def pascal_to_hectopascal(pressure_pa: ArrayLike) -> FloatArray:
    """Convert pressure from pascals to hectopascals."""

    return _float_array(pressure_pa) / 100.0


def top_net_thermal_to_olr(top_net_thermal_w_m2: ArrayLike) -> FloatArray:
    """Convert negative top net thermal radiation to positive outgoing flux."""

    return -_float_array(top_net_thermal_w_m2)


def _weekly_reduce(
    daily_values: ArrayLike, *, day_axis: int, operation: str
) -> FloatArray:
    """Reduce consecutive seven-day blocks while preserving axis order."""

    values = _float_array(daily_values)
    if day_axis < -values.ndim or day_axis >= values.ndim:
        raise np.exceptions.AxisError(day_axis, ndim=values.ndim)
    axis = day_axis % values.ndim
    if values.shape[axis] % 7:
        raise ValueError("daily axis length must be divisible by seven")
    moved = np.moveaxis(values, axis, 0)
    reshaped = moved.reshape(moved.shape[0] // 7, 7, *moved.shape[1:])
    if operation == "sum":
        reduced = reshaped.sum(axis=1)
    elif operation == "mean":
        reduced = reshaped.mean(axis=1)
    else:  # pragma: no cover - internal guard
        raise ValueError(f"unsupported weekly operation: {operation}")
    return np.moveaxis(reduced, 0, axis)


def weekly_total(daily_rain_mm_day: ArrayLike, *, day_axis: int = 0) -> FloatArray:
    """Sum each consecutive seven-day rainfall block."""

    return _weekly_reduce(daily_rain_mm_day, day_axis=day_axis, operation="sum")


def weekly_mean(daily_values: ArrayLike, *, day_axis: int = 0) -> FloatArray:
    """Average each consecutive seven-day block."""

    return _weekly_reduce(daily_values, day_axis=day_axis, operation="mean")


def weekly_mean_rainfall(
    daily_rain_mm_day: ArrayLike, *, day_axis: int = 0
) -> FloatArray:
    """Return the weekly total divided by exactly seven days."""

    return weekly_total(daily_rain_mm_day, day_axis=day_axis) / 7.0


def anomaly(forecast: ArrayLike, climatology: ArrayLike) -> FloatArray:
    """Subtract a matched climatology from a forecast or observation."""

    return _float_array(forecast) - _float_array(climatology)


def calendar_interpolation(
    left_slot: ArrayLike, right_slot: ArrayLike, right_weight: float
) -> FloatArray:
    """Linearly interpolate two calendar slots using the right-slot weight."""

    if not 0.0 <= right_weight <= 1.0:
        raise ValueError("right_weight must be between zero and one")
    return (1.0 - right_weight) * _float_array(left_slot) + right_weight * _float_array(
        right_slot
    )


def ensemble_mean(values: ArrayLike, *, member_axis: int = 0) -> FloatArray:
    """Arithmetic mean across forecast members."""

    return _float_array(values).mean(axis=member_axis)


def ensemble_quantile_summary(
    values: ArrayLike,
    *,
    member_axis: int = 0,
    minimum_valid_members: int = 1,
) -> dict[str, FloatArray]:
    """Return finite-member mean and quantiles, masking incomplete cells."""

    members = _float_array(values)
    axis = member_axis % members.ndim
    expected_members = members.shape[axis]
    if not 1 <= minimum_valid_members <= expected_members:
        raise ValueError("minimum_valid_members must lie within the ensemble size")
    finite = np.isfinite(members)
    valid_count = finite.sum(axis=axis)
    mean = np.divide(
        np.where(finite, members, 0.0).sum(axis=axis),
        valid_count,
        out=np.full(valid_count.shape, np.nan, dtype=np.float64),
        where=valid_count > 0,
    )
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="All-NaN slice encountered")
        quantiles = np.nanquantile(
            np.where(finite, members, np.nan),
            [0.10, 0.25, 0.50, 0.75, 0.90],
            axis=axis,
            method="linear",
        )
    available = valid_count >= minimum_valid_members
    result: dict[str, FloatArray] = {
        "mean": np.where(available, mean, np.nan),
        "p10": np.where(available, quantiles[0], np.nan),
        "p25": np.where(available, quantiles[1], np.nan),
        "p50": np.where(available, quantiles[2], np.nan),
        "p75": np.where(available, quantiles[3], np.nan),
        "p90": np.where(available, quantiles[4], np.nan),
        "valid_member_count": valid_count.astype(np.float64),
    }
    result["p90_minus_p10"] = result["p90"] - result["p10"]
    return result


def valid_member_tercile_probabilities(
    members: ArrayLike,
    lower_tercile: ArrayLike,
    upper_tercile: ArrayLike,
    *,
    member_axis: int = 0,
    minimum_valid_members: int = 1,
) -> tuple[dict[str, FloatArray], FloatArray, NDArray[np.bool_]]:
    """Return raw tercile percentages using each cell's finite-member count."""

    values = _float_array(members)
    axis = member_axis % values.ndim
    expected_members = values.shape[axis]
    if not 1 <= minimum_valid_members <= expected_members:
        raise ValueError("minimum_valid_members must lie within the ensemble size")
    lower = _float_array(lower_tercile)
    upper = _float_array(upper_tercile)
    finite = np.isfinite(values)
    valid_count = finite.sum(axis=axis)
    available = (
        (valid_count >= minimum_valid_members)
        & np.isfinite(lower)
        & np.isfinite(upper)
        & (lower < upper)
    )

    def percentage(event: NDArray[np.bool_]) -> FloatArray:
        count = np.count_nonzero(event & finite, axis=axis)
        probability = np.divide(
            count * 100.0,
            valid_count,
            out=np.full(valid_count.shape, np.nan, dtype=np.float64),
            where=valid_count > 0,
        )
        return np.where(available, probability, np.nan)

    probabilities = {
        "below_normal": percentage(values < lower),
        "near_normal": percentage((values >= lower) & (values <= upper)),
        "above_normal": percentage(values > upper),
    }
    return probabilities, valid_count.astype(np.float64), available


def forecast_spread(values: ArrayLike, *, member_axis: int = 0) -> FloatArray:
    """Population standard deviation across forecast members (ddof=0)."""

    return _float_array(values).std(axis=member_axis, ddof=0)


def climatology_spread(values: ArrayLike, *, year_axis: int = 0) -> FloatArray:
    """Sample standard deviation across annual ensemble means (ddof=1)."""

    values_array = _float_array(values)
    if values_array.shape[year_axis] < 2:
        raise ValueError("at least two climatology years are required")
    return values_array.std(axis=year_axis, ddof=1)


def climatology_terciles(
    yearly_means: ArrayLike, *, year_axis: int = 0
) -> tuple[FloatArray, FloatArray]:
    """Return lower and upper terciles across annual ensemble means."""

    lower, upper = np.quantile(
        _float_array(yearly_means), [1.0 / 3.0, 2.0 / 3.0], axis=year_axis
    )
    return lower, upper


def probability_below_normal(
    members: ArrayLike, lower_tercile: ArrayLike, *, member_axis: int = 0
) -> FloatArray:
    """Percentage of forecast members strictly below the lower tercile."""

    return (
        (_float_array(members) < _float_array(lower_tercile)).mean(axis=member_axis)
        * 100.0
    )


def probability_above_normal(
    members: ArrayLike, upper_tercile: ArrayLike, *, member_axis: int = 0
) -> FloatArray:
    """Percentage of forecast members strictly above the upper tercile."""

    return (
        (_float_array(members) > _float_array(upper_tercile)).mean(axis=member_axis)
        * 100.0
    )


def probability_near_normal(
    members: ArrayLike,
    lower_tercile: ArrayLike,
    upper_tercile: ArrayLike,
    *,
    member_axis: int = 0,
) -> FloatArray:
    """Return the percentage at or between the two climatological terciles."""

    member_values = _float_array(members)
    lower = _float_array(lower_tercile)
    upper = _float_array(upper_tercile)
    return (
        ((member_values >= lower) & (member_values <= upper)).mean(axis=member_axis)
        * 100.0
    )


def area_weights(
    latitude: ArrayLike, supported_land_fraction: ArrayLike, *, normalize: bool = True
) -> FloatArray:
    """Compute cos(latitude) times supported land fraction."""

    latitudes = _float_array(latitude)
    land_fraction = _float_array(supported_land_fraction)
    if latitudes.ndim != 1 or land_fraction.ndim != 2:
        raise ValueError("latitude must be 1-D and land fraction must be 2-D")
    if land_fraction.shape[0] != latitudes.size:
        raise ValueError("land-fraction latitude dimension does not match latitude")
    if np.any((land_fraction < 0.0) | (land_fraction > 1.0)):
        raise ValueError("supported land fractions must lie in [0, 1]")
    weights = np.cos(np.deg2rad(latitudes))[:, None] * land_fraction
    if not np.any(weights > 0.0):
        raise ValueError("area weights contain no supported cells")
    if normalize:
        weights = weights / weights.sum()
    return weights


def weighted_mean(values: ArrayLike, weights: ArrayLike) -> float:
    """Finite-value weighted arithmetic mean."""

    field = _float_array(values)
    weight = np.broadcast_to(_float_array(weights), field.shape)
    valid = np.isfinite(field) & np.isfinite(weight) & (weight > 0.0)
    if not np.any(valid):
        raise ValueError("no finite, positively weighted values")
    return float(np.sum(field[valid] * weight[valid]) / np.sum(weight[valid]))


def verification_metrics(
    forecast: ArrayLike,
    observation: ArrayLike,
    weights: ArrayLike,
    *,
    forecast_anomaly: ArrayLike | None = None,
    observation_anomaly: ArrayLike | None = None,
) -> dict[str, float]:
    """Compute area-weighted bias, MAE, RMSE, and spatial anomaly ACC."""

    forecast_values = _float_array(forecast)
    observation_values = _float_array(observation)
    if forecast_values.shape != observation_values.shape:
        raise ValueError("forecast and observation must have identical shapes")
    difference = forecast_values - observation_values
    metrics = {
        "bias": weighted_mean(difference, weights),
        "mae": weighted_mean(np.abs(difference), weights),
        "rmse": float(np.sqrt(weighted_mean(difference**2, weights))),
    }
    forecast_acc = (
        forecast_values if forecast_anomaly is None else _float_array(forecast_anomaly)
    )
    observation_acc = (
        observation_values
        if observation_anomaly is None
        else _float_array(observation_anomaly)
    )
    metrics["acc"] = weighted_spatial_correlation(
        forecast_acc, observation_acc, weights
    )
    return metrics


def weighted_spatial_correlation(
    forecast_anomaly: ArrayLike,
    observation_anomaly: ArrayLike,
    weights: ArrayLike,
) -> float:
    """Weighted spatial Pearson correlation of two anomaly fields."""

    forecast = _float_array(forecast_anomaly)
    observation = _float_array(observation_anomaly)
    if forecast.shape != observation.shape:
        raise ValueError("anomaly fields must have identical shapes")
    weight = np.broadcast_to(_float_array(weights), forecast.shape)
    valid = (
        np.isfinite(forecast)
        & np.isfinite(observation)
        & np.isfinite(weight)
        & (weight > 0.0)
    )
    if np.count_nonzero(valid) < 2:
        raise ValueError("ACC requires at least two supported cells")
    normalized_weight = weight[valid] / weight[valid].sum()
    x = forecast[valid]
    y = observation[valid]
    x_centered = x - np.sum(normalized_weight * x)
    y_centered = y - np.sum(normalized_weight * y)
    covariance = np.sum(normalized_weight * x_centered * y_centered)
    variance_product = np.sum(normalized_weight * x_centered**2) * np.sum(
        normalized_weight * y_centered**2
    )
    if variance_product <= 0.0:
        raise ValueError("ACC is undefined for a spatially constant field")
    return float(covariance / np.sqrt(variance_product))


FORMULA_DEFINITIONS: dict[str, dict[str, Any]] = {
    "rain_mm_day": {
        "expression": "tp_mm_hour × 24",
        "description": "Model 24-hour mean precipitation rate converted to daily rainfall.",
    },
    "weekly_total_mm": {
        "expression": "sum(seven daily rain_mm_day values)",
        "description": "Seven consecutive, non-overlapping UTC model periods.",
    },
    "weekly_mean_mm_day": {
        "expression": "weekly_total_mm ÷ 7",
        "description": "Weekly-mean daily rainfall rate.",
    },
    "temperature_deg_c": {
        "expression": "t2m_kelvin − 273.15",
        "description": "Kelvin-to-Celsius conversion.",
    },
    "geopotential_height_dam": {
        "expression": "geopotential ÷ 9.80665 ÷ 10",
        "description": "Geopotential converted from m² s⁻² to decametres.",
    },
    "wind_speed": {
        "expression": "√(U² + V²)",
        "description": "Wind-vector magnitude in m s⁻¹.",
    },
    "pressure_hpa": {
        "expression": "pressure_pa ÷ 100",
        "description": "Mean sea-level pressure converted from Pa to hPa.",
    },
    "outgoing_longwave_radiation": {
        "expression": "− top_net_thermal_radiation",
        "description": "Positive outgoing longwave flux in W m⁻².",
    },
    "calendar_interpolation": {
        "expression": "(1 − w) × left_slot + w × right_slot",
        "description": "Interpolation is applied to each yearly mean before averaging years.",
    },
    "model_anomaly": {
        "expression": "forecast weekly mean − matched model-climatology weekly mean",
        "description": "Model anomaly; not an IMD or IMERG anomaly.",
    },
    "imd_anomaly": {
        "expression": "IMD observation − IMD 1991–2020 calendar-day climatology",
        "description": "Gauge-analysis observation anomaly.",
    },
    "imerg_anomaly": {
        "expression": "IMERG observation − IMERG Final V07B 2001–2022 calendar-day climatology",
        "description": "Satellite observation anomaly using the fixed audited baseline.",
    },
    "area_weight": {
        "expression": "cos(latitude) × supported land fraction",
        "description": "Weights are normalized across finite supported cells for scores.",
    },
}
