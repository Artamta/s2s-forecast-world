#!/usr/bin/env python3
"""Rebuild the world catalog from the issue folders that are present."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from world.pipeline.common import write_json  # noqa: E402
from world.quantize import sha256  # noqa: E402

SOURCE_ORDER = ("ifs", "gfs", "era5")
SOURCE_LABELS = {
    "ifs": "IFS-initialised",
    "gfs": "GFS-initialised",
    "era5": "ERA5-initialised",
}


def issue_entry(folder: Path) -> dict[str, Any]:
    manifest = json.loads((folder / "issue.json").read_text(encoding="utf-8"))
    return {
        "id": manifest["issue"],
        "issue_date": manifest["issue_date"],
        "members": manifest["members"],
        "valid_through": manifest["weeks"][-1]["valid_end"],
        "has_climate": manifest["climate"] is not None,
        "manifest": f"issues/{manifest['source']}/{manifest['issue']}/issue.json",
        "manifest_sha256": sha256(folder / "issue.json"),
    }


def write_catalog(public_dir: Path) -> dict[str, Any]:
    """List every exported issue, newest first, with the primary source's latest as current."""

    sources = []
    for source in SOURCE_ORDER:
        folders = sorted((public_dir / "issues" / source).glob("*/issue.json"), reverse=True)
        if folders:
            sources.append({
                "id": source,
                "label": SOURCE_LABELS[source],
                "issues": [issue_entry(path.parent) for path in folders],
            })
    if not sources:
        raise ValueError(f"no issues under {public_dir / 'issues'}")
    catalog = {
        "schema_version": 1,
        "current": {"source": sources[0]["id"], "issue": sources[0]["issues"][0]["id"]},
        "sources": sources,
    }
    write_json(public_dir / "catalog.json", catalog)
    return catalog


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public/data/world")
    write_catalog(parser.parse_args().public_dir)
