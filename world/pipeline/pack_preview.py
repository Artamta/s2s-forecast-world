#!/usr/bin/env python3
"""Pack the built site into a small folder that can be published as one hosted preview page.

The preview host limits the number of files and serves no raw binary files,
so each folder of per-id JSON files becomes a single ``_bundle.json``, each
``.bin`` becomes base64 text, and the page is told to read them that way.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLED_FOLDERS = {"geo/world/regions": (), "geo/world/detail": ("index.json",)}
ISSUE_REGIONS_KEEP = ("summary.json",)
TITLE = "World Subseasonal Outlook"


def bundle(source: Path, target: Path, keep: tuple[str, ...]) -> None:
    """Write every JSON file in a folder into one bundle keyed by file stem."""

    target.mkdir(parents=True, exist_ok=True)
    documents = {}
    for path in sorted(source.glob("*.json")):
        if path.name in keep:
            shutil.copyfile(path, target / path.name)
        else:
            documents[path.stem] = json.loads(path.read_text(encoding="utf-8"))
    (target / "_bundle.json").write_text(json.dumps(documents, separators=(",", ":")), encoding="utf-8")


def bundled_folders(dist: Path) -> dict[str, tuple[str, ...]]:
    folders = dict(BUNDLED_FOLDERS)
    for regions in (dist / "data/world/issues").glob("*/*/regions"):
        folders[regions.relative_to(dist).as_posix()] = ISSUE_REGIONS_KEEP
    return folders


def page_fragment(dist: Path) -> str:
    """The page body the preview host wraps: title, stylesheet, app root and script."""

    html = (dist / "index.html").read_text(encoding="utf-8")
    script = re.search(r'<script type="module"[^>]*src="\./([^"]+)"', html)
    style = re.search(r'<link rel="stylesheet"[^>]*href="\./([^"]+)"', html)
    if not script or not style:
        raise ValueError("dist/index.html has no module script or stylesheet")
    return (
        f"<title>{TITLE}</title>\n"
        f'<link rel="stylesheet" href="{style.group(1)}">\n'
        '<a class="skip-link" href="#content">Skip to content</a>\n'
        '<div id="app" data-bundled="true"><div class="boot-state"><p>Loading the world outlook…</p></div></div>\n'
        f'<script type="module" src="{script.group(1)}"></script>\n'
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--output", type=Path, default=ROOT / "preview")
    args = parser.parse_args()
    folders = bundled_folders(args.dist)
    shutil.rmtree(args.output, ignore_errors=True)
    for path in sorted(args.dist.rglob("*")):
        relative = path.relative_to(args.dist)
        inside_bundle = any(relative.parent.as_posix() == folder for folder in folders)
        if path.is_dir() or inside_bundle or path.suffix == ".map" or relative.as_posix() == "index.html":
            continue
        (args.output / relative).parent.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".bin":
            # The preview host serves no raw binary files, so each goes as base64 text.
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            (args.output / f"{relative}.json").write_text(json.dumps({"base64": encoded}), encoding="utf-8")
        else:
            shutil.copyfile(path, args.output / relative)
    for folder, keep in folders.items():
        bundle(args.dist / folder, args.output / folder, keep)
    (args.output / "index.html").write_text(page_fragment(args.dist), encoding="utf-8")
    files = sorted(p.relative_to(args.output).as_posix() for p in args.output.rglob("*") if p.is_file())
    (args.output / "files.txt").write_text("\n".join(f for f in files if f != "index.html") + "\n", encoding="utf-8")
    size = sum((args.output / name).stat().st_size for name in files)
    print(f"preview packed: {len(files)} files, {size / 1e6:.1f} MB in {args.output}")


if __name__ == "__main__":
    main()
