"""Verification sums and the scores finished from them."""

from __future__ import annotations

import numpy as np
import pytest

from world import probability, scores


def brute_fair_crps(members: np.ndarray, truth: float) -> float:
    count = len(members)
    pairs = np.abs(members[:, None] - members[None, :]).sum() / (2 * count * (count - 1))
    return float(np.abs(members - truth).mean() - pairs)


def test_fair_crps_matches_the_pairwise_definition() -> None:
    rng = np.random.default_rng(3)
    members = rng.gamma(2.0, 5.0, size=(51, 4, 5))
    truth = rng.gamma(2.0, 5.0, size=(4, 5))
    fast = scores.fair_crps(members, truth)
    for index in np.ndindex(4, 5):
        assert fast[index] == pytest.approx(brute_fair_crps(members[(slice(None), *index)], truth[index]))


def run_cases(forecast_of, cases: int = 400) -> dict[str, np.ndarray]:
    """Score many cases at one point with a climate of unit normal values."""

    rng = np.random.default_rng(11)
    climate = rng.normal(size=45_000)
    lower, upper = np.quantile(climate, [1 / 3, 2 / 3])
    summary = {"mean": np.zeros(1), "lower": np.full(1, lower), "upper": np.full(1, upper)}
    total = {name: np.zeros(1) for name in scores.SUMS}
    for _ in range(cases):
        truth = rng.normal(size=1)
        members = forecast_of(truth, rng)
        sums = scores.case_sums(members, truth, summary, summary, climate[:45, None], np.ones(1, dtype=bool))
        for name in total:
            total[name] += sums[name]
    return scores.finish(total)


def test_perfect_forecast_scores_one() -> None:
    result = run_cases(lambda truth, rng: np.repeat(truth[None], 51, axis=0))
    assert result["bss"][0] == pytest.approx(1.0)
    assert result["acc"][0] == pytest.approx(1.0)
    assert result["msss"][0] == pytest.approx(1.0)
    assert result["rmse"][0] == pytest.approx(0.0, abs=1e-12)


def test_climatological_forecast_has_no_skill() -> None:
    result = run_cases(lambda truth, rng: rng.normal(size=(600, 1)))
    assert abs(result["bss"][0]) < 0.03
    assert abs(result["crpss"][0]) < 0.08
    assert result["rmse"][0] == pytest.approx(result["rmse_clim"][0], rel=0.05)


def test_missing_truth_and_dry_weeks_are_not_counted() -> None:
    summary = {"mean": np.zeros(2), "lower": np.full(2, -0.4), "upper": np.full(2, 0.4)}
    members = np.zeros((51, 2))
    samples = np.linspace(-1, 1, 45)[:, None] * np.ones(2)
    sums = scores.case_sums(members, np.array([np.nan, 0.2]), summary, summary, samples, np.array([True, False]))
    assert sums["n"].tolist() == [0.0, 1.0]
    assert sums["n_bss"].tolist() == [0.0, 0.0]
    assert np.isfinite(np.concatenate(list(sums.values()))).all()


def test_too_few_cases_gives_no_score() -> None:
    total = {name: np.ones(1) for name in scores.SUMS}
    assert np.isnan(scores.finish(total)["acc"][0])


def test_whole_percentages_sum_to_one_hundred() -> None:
    assert probability.whole_percentages(33.4, 33.3, 33.3) == {"below": 34, "near": 33, "above": 33}
    assert sum(probability.whole_percentages(12.5, 62.5, 25.0).values()) == 100
    assert probability.dominant({"below": 40, "near": 20, "above": 40}) == "none"
    assert probability.dominant({"below": 10, "near": 30, "above": 60}) == "above"


def test_tercile_probabilities_follow_the_climate() -> None:
    rng = np.random.default_rng(5)
    members = rng.normal(size=(3000, 4))
    lower, upper = np.quantile(rng.normal(size=200_000), [1 / 3, 2 / 3])
    chance = probability.tercile_probabilities(members, np.full(4, lower), np.full(4, upper))
    for name in probability.CATEGORIES:
        assert chance[name] == pytest.approx(100 / 3, abs=3.0)
    total = chance["below"] + chance["near"] + chance["above"]
    np.testing.assert_allclose(total, 100.0)
    undefined = probability.tercile_probabilities(members, np.zeros(4), np.zeros(4))
    assert np.isnan(undefined["below"]).all()
