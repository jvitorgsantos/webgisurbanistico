import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class WebGISHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Desabilita cache para garantir leitura em tempo real do CSV e GeoJSON
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.geojson'):
            return 'application/geo+json'
        if path.endswith('.csv'):
            return 'text/csv; charset=utf-8'
        return super().guess_type(path)

print(f"===========================================================", flush=True)
print(f"   GEOPORTAL URBANISTICO - BANCO DE DADOS SP", flush=True)
print(f"===========================================================", flush=True)
print(f" Servidor HTTP iniciado em: http://localhost:{PORT}", flush=True)
print(f" Servindo pasta: {DIRECTORY}", flush=True)
print(f" Pressione Ctrl+C para encerrar o servidor.", flush=True)
print(f"===========================================================\n", flush=True)

url = f"http://localhost:{PORT}/index.html"
webbrowser.open(url)

with socketserver.TCPServer(("", PORT), WebGISHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado pelo usuario.")
        sys.exit(0)
