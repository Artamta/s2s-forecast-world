"""Verification scores as sums that can be added across cases, then finished.

A case is one hindcast start and lead week. Each case adds to running sums;
``finish`` turns the sums into scores. Climatology is the reference throughout.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

SUMS = (
    "n", "n_bss", "bs_below", "bs_above", "ref_below", "ref_above",
    "fa_oa", "fa_fa", "oa_oa", "err2", "raw_err", "raw_err2",
    "crps", "crps_raw", "crps_clim",
)
CLIMATE_CHANCE = 1.0 / 3.0


def fair_crps(members: NDArray[np.floating], truth: NDArray[np.floating]) -> NDArray[np.float64]:
    """Fair CRPS of an ensemble on axis 0: E|X - y| - E|X - X'| / 2 over distinct pairs."""

    ordered = np.sort(np.asarray(members, dtype=np.float64), axis=0)
    count = ordered.shape[0]
    rank = (2.0 * np.arange(1, count + 1) - count - 1.0).reshape(-1, *([1] * (ordered.ndim - 1)))
    spread = (rank * ordered).sum(axis=0) / (count * (count - 1.0))
    return np.abs(ordered - truth).mean(axis=0) - spread


def category_chances(
    members: NDArray[np.floating], lower: NDArray[np.floating], upper: NDArray[np.floating]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Fraction of members strictly below the lower and above the upper tercile."""

    return (members < lower).mean(axis=0), (members > upper).mean(axis=0)


def case_sums(
    members: NDArray[np.floating],
    truth: NDArray[np.floating],
    model: dict[str, NDArray[np.floating]],
    observed: dict[str, NDArray[np.floating]],
    observed_samples: NDArray[np.floating],
    scoreable: NDArray[np.bool_],
) -> dict[str, NDArray[np.float64]]:
    """Sums contributed by one case; cells without truth contribute nothing.

    ``model`` and ``observed`` hold the mean and tercile edges (mean, lower,
    upper) of each climate. ``scoreable`` marks cells where the tercile
    categories are defined (not a dry-season week).
    """

    valid = np.isfinite(truth) & np.isfinite(observed["mean"]) & np.isfinite(observed_samples).all(axis=0)
    truth = np.where(valid, truth, 0.0)
    observed = {name: np.where(valid, value, 0.0) for name, value in observed.items()}
    observed_samples = np.where(valid, observed_samples, 0.0)
    forecast = members.mean(axis=0)
    forecast_anomaly = forecast - model["mean"]
    truth_anomaly = truth - observed["mean"]
    corrected = members - model["mean"] + observed["mean"]
    below, above = category_chances(members, model["lower"], model["upper"])
    truth_below = (truth < observed["lower"]).astype(np.float64)
    truth_above = (truth > observed["upper"]).astype(np.float64)
    scored = valid & scoreable
    terms = {
        "n": np.ones_like(truth),
        "fa_oa": forecast_anomaly * truth_anomaly,
        "fa_fa": forecast_anomaly**2,
        "oa_oa": truth_anomaly**2,
        "err2": (forecast_anomaly - truth_anomaly) ** 2,
        "raw_err": forecast - truth,
        "raw_err2": (forecast - truth) ** 2,
        "crps": fair_crps(corrected, truth),
        "crps_raw": fair_crps(members, truth),
        "crps_clim": fair_crps(observed_samples, truth),
    }
    sums = {name: np.where(valid, value, 0.0) for name, value in terms.items()}
    sums["n_bss"] = scored.astype(np.float64)
    sums["bs_below"] = np.where(scored, (below - truth_below) ** 2, 0.0)
    sums["bs_above"] = np.where(scored, (above - truth_above) ** 2, 0.0)
    sums["ref_below"] = np.where(scored, (CLIMATE_CHANCE - truth_below) ** 2, 0.0)
    sums["ref_above"] = np.where(scored, (CLIMATE_CHANCE - truth_above) ** 2, 0.0)
    return sums


def _ratio(top: NDArray, bottom: NDArray) -> NDArray[np.float64]:
    return np.divide(top, bottom, out=np.full(np.shape(top), np.nan), where=np.asarray(bottom) > 0)


def finish(sums: dict[str, NDArray[np.floating]], minimum_cases: int = 20) -> dict[str, NDArray[np.float64]]:
    """Scores from accumulated sums; NaN where too few cases were scored."""

    n, n_bss = sums["n"], sums["n_bss"]
    enough = n >= minimum_cases
    enough_bss = n_bss >= minimum_cases
    hide = lambda values, keep: np.where(keep, values, np.nan)  # noqa: E731
    scores = {
        "bss": hide(1.0 - _ratio(sums["bs_below"] + sums["bs_above"], sums["ref_below"] + sums["ref_above"]), enough_bss),
        "bss_below": hide(1.0 - _ratio(sums["bs_below"], sums["ref_below"]), enough_bss),
        "bss_above": hide(1.0 - _ratio(sums["bs_above"], sums["ref_above"]), enough_bss),
        "acc": hide(_ratio(sums["fa_oa"], np.sqrt(sums["fa_fa"] * sums["oa_oa"])), enough),
        "msss": hide(1.0 - _ratio(sums["err2"], sums["oa_oa"]), enough),
        "crpss": hide(1.0 - _ratio(sums["crps"], sums["crps_clim"]), enough),
        "rmse": hide(np.sqrt(_ratio(sums["err2"], n)), enough),
        "rmse_clim": hide(np.sqrt(_ratio(sums["oa_oa"], n)), enough),
        "rmse_raw": hide(np.sqrt(_ratio(sums["raw_err2"], n)), enough),
        "bias": hide(_ratio(sums["raw_err"], n), enough),
        "crps": hide(_ratio(sums["crps"], n), enough),
        "crps_raw": hide(_ratio(sums["crps_raw"], n), enough),
        "crps_clim": hide(_ratio(sums["crps_clim"], n), enough),
    }
    scores["cases"] = np.asarray(n, dtype=np.float64)
    return scores
