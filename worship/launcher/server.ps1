# OnStage Worship - Windows launcher.
# Serves the app on http://localhost:8765 (needed for microphone access) and
# opens it in its own Microsoft Edge / Google Chrome app window.
# Nothing is installed; closing this window stops the app server.
param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'))
if (-not $root.EndsWith('\')) { $root += '\' }
$base = "http://localhost:$Port/"
$Host.UI.RawUI.WindowTitle = 'OnStage Worship (keep open while using the app)'

function Find-Browser {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Open-App {
  $browser = Find-Browser
  if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=${base}index.html", '--start-maximized' }
  else { Start-Process "${base}index.html" }
}

function Ensure-Shortcut {
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnk = Join-Path $desktop 'OnStage Worship.lnk'
    if (Test-Path $lnk) { return }
    $shell = New-Object -ComObject WScript.Shell
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = Join-Path $root 'Start OnStage Worship.bat'
    $s.WorkingDirectory = $root
    $s.IconLocation = Join-Path $root 'launcher\onstage.ico'
    $s.WindowStyle = 7
    $s.Description = 'OnStage Worship'
    $s.Save()
    Write-Host 'Created a desktop shortcut: OnStage Worship'
  } catch { }
}

# Already running? Just open another window.
try {
  Invoke-WebRequest -UseBasicParsing "${base}index.html" -TimeoutSec 2 | Out-Null
  Open-App
  exit
} catch { }

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($base)
try { $listener.Start() } catch {
  Write-Host "Could not start on port $Port. Another program may be using it." -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

Write-Host ''
Write-Host '  OnStage Worship is running.' -ForegroundColor Green
Write-Host "  Address: ${base}"
Write-Host '  Keep this window open (you can minimise it). Close it to stop the app.'
Write-Host ''
Ensure-Shortcut
Open-App

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root ($rel -replace '/', '\')))
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch { $res.StatusCode = 500 }
  finally { try { $res.Close() } catch { } }
}
