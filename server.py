"""Minimal static file server bound to 0.0.0.0:5000 for Replit preview.

Serves files from the project directory and disables caching during dev so the
proxied iframe always shows the latest content.
"""
from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


HOST = "0.0.0.0"
PORT = 5000


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - match base signature
        print("[server] " + (format % args), flush=True)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), NoCacheHandler)
    print(f"[server] Serving on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[server] Shutting down", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
