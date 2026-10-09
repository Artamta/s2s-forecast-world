"""Calendar interpolation for native seasonal and full-year model climates."""
from __future__ import annotations

from datetime import date
from calendar import isleap
from typing import Iterable


def native_slot(stamp: str) -> str:
    """Match native end-of-February starts across leap and ordinary years."""
    slot = str(stamp)[4:]
    return '0228' if slot == '0229' else slot


def native_initialization(year: int, slot: str) -> str:
    """Recover the actual native date for a normalized calendar slot."""
    actual_slot = '0229' if slot == '0228' and isleap(int(year)) else slot
    return f'{year}{actual_slot}'


def calendar_bracket(slots: Iterable[str], target: str, *, cyclic: bool = False,
                     year: int = 2000, native_february: bool = False) -> tuple[str, str, float]:
    labels = sorted(str(value) for value in slots)
    if not labels or len(labels) != len(set(labels)):
        raise ValueError('Climatology slots must be nonempty and distinct')
    def slot_date(label: str, calendar_year: int) -> date:
        actual = native_initialization(calendar_year, label)[4:] if native_february else label
        return date(calendar_year, int(actual[:2]), int(actual[2:]))

    dates = [slot_date(label, year) for label in labels]
    day = date(year, int(target[:2]), int(target[2:]))
    if day in dates:
        label = labels[dates.index(day)]
        return label, label, 0.0
    if cyclic:
        dates = [slot_date(labels[-1], year - 1), *dates, slot_date(labels[0], year + 1)]
        labels = [labels[-1], *labels, labels[0]]
    for i in range(1, len(dates)):
        if dates[i - 1] < day < dates[i]:
            weight = (day - dates[i - 1]).days / (dates[i] - dates[i - 1]).days
            return labels[i - 1], labels[i], weight
    raise ValueError(f'{target} is outside available climatology slots')


def full_year_slots(slots: Iterable[str]) -> bool:
    labels = sorted(str(v) for v in slots)
    if len(labels) != 104 or len(set(labels)) != 104:
        return False
    if {v[:2] for v in labels} != {f'{m:02d}' for m in range(1, 13)}:
        return False
    try:
        dates = [date(2000, int(v[:2]), int(v[2:])) for v in labels]
    except ValueError:
        return False
    dates.append(date(2001, dates[0].month, dates[0].day))
    return max((right - left).days for left, right in zip(dates, dates[1:])) <= 5
