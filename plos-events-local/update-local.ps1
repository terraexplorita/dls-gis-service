$ErrorActionPreference = 'Stop'
$base = 'https://raw.githubusercontent.com/terraexplorita/dls-gis-service/main/plos-events-local'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$files = @(
  'server.js',
  'package.json',
  'public/index.html',
  'public/app.js',
  'public/styles.css'
)

Write-Host 'Checking for PERSONAL LIFE OS Events updates...'
foreach ($rel in $files) {
  $target = Join-Path $root $rel
  $dir = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $tmp = "$target.download"
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$rel" -OutFile $tmp
  Move-Item -Force $tmp $target
  Write-Host "Updated: $rel"
}
Write-Host 'Update complete.'
