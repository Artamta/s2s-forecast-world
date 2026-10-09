"""Region registry built from a config and Natural Earth style features."""

from __future__ import annotations

import pytest
import shapely

from world import regions

CONFIG = {
    "groups": [{"id": "world", "label": "World", "view": {}}, {"id": "seasia", "label": "SE Asia", "view": {}}],
    "subregion_groups": {"South-Eastern Asia": "seasia"},
    "country_overrides": {"PNG": {"group": "seasia"}},
    "regions": [
        {"id": "idn-west", "label": "West", "parent": "idn", "kind": "subnational",
         "geometry": {"source": "ne_admin0", "adm0_a3": ["IDN"], "clip": {"west": 95, "east": 110, "south": -10, "north": 6}}},
        {"id": "box-mc", "label": "Box", "group": "seasia", "kind": "climate_box",
         "geometry": {"source": "box", "west": 100, "east": 140, "south": -10, "north": 10}},
    ],
}
ADMIN0 = [
    ({"ADM0_A3": "IDN", "NAME": "Indonesia", "SUBREGION": "South-Eastern Asia"}, shapely.box(95, -10, 141, 6)),
    ({"ADM0_A3": "PNG", "NAME": "Papua New Guinea", "SUBREGION": "Melanesia"}, shapely.box(141, -10, 155, -2)),
    ({"ADM0_A3": "ATA", "NAME": "Antarctica", "SUBREGION": "Antarctica"}, shapely.box(-180, -90, 180, -70)),
]
ADMIN1 = [
    ({"adm0_a3": "IDN", "name": "Aceh"}, shapely.box(95, 2, 98, 6)),
    ({"adm0_a3": "IDN", "name": "Riau"}, shapely.box(100, 0, 104, 2)),
]


class FakeSources:
    admin0 = ADMIN0
    admin1 = ADMIN1


def test_registry_orders_groups_countries_then_curated_regions() -> None:
    registry = regions.build_registry(CONFIG, ADMIN0)
    assert [entry["id"] for entry in registry] == ["world", "seasia", "idn", "png", "idn-west", "box-mc"]
    by_id = {entry["id"]: entry for entry in registry}
    assert by_id["png"]["group"] == "seasia"
    assert by_id["idn-west"]["group"] == "seasia" and by_id["idn-west"]["parent"] == "idn"
    assert by_id["box-mc"]["parent"] == "seasia"
    assert by_id["seasia"]["geometry"]["adm0_a3"] == ["IDN", "PNG"]
    assert "ATA" not in by_id["world"]["geometry"]["adm0_a3"]


def test_group_id_cannot_collide_with_a_country_code() -> None:
    clash = {**CONFIG, "groups": [{"id": "world", "label": "World", "view": {}}, {"id": "idn", "label": "Clash", "view": {}}],
             "subregion_groups": {"South-Eastern Asia": "idn"}, "country_overrides": {}, "regions": []}
    with pytest.raises(ValueError, match="collides"):
        regions.build_registry(clash, ADMIN0)


def test_geometry_sources() -> None:
    sources = FakeSources()
    clipped = regions.resolve_geometry(CONFIG["regions"][0]["geometry"], sources)
    assert clipped.bounds == (95.0, -10.0, 110.0, 6.0)
    box = regions.resolve_geometry(CONFIG["regions"][1]["geometry"], sources)
    assert box.area == pytest.approx(40 * 20)
    units = regions.resolve_geometry({"source": "ne_admin1", "adm0_a3": "IDN", "field": "name", "in": ["Aceh", "Riau"]}, sources)
    assert units.area == pytest.approx(12 + 8)


def test_unknown_names_fail_with_suggestions() -> None:
    with pytest.raises(ValueError, match="closest: \\['Aceh'\\]"):
        regions.resolve_geometry({"source": "ne_admin1", "adm0_a3": "IDN", "field": "name", "in": ["Acheh"]}, FakeSources())
    with pytest.raises(ValueError, match="unknown ADM0_A3"):
        regions.resolve_geometry({"source": "ne_admin0", "adm0_a3": ["XXX"]}, FakeSources())
