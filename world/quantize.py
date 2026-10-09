"""Fixed-point encoding of public fields: value = stored * scale + offset."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

DTYPES = {"u8": np.dtype("u1"), "u16le": np.dtype("<u2")}


def missing_code(dtype: str) -> int:
    """The largest stored value is reserved for cells without a value."""

    return int(np.iinfo(DTYPES[dtype]).max)


def encode(values: NDArray[np.floating], *, dtype: str, scale: float, offset: float, label: str) -> NDArray:
    """Round to the stored grid; non-finite cells become the missing code."""

    finite = np.isfinite(values)
    stored = np.rint((np.where(finite, values, offset) - offset) / scale)
    limit = missing_code(dtype) - 1
    if stored.min() < 0 or stored.max() > limit:
        low, high = float(values[finite].min()), float(values[finite].max())
        raise ValueError(f"{label} range {low:.3f} to {high:.3f} does not fit {dtype}")
    return np.where(finite, stored, missing_code(dtype)).astype(DTYPES[dtype])


def decode(stored: NDArray, *, dtype: str, scale: float, offset: float) -> NDArray[np.float64]:
    values = stored.astype(np.float64) * scale + offset
    return np.where(stored == missing_code(dtype), np.nan, values)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_field(
    path: Path,
    values: NDArray[np.floating],
    spec: dict[str, Any],
    flags: dict[int, NDArray[np.bool_]] | None = None,
) -> dict[str, Any]:
    """Write one encoded field and return its manifest record.

    ``flags`` maps a reserved stored code to the cells that carry it.
    """

    stored = encode(
        values, dtype=spec["dtype"], scale=spec["scale"], offset=spec["offset"], label=path.name
    )
    for code, mask in (flags or {}).items():
        stored[mask] = code
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(stored.tobytes(order="C"))
    temporary.replace(path)
    finite = values[np.isfinite(values)]
    return {
        "path": path.name,
        "dtype": spec["dtype"],
        "scale": spec["scale"],
        "offset": spec["offset"],
        "missing": missing_code(spec["dtype"]),
        "shape": list(stored.shape),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "minimum": float(finite.min()) if finite.size else None,
        "maximum": float(finite.max()) if finite.size else None,
    }
