#!/usr/bin/env python3
"""Local preview server that understands extensionless URLs.

Cloudflare Pages serves /blog/matrix for blog/matrix.html, and 308-redirects the
.html form to it. GitHub Pages serves both. Python's stock http.server does
neither, so previewing this site with `python -m http.server` makes every
internal link 404 and every canonical look wrong.

This adds exactly that one behaviour and nothing else, so what you see locally
matches what the CDN serves.

    python3 serve.py [port]        # default 8000
"""
import http.server
import os
import socketserver
import sys


class ExtensionlessHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) and not path.endswith("/"):
            candidate = path + ".html"
            if os.path.isfile(candidate):
                # Rewrite internally, so the address bar keeps the clean URL.
                self.path = self.path.split("?", 1)[0] + ".html"
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), ExtensionlessHandler) as httpd:
        print(f"serving http://127.0.0.1:{port}  (extensionless URLs supported)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
