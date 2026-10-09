#!/usr/bin/env python3
"""Serve a built site locally, for screenshots and local viewing.

``/__hold`` answers after a delay. The page requests it in snapshot mode so the
browser's load event, which headless screenshots wait for, comes after drawing.
"""

from __future__ import annotations

import argparse
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    hold_seconds = 0.0

    def do_GET(self) -> None:  # noqa: N802 - name fixed by http.server
        if self.path.split("?")[0].endswith("/__hold"):
            time.sleep(self.hold_seconds)
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--hold-seconds", type=float, default=6.0)
    args = parser.parse_args()
    Handler.hold_seconds = args.hold_seconds
    handler = partial(Handler, directory=str(args.root))
    ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
