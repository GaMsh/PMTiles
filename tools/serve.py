#!/usr/bin/env python3
"""Static server with a Range-aware proxy to cdn.pmtiles.ru (CDN CORS is esya.ru-only)."""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
UPSTREAM = "https://cdn.pmtiles.ru"
PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path.startswith("/tiles/"):
            self.proxy_tiles()
            return
        super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/tiles/"):
            self.proxy_tiles(head_only=True)
            return
        super().do_HEAD()

    def proxy_tiles(self, head_only=False):
        name = self.path.split("?", 1)[0].removeprefix("/tiles/").lstrip("/")
        if not name.endswith(".pmtiles") or "/" in name or ".." in name:
            self.send_error(404)
            return

        request = urllib.request.Request(
            f"{UPSTREAM}/{name}",
            method="HEAD" if head_only else "GET",
            headers={"User-Agent": "pmtiles.ru-dev-proxy"},
        )
        range_header = self.headers.get("Range")
        if range_header:
            request.add_header("Range", range_header)

        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                self.send_response(response.status)
                for key in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"):
                    value = response.headers.get(key)
                    if value:
                        self.send_header(key, value)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
                self.end_headers()
                if not head_only:
                    self.copyfile(response, self.wfile)
        except Exception as exc:
            self.send_error(502, str(exc))


if __name__ == "__main__":
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"http://127.0.0.1:{PORT}/")
    server.serve_forever()
