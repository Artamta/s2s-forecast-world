"""Small helpers shared by the world pipeline scripts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np


def load_paths(path: Path) -> dict[str, str]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, document: Any) -> None:
    """Write compact JSON atomically; NaN is an error, not a value."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    text = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    temporary.write_text(text + "\n", encoding="utf-8")
    temporary.replace(path)


def rounded(values: Any, digits: int = 2) -> Any:
    """Round an array or scalar to plain Python numbers; non-finite becomes None."""

    array = np.asarray(values, dtype=np.float64)
    if array.ndim == 0:
        return round(float(array), digits) if np.isfinite(array) else None
    return [rounded(item, digits) for item in array]


def load_region_weights(private_root: Path) -> tuple[list[str], np.ndarray, str]:
    """Region ids, cell fractions (region, lat, lon) and the registry hash."""

    with np.load(private_root / "static" / "region_weights.npz") as archive:
        return (
            [str(value) for value in archive["ids"]],
            archive["fractions"],
            str(archive["registry_hash"]),
        )
