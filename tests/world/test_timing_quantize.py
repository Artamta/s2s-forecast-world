"""Issue dates and the fixed-point field encoding."""

from __future__ import annotations

from datetime import date

import numpy as np
import pytest

from science.calendar import calendar_bracket
from world import quantize, timing


def test_issue_is_one_day_after_model_state() -> None:
    issue = timing.parse_issue("20261007")
    assert timing.model_state_day(issue) == date(2026, 10, 6)
    assert timing.slot_target(issue) == "1006"
    assert timing.lead_day_date(issue, 1) == date(2026, 10, 7)
    assert timing.week_window(issue, 1) == (date(2026, 10, 7), date(2026, 10, 13))
    assert timing.week_window(issue, 6)[1] == timing.lead_day_date(issue, 42)


def test_hindcast_week_starts_the_day_after_init() -> None:
    assert timing.hindcast_week_start(date(2019, 10, 6), 1) == date(2019, 10, 7)
    assert timing.hindcast_week_start(date(2019, 10, 6), 3) == date(2019, 10, 21)


def test_slot_bracket_wraps_the_new_year_and_leap_day() -> None:
    slots = ["0103", "0106", "1227", "1231"]
    assert timing.slot_target(timing.parse_issue("2026-01-02")) == "0101"
    left, right, weight = calendar_bracket(slots, "0101", cyclic=True, native_february=True)
    assert (left, right) == ("1231", "0103")
    assert weight == pytest.approx(1.0 / 3.0)
    assert timing.slot_target(timing.parse_issue("20240301")) == "0229"


def test_encode_round_trip_and_missing() -> None:
    values = np.array([[0.0, 12.34, np.nan], [650.0, 0.04, 99.96]])
    spec = {"dtype": "u16le", "scale": 0.1, "offset": 0.0}
    stored = quantize.encode(values, label="rain", **spec)
    decoded = quantize.decode(stored, **spec)
    assert np.isnan(decoded[0, 2])
    finite = np.isfinite(values)
    assert np.abs(decoded[finite] - values[finite]).max() <= 0.05 + 1e-9


def test_encode_rejects_values_outside_the_range() -> None:
    with pytest.raises(ValueError):
        quantize.encode(np.array([300.0]), dtype="u8", scale=1.0, offset=0.0, label="p")


def test_write_field_records_size_and_checksum(tmp_path) -> None:
    values = np.linspace(-5.0, 5.0, 6 * 121 * 240).reshape(6, 121, 240)
    spec = {"dtype": "u16le", "scale": 0.01, "offset": -100.0}
    record = quantize.write_field(tmp_path / "field.bin", values, spec)
    assert record["bytes"] == 6 * 121 * 240 * 2
    assert record["sha256"] == quantize.sha256(tmp_path / "field.bin")
    assert record["shape"] == [6, 121, 240]
