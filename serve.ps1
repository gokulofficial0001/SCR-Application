# ============================================================
# SCR Management System - Local Network Static Server
# Uses TcpListener (no admin / URL ACL needed for LAN binding)
#
# Run:  powershell -ExecutionPolicy Bypass -File serve.ps1
# Opt:  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8080
# Stop: Ctrl+C
# ============================================================

param([int]$Port = 3500)

$ErrorActionPreference = 'Stop'
$root = (Get-Item $PSScriptRoot).FullName

$mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8'
  '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'
  '.gif'='image/gif'; '.webp'='image/webp'; '.ico'='image/x-icon'
  '.woff'='font/woff'; '.woff2'='font/woff2'; '.ttf'='font/ttf'
  '.map'='application/json'; '.txt'='text/plain; charset=utf-8'
  '.pdf'='application/pdf'
}

# Detect LAN IPs (for "other devices can connect here" banner)
$lanIPs = @()
try {
  $lanIPs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.InterfaceAlias -notmatch 'Loopback' -and
      $_.IPAddress -notmatch '^169\.254\.' -and
      $_.IPAddress -ne '127.0.0.1' -and
      $_.PrefixOrigin -ne 'WellKnown'
    } | Select-Object -ExpandProperty IPAddress -Unique
} catch {}

$listener = $null
try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
  $listener.Start()
} catch {
  Write-Host "`n[!] Could not bind port $Port." -ForegroundColor Red
  Write-Host "    $($_.Exception.Message)" -ForegroundColor DarkYellow
  Write-Host "    Another process may be using this port. Try:" -ForegroundColor DarkGray
  Write-Host "    powershell -File serve.ps1 -Port 8090`n" -ForegroundColor DarkGray
  exit 1
}

# -- Banner --
$bar = "  " + ("=" * 58)
Write-Host ""
Write-Host $bar -ForegroundColor Cyan
Write-Host "    SCR Management System - Running" -ForegroundColor Cyan
Write-Host $bar -ForegroundColor Cyan
Write-Host ""
Write-Host "  On this machine:" -ForegroundColor Cyan
Write-Host "    http://localhost:$Port/" -ForegroundColor Green
if ($lanIPs.Count -gt 0) {
  Write-Host ""
  Write-Host "  On other devices (same Wi-Fi / LAN):" -ForegroundColor Cyan
  foreach ($ip in $lanIPs) {
    Write-Host "    http://${ip}:$Port/" -ForegroundColor Green
  }
}
Write-Host ""
Write-Host "  Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host $bar -ForegroundColor Cyan
Write-Host ""
Write-Host "  If other devices cannot connect, Windows Firewall may be" -ForegroundColor Yellow
Write-Host "  blocking port $Port. Run this ONCE in an Admin PowerShell:" -ForegroundColor Yellow
Write-Host "  New-NetFirewallRule -DisplayName 'SCR Server' -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow" -ForegroundColor DarkGray
Write-Host ""

# -- Serve loop --
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $client.ReceiveTimeout = 5000
    $client.SendTimeout    = 5000
    try {
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $false, 4096, $true)

      # Parse request line
      $line = $reader.ReadLine()
      if (-not $line) { continue }
      $parts = $line -split ' '
      if ($parts.Count -lt 2) { continue }
      $method = $parts[0]
      $rawPath = $parts[1]

      # Drain headers
      while (($h = $reader.ReadLine()) -and $h.Length -gt 0) { }

      # Decode + normalize path
      $clean = $rawPath.Split('?')[0]
      $decoded = [System.Uri]::UnescapeDataString($clean)
      if ($decoded -eq '/' -or [string]::IsNullOrEmpty($decoded)) { $decoded = '/index.html' }
      $rel = $decoded.TrimStart('/').Replace('/', '\')
      $file = [System.IO.Path]::GetFullPath((Join-Path $root $rel))

      # Directory traversal guard
      if (-not $file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
        $hdr = "HTTP/1.1 403 Forbidden`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        $hb = [System.Text.Encoding]::UTF8.GetBytes($hdr)
        $stream.Write($hb, 0, $hb.Length); $stream.Write($body, 0, $body.Length)
        Write-Host ("  403 {0,-5} {1}" -f $method, $decoded) -ForegroundColor Red
        continue
      }

      # Directory → index.html
      if (Test-Path -LiteralPath $file -PathType Container) {
        $idx = Join-Path $file 'index.html'
        if (Test-Path -LiteralPath $idx -PathType Leaf) { $file = $idx }
      }

      if (Test-Path -LiteralPath $file -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($file).ToLower()
        $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $body = [System.IO.File]::ReadAllBytes($file)
        $hdr = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nAccess-Control-Allow-Origin: *`r`nConnection: close`r`n`r`n"
        $hb = [System.Text.Encoding]::UTF8.GetBytes($hdr)
        $stream.Write($hb, 0, $hb.Length); $stream.Write($body, 0, $body.Length)
        Write-Host ("  200 {0,-5} {1}" -f $method, $decoded) -ForegroundColor DarkGray
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $hdr = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        $hb = [System.Text.Encoding]::UTF8.GetBytes($hdr)
        $stream.Write($hb, 0, $hb.Length); $stream.Write($body, 0, $body.Length)
        Write-Host ("  404 {0,-5} {1}" -f $method, $decoded) -ForegroundColor Red
      }
    } catch {
      # Client disconnected or malformed request — ignore
    } finally {
      try { $client.Close() } catch {}
    }
  }
} finally {
  try { $listener.Stop() } catch {}
  Write-Host "`n  Server stopped.`n" -ForegroundColor DarkGray
}
