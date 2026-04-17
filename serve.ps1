$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:3500/")
$listener.Start()
Write-Host "Server running at http://localhost:3500"
Write-Host "Press Ctrl+C to stop"

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $path = $request.Url.LocalPath

    if ($path -eq "/") { $path = "/index.html" }

    $basePath = "d:\scr\SCR APPLICATION ANTIGRAVITY\SCR FILES"
    $filePath = Join-Path $basePath ($path -replace "/", "\")

    if (Test-Path $filePath) {
        $content = [System.IO.File]::ReadAllBytes($filePath)
        $ext = [System.IO.Path]::GetExtension($filePath)
        $mime = switch ($ext) {
            ".html" { "text/html; charset=utf-8" }
            ".css"  { "text/css; charset=utf-8" }
            ".js"   { "application/javascript; charset=utf-8" }
            ".json" { "application/json" }
            ".svg"  { "image/svg+xml" }
            ".png"  { "image/png" }
            ".jpg"  { "image/jpeg" }
            default { "application/octet-stream" }
        }
        $response.ContentType = $mime
        $response.ContentLength64 = $content.Length
        $response.OutputStream.Write($content, 0, $content.Length)
    } else {
        $response.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes("Not Found: $path")
        $response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $response.Close()
}
