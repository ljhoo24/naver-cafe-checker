$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'extension'
$distRoot = Join-Path $projectRoot 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
$outputPath = Join-Path $distRoot ('naver-cafe-checker-v' + $manifest.version + '.zip')
Compress-Archive -LiteralPath $extensionRoot,(Join-Path $projectRoot 'README.md') -DestinationPath $outputPath -Force
Write-Output $outputPath
