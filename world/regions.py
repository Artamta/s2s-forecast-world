"""Region registry: curated entries plus every Natural Earth country.

A region is a config entry. Its geometry comes from Natural Earth countries
(optionally clipped to a box), a list of admin-1 units, or a lon/lat box.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from difflib import get_close_matches
from pathlib import Path
from typing import Any

import shapefile
import shapely
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

ADMIN1_FILE = "cultural/ne_10m_admin_1_states_provinces.shp"
Feature = tuple[dict[str, Any], BaseGeometry]


def load_config(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_features(path: Path) -> list[Feature]:
    """Read a shapefile as (attributes, valid geometry) pairs."""

    reader = shapefile.Reader(str(path), encoding="utf-8", encodingErrors="replace")
    features = []
    for item in reader.iterShapeRecords():
        if item.shape.shapeType == shapefile.NULL:
            continue
        geometry = shapely.make_valid(shape(item.shape.__geo_interface__))
        features.append((item.record.as_dict(), geometry))
    return features


@dataclass
class Sources:
    """Natural Earth layers, read once on first use.

    Countries come from a separate file so the India-view edition can be used.
    """

    natural_earth: Path
    admin0_path: Path
    _cache: dict[str, list[Feature]] = field(default_factory=dict)

    def layer(self, relative: str) -> list[Feature]:
        if relative not in self._cache:
            self._cache[relative] = read_features(self.natural_earth / relative)
        return self._cache[relative]

    @property
    def admin0(self) -> list[Feature]:
        key = str(self.admin0_path)
        if key not in self._cache:
            self._cache[key] = read_features(self.admin0_path)
        return self._cache[key]

    @property
    def admin1(self) -> list[Feature]:
        return self.layer(ADMIN1_FILE)


def country_entries(config: dict[str, Any], admin0: list[Feature]) -> list[dict[str, Any]]:
    """One region per Natural Earth country that belongs to a group."""

    entries = []
    for record, _ in admin0:
        code = record["ADM0_A3"]
        if code in config.get("country_skip", []):
            continue
        override = config.get("country_overrides", {}).get(code, {})
        group = override.get("group") or config["subregion_groups"].get(record["SUBREGION"])
        if group is None:
            continue
        entries.append({
            "id": code.lower(),
            "label": record["NAME"],
            "group": group,
            "parent": group,
            "kind": "country",
            "geometry": {"source": "ne_admin0", "adm0_a3": [code]},
        })
    return sorted(entries, key=lambda entry: entry["label"])


def group_entries(config: dict[str, Any], countries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One land-area region per group; the world group holds every country."""

    entries = []
    for group in config["groups"]:
        members = [
            code
            for entry in countries
            if group["id"] in ("world", entry["group"])
            for code in entry["geometry"]["adm0_a3"]
        ]
        entries.append({
            "id": group["id"],
            "label": group["label"],
            "group": group["id"],
            "parent": None if group["id"] == "world" else "world",
            "kind": "group",
            "view": group["view"],
            "geometry": {"source": "ne_admin0", "adm0_a3": members},
        })
    return entries


def build_registry(config: dict[str, Any], admin0: list[Feature]) -> list[dict[str, Any]]:
    """Groups, then countries, then curated sub-regions and climate boxes."""

    countries = country_entries(config, admin0)
    registry = group_entries(config, countries) + countries
    by_id = {entry["id"]: entry for entry in registry}
    if len(by_id) != len(registry):
        raise ValueError("a group id collides with a country code")
    for curated in config["regions"]:
        entry = dict(curated)
        parent = entry.get("parent")
        if parent is not None and parent not in by_id:
            raise ValueError(f"region {entry['id']} has unknown parent {parent}")
        entry.setdefault("group", by_id[parent]["group"] if parent else None)
        entry.setdefault("parent", entry["group"])
        if entry["id"] in by_id:
            raise ValueError(f"duplicate region id {entry['id']}")
        by_id[entry["id"]] = entry
        registry.append(entry)
    return registry


def registry_hash(registry: list[dict[str, Any]]) -> str:
    text = json.dumps(registry, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _clip_box(spec: dict[str, float]) -> BaseGeometry:
    return shapely.box(spec["west"], spec["south"], spec["east"], spec["north"])


def _admin0_geometry(spec: dict[str, Any], sources: Sources) -> BaseGeometry:
    wanted = set(spec["adm0_a3"])
    found = {record["ADM0_A3"] for record, _ in sources.admin0}
    if wanted - found:
        raise ValueError(f"unknown ADM0_A3 codes: {sorted(wanted - found)}")
    parts = [geometry for record, geometry in sources.admin0 if record["ADM0_A3"] in wanted]
    return shapely.union_all(parts)


def _admin1_geometry(spec: dict[str, Any], sources: Sources) -> BaseGeometry:
    units = [item for item in sources.admin1 if item[0]["adm0_a3"] == spec["adm0_a3"]]
    available = sorted({str(record[spec["field"]]) for record, _ in units})
    for value in spec["in"]:
        if value not in available:
            near = get_close_matches(value, available, n=3)
            raise ValueError(
                f"{spec['adm0_a3']} has no admin-1 {spec['field']} {value!r}; closest: {near}"
            )
    wanted = set(spec["in"])
    return shapely.union_all([g for record, g in units if record[spec["field"]] in wanted])


def resolve_geometry(spec: dict[str, Any], sources: Sources) -> BaseGeometry:
    """Return a region's lon/lat geometry (longitudes as Natural Earth gives them)."""

    if spec["source"] == "box":
        return _clip_box(spec)
    if spec["source"] == "ne_admin0":
        geometry = _admin0_geometry(spec, sources)
    elif spec["source"] == "ne_admin1":
        geometry = _admin1_geometry(spec, sources)
    else:
        raise ValueError(f"unknown geometry source {spec['source']!r}")
    if "clip" in spec:
        geometry = shapely.intersection(geometry, _clip_box(spec["clip"]))
    if geometry.is_empty:
        raise ValueError(f"geometry is empty for {spec}")
    return geometry
