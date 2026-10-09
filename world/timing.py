"""Dates of an issue: model state, lead days, weeks and the matching hindcast slot.

Issue D is initialised from the model state of D-1 and its first lead day is the
UTC day D. The hindcast ``init`` coordinate is the model-state day, so an issue
is matched to hindcast starts around D-1, and hindcast lead day k verifies on
``init + k``.
"""

from __future__ import annotations

from datetime import date, timedelta

LEAD_DAYS = 42
WEEKS = 6


def parse_issue(stamp: str) -> date:
    """Read an issue id written as YYYYMMDD or YYYY-MM-DD."""

    digits = stamp.replace("-", "")
    return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))


def model_state_day(issue: date) -> date:
    return issue - timedelta(days=1)


def lead_day_date(issue: date, lead_day: int) -> date:
    """UTC day covered by a one-based lead day."""

    return issue + timedelta(days=lead_day - 1)


def week_window(issue: date, week: int) -> tuple[date, date]:
    """First and last UTC day of a one-based forecast week."""

    start = issue + timedelta(days=7 * (week - 1))
    return start, start + timedelta(days=6)


def slot_target(issue: date) -> str:
    """MMDD of the model-state day, the calendar position of the hindcast match."""

    return model_state_day(issue).strftime("%m%d")


def hindcast_week_start(init: date, week: int) -> date:
    """First verifying day of a hindcast week for a model-state ``init``."""

    return init + timedelta(days=1 + 7 * (week - 1))
