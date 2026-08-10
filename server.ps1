# Servidor HTTP Nativo do Windows em PowerShell (Zero Dependencias, nao requer Python)
Param(
    [int]$Port = 8000
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$url = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)

try {
    $listener.Start()
} catch {
    $Port = 8080
    $url = "http://localhost:$Port/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($url)
    $listener.Start()
}

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "   GEOPORTAL URBANISTICO - SERVIDOR PORTATIL WINDOWS" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Servidor rodando em: $url" -ForegroundColor Yellow
Write-Host " Pasta: $scriptDir" -ForegroundColor Gray
Write-Host " (Funciona em QUALQUER computador com Windows - Sem necessitar de Python)" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Pressione Ctrl+C para encerrar.`n"

Start-Process $url

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $localPath = $request.Url.LocalPath
        if ($localPath -eq "/") { $localPath = "/index.html" }
        
        $filePath = Join-Path $scriptDir $localPath.TrimStart('/')

        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            switch ($ext) {
                ".html"    { $response.ContentType = "text/html; charset=utf-8" }
                ".css"     { $response.ContentType = "text/css; charset=utf-8" }
                ".js"      { $response.ContentType = "application/javascript; charset=utf-8" }
                ".geojson" { $response.ContentType = "application/geo+json; charset=utf-8" }
                ".json"    { $response.ContentType = "application/json; charset=utf-8" }
                ".csv"     { $response.ContentType = "text/csv; charset=utf-8" }
                ".png"     { $response.ContentType = "image/png" }
                ".jpg"     { $response.ContentType = "image/jpeg" }
                default    { $response.ContentType = "application/octet-stream" }
            }

            $response.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate")
            $response.AddHeader("Pragma", "no-cache")
            $response.AddHeader("Access-Control-Allow-Origin", "*")

            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 - Arquivo Nao Encontrado")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }

        $response.OutputStream.Close()
    } catch {
        # Ignora conexoes interrompidas do navegador
    }
}
