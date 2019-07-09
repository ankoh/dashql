#!/usr/bin/env python
import BaseHTTPServer, SimpleHTTPServer
 
port=8080
print "Running on port %d" % port

# Set wasm MIME type
SimpleHTTPServer.SimpleHTTPRequestHandler.extensions_map['.wasm'] = 'application/wasm'

# Create http server
httpd = BaseHTTPServer.HTTPServer(('localhost', port), SimpleHTTPServer.SimpleHTTPRequestHandler)
httpd.serve_forever()

