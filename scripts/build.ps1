$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'extension'
$distRoot = Join-Path $projectRoot 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
$outputPath = Join-Path $distRoot ('naver-cafe-checker-v' + $manifest.version + '.zip')
if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath }
# Compress-Archive in Windows PowerShell 5.1 stores "\" separators, which other
# unzip tools treat as part of the file name. Write "/" entry names explicitly.
$files = @(Get-ChildItem -LiteralPath $extensionRoot -Recurse -File | ForEach-Object {
  @{ Path = $_.FullName; Name = 'extension/' + $_.FullName.Substring($extensionRoot.Length + 1).Replace('\', '/') }
}) + @(@{ Path = (Join-Path $projectRoot 'README.md'); Name = 'README.md' })
$zip = [System.IO.Compression.ZipFile]::Open($outputPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.Path, $file.Name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }
Write-Output $outputPath
