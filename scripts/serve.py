#!/usr/bin/env python3
"""Dev server that refuses to let the browser cache anything.

python3 -m http.server sends no Cache-Control at all, so a browser is free to
heuristically cache index.html and keep showing an old build's asset URLs.
The token in the nav bar then says one thing and the page does another.
This serves the same tree on the same port with `no-cache` on every
response — the server-side half of the cache-busting toolkit.
"""
import http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8150
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
