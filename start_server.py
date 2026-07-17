#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import sys
import webbrowser
import signal

PORT = 14438
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# 尝试从配置文件读取端口
try:
    import json
    _data_file = os.path.join(DIRECTORY, 'data.json')
    if os.path.exists(_data_file):
        with open(_data_file, 'r', encoding='utf-8') as f:
            _cfg = json.load(f)
        _configured_port = _cfg.get('settings', {}).get('port', 14438)
        if isinstance(_configured_port, int) and 1024 <= _configured_port <= 65535:
            PORT = _configured_port
except Exception:
    pass

try:
    import http.server
    import socketserver
    py3 = True
except ImportError:
    import SimpleHTTPServer
    import SocketServer
    py3 = False

if py3:
    BaseHandler = http.server.SimpleHTTPRequestHandler
    TCPServer = socketserver.TCPServer
else:
    BaseHandler = SimpleHTTPServer.SimpleHTTPRequestHandler
    TCPServer = SocketServer.TCPServer

class MyHandler(BaseHandler):
    def translate_path(self, path):
        if path == '/' or path == '':
            path = '/index_offline.html'
        return BaseHandler.translate_path(self, path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        BaseHandler.end_headers(self)

    def log_message(self, format, *args):
        pass

os.chdir(DIRECTORY)

handler = MyHandler

while True:
    try:
        httpd = TCPServer(("", PORT), handler)
        break
    except OSError:
        PORT += 1
        if PORT > 65535:
            print("Error: No available port found")
            sys.exit(1)

print("TackList Server running at http://localhost:%d" % PORT)

webbrowser.open("http://localhost:%d" % PORT)

def shutdown(signum, frame):
    print("\nShutting down server...")
    httpd.shutdown()
    sys.exit(0)

signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass

httpd.server_close()
