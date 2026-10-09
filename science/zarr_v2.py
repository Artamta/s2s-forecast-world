"""Minimal read-only access to local Zarr v2 array stores.

This module intentionally implements only full-array reads and contiguous
axis-zero slices.  It is useful in lightweight pipeline environments where
``numcodecs`` is available but the ``zarr`` and ``xarray`` packages are not.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import product
import json
from pathlib import Path
from typing import Any

import numcodecs
import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class _ArrayMetadata:
    """Validated subset of Zarr v2 array metadata needed by the reader."""

    path: Path
    shape: tuple[int, ...]
    chunks: tuple[int, ...]
    dtype: np.dtype[Any]
    order: str
    fill_value: Any
    compressor: dict[str, Any] | None
    filters: tuple[dict[str, Any], ...]
    dimension_separator: str


def _array_path(store: Path, name: str) -> Path:
    """Resolve an array name below a store without permitting traversal."""

    store_path = Path(store)
    name_path = Path(name)
    if (
        not name
        or name_path.is_absolute()
        or any(part in {"", ".", ".."} for part in name_path.parts)
    ):
        raise ValueError("array name must be a non-empty relative path")
    return store_path.joinpath(name_path)


def _read_json_object(path: Path, *, missing_ok: bool = False) -> dict[str, Any]:
    """Read a UTF-8 JSON object with stable metadata errors."""

    if missing_ok and not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise FileNotFoundError(f"missing Zarr metadata: {path}") from None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read Zarr metadata: {path}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Zarr metadata must be a JSON object: {path}")
    return value


def _integer_tuple(value: Any, *, name: str, positive: bool) -> tuple[int, ...]:
    """Validate a JSON sequence of dimension sizes."""

    if not isinstance(value, list):
        raise ValueError(f"Zarr {name} must be a JSON array")
    result: list[int] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int):
            raise ValueError(f"Zarr {name} entries must be integers")
        if (positive and item <= 0) or (not positive and item < 0):
            qualifier = "positive" if positive else "nonnegative"
            raise ValueError(f"Zarr {name} entries must be {qualifier}")
        result.append(item)
    return tuple(result)


def _decode_fill_value(value: Any, dtype: np.dtype[Any]) -> Any:
    """Convert JSON fill-value conventions to a NumPy scalar."""

    if value is None:
        value = 0
    elif isinstance(value, str):
        special = {
            "NaN": np.nan,
            "Infinity": np.inf,
            "-Infinity": -np.inf,
        }
        value = special.get(value, value)
    elif dtype.kind == "c" and isinstance(value, list) and len(value) == 2:
        value = complex(value[0], value[1])
    try:
        return np.asarray(value, dtype=dtype).reshape(()).item()
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid fill value {value!r} for dtype {dtype}") from error


def _metadata(store: Path, name: str) -> _ArrayMetadata:
    """Load and validate an array's ``.zarray`` metadata."""

    path = _array_path(store, name)
    raw = _read_json_object(path / ".zarray")
    if raw.get("zarr_format") != 2:
        raise ValueError("only Zarr format 2 arrays are supported")
    shape = _integer_tuple(raw.get("shape"), name="shape", positive=False)
    chunks = _integer_tuple(raw.get("chunks"), name="chunks", positive=True)
    if len(shape) != len(chunks):
        raise ValueError("Zarr shape and chunks must have the same rank")
    try:
        dtype = np.dtype(raw["dtype"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("invalid or missing Zarr dtype") from error
    if dtype.hasobject:
        raise ValueError("object-dtype Zarr arrays are not supported")
    order = raw.get("order")
    if order not in {"C", "F"}:
        raise ValueError("Zarr order must be 'C' or 'F'")
    compressor = raw.get("compressor")
    if compressor is not None and not isinstance(compressor, dict):
        raise ValueError("Zarr compressor must be null or a JSON object")
    filters_value = raw.get("filters")
    if filters_value is None:
        filters: tuple[dict[str, Any], ...] = ()
    elif isinstance(filters_value, list) and all(
        isinstance(item, dict) for item in filters_value
    ):
        filters = tuple(filters_value)
    else:
        raise ValueError("Zarr filters must be null or an array of JSON objects")
    dimension_separator = raw.get("dimension_separator", ".")
    if dimension_separator not in {".", "/"}:
        raise ValueError("Zarr dimension_separator must be '.' or '/'")
    return _ArrayMetadata(
        path=path,
        shape=shape,
        chunks=chunks,
        dtype=dtype,
        order=order,
        fill_value=_decode_fill_value(raw.get("fill_value"), dtype),
        compressor=compressor,
        filters=filters,
        dimension_separator=dimension_separator,
    )


def _chunk_path(metadata: _ArrayMetadata, coordinates: tuple[int, ...]) -> Path:
    """Return the v2 chunk key path for integer chunk coordinates."""

    if not coordinates:
        return metadata.path / "0"
    parts = tuple(str(value) for value in coordinates)
    if metadata.dimension_separator == "/":
        return metadata.path.joinpath(*parts)
    return metadata.path / ".".join(parts)


def _decode_chunk(
    encoded: bytes,
    metadata: _ArrayMetadata,
    *,
    full_shape: tuple[int, ...],
    edge_shape: tuple[int, ...],
    key: Path,
) -> NDArray[Any]:
    """Decode one chunk, accepting full-sized or edge-sized payloads."""

    decoded: Any = encoded
    try:
        if metadata.compressor is not None:
            decoded = numcodecs.get_codec(metadata.compressor).decode(decoded)
        for filter_config in reversed(metadata.filters):
            decoded = numcodecs.get_codec(filter_config).decode(decoded)
    except Exception as error:
        raise ValueError(f"cannot decode Zarr chunk: {key}") from error

    try:
        if isinstance(decoded, np.ndarray) and decoded.dtype == metadata.dtype:
            flat = np.asarray(decoded).reshape(-1, order=metadata.order)
        else:
            flat = np.frombuffer(memoryview(decoded), dtype=metadata.dtype)
    except (TypeError, ValueError) as error:
        raise ValueError(f"decoded Zarr chunk has invalid bytes: {key}") from error

    full_count = int(np.prod(full_shape, dtype=np.int64)) if full_shape else 1
    edge_count = int(np.prod(edge_shape, dtype=np.int64)) if edge_shape else 1
    if flat.size == full_count:
        chunk = flat.reshape(full_shape, order=metadata.order)
        return chunk[tuple(slice(0, size) for size in edge_shape)]
    if flat.size == edge_count:
        return flat.reshape(edge_shape, order=metadata.order)
    raise ValueError(
        f"decoded Zarr chunk {key} has {flat.size} values; "
        f"expected {full_count} (full) or {edge_count} (edge)"
    )


def _read_scalar(metadata: _ArrayMetadata) -> NDArray[Any]:
    """Read a rank-zero Zarr array."""

    output = np.full((), metadata.fill_value, dtype=metadata.dtype)
    key = _chunk_path(metadata, ())
    if key.exists():
        chunk = _decode_chunk(
            key.read_bytes(), metadata, full_shape=(), edge_shape=(), key=key
        )
        output[()] = chunk[()]
    return output


def read_axis0_slice(store: Path, name: str, start: int, stop: int) -> NDArray[Any]:
    """Read the contiguous half-open slice ``[start:stop]`` on array axis zero.

    Only intersecting axis-zero chunks are opened.  Every other axis is read in
    full.  Missing chunks retain the array's declared fill value.
    """

    metadata = _metadata(Path(store), name)
    if not metadata.shape:
        raise ValueError("axis-zero slicing is not defined for a scalar array")
    if (
        isinstance(start, bool)
        or isinstance(stop, bool)
        or not isinstance(start, (int, np.integer))
        or not isinstance(stop, (int, np.integer))
    ):
        raise ValueError("slice start and stop must be integers")
    start = int(start)
    stop = int(stop)
    if start < 0 or stop < start or stop > metadata.shape[0]:
        raise ValueError("axis-zero slice must satisfy 0 <= start <= stop <= size")

    output_shape = (stop - start, *metadata.shape[1:])
    output = np.full(output_shape, metadata.fill_value, dtype=metadata.dtype)
    if start == stop or any(size == 0 for size in metadata.shape[1:]):
        return output

    first_chunk = start // metadata.chunks[0]
    last_chunk = (stop - 1) // metadata.chunks[0]
    other_chunk_counts = tuple(
        (size + chunk - 1) // chunk
        for size, chunk in zip(metadata.shape[1:], metadata.chunks[1:])
    )
    coordinate_ranges = (
        range(first_chunk, last_chunk + 1),
        *(range(count) for count in other_chunk_counts),
    )

    for coordinates in product(*coordinate_ranges):
        origin = tuple(
            coordinate * chunk
            for coordinate, chunk in zip(coordinates, metadata.chunks)
        )
        edge_shape = tuple(
            min(chunk, size - offset)
            for size, chunk, offset in zip(metadata.shape, metadata.chunks, origin)
        )
        key = _chunk_path(metadata, coordinates)
        if not key.exists():
            continue
        try:
            encoded = key.read_bytes()
        except OSError as error:
            raise ValueError(f"cannot read Zarr chunk: {key}") from error
        chunk = _decode_chunk(
            encoded,
            metadata,
            full_shape=metadata.chunks,
            edge_shape=edge_shape,
            key=key,
        )

        intersection_start = max(start, origin[0])
        intersection_stop = min(stop, origin[0] + edge_shape[0])
        source = (
            slice(intersection_start - origin[0], intersection_stop - origin[0]),
            *(slice(0, size) for size in edge_shape[1:]),
        )
        destination = (
            slice(intersection_start - start, intersection_stop - start),
            *(
                slice(offset, offset + size)
                for offset, size in zip(origin[1:], edge_shape[1:])
            ),
        )
        output[destination] = chunk[source]
    return output


def read_array(store: Path, name: str) -> NDArray[Any]:
    """Read an entire local Zarr v2 array into memory."""

    metadata = _metadata(Path(store), name)
    if not metadata.shape:
        return _read_scalar(metadata)
    return read_axis0_slice(Path(store), name, 0, metadata.shape[0])


def read_attrs(store: Path, name: str | None = None) -> dict[str, Any]:
    """Read group or array attributes, returning an empty dict when absent."""

    path = Path(store) if name is None else _array_path(Path(store), name)
    return _read_json_object(path / ".zattrs", missing_ok=True)
