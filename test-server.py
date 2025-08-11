#!/usr/bin/env python3
"""
Simple HTTP server to serve the test elements page for BrowserMCP testing.
"""

import http.server
import socketserver
import os
import sys
from pathlib import Path

class TestServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)
    
    def end_headers(self):
        # Add CORS headers for better testing
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def log_message(self, format, *args):
        # Custom log format
        print(f"[{self.log_date_time_string()}] {format % args}")

def main():
    PORT = 8080
    
    # Check if port is available, try alternatives
    for port in range(PORT, PORT + 10):
        try:
            with socketserver.TCPServer(("", port), TestServerHandler) as httpd:
                print(f"Starting test server at http://localhost:{port}/")
                print(f"Test page available at: http://localhost:{port}/test-elements.html")
                print("Press Ctrl+C to stop the server")
                
                # Change to the script directory
                script_dir = os.path.dirname(os.path.abspath(__file__))
                os.chdir(script_dir)
                
                httpd.serve_forever()
        except OSError as e:
            if e.errno == 98:  # Address already in use
                print(f"Port {port} is busy, trying {port + 1}")
                continue
            else:
                print(f"Error starting server on port {port}: {e}")
                sys.exit(1)
        break
    else:
        print("Could not find an available port")
        sys.exit(1)

if __name__ == "__main__":
    main()