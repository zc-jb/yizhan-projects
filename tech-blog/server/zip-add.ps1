$ErrorActionPreference = 'Stop'
$zipPath = $env:YZ_ZIP
$specPath = $env:YZ_SPEC
if (-not (Test-Path -LiteralPath $zipPath)) { throw "zip not found: $zipPath" }
$spec = Get-Content -LiteralPath $specPath -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Update')
try {
  foreach ($e in $spec.entries) {
    $name = ($e.name -replace '\\', '/')
    foreach ($variant in @($name, ($name -replace '/', '\'))) {
      $old = $zip.GetEntry($variant)
      if ($old) { $old.Delete() }
    }
    $entry = $zip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try {
      $bytes = [System.IO.File]::ReadAllBytes($e.src)
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
  }
} finally { $zip.Dispose() }
Write-Output 'OK'
