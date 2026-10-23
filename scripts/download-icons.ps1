<#
.SYNOPSIS
    Downloads the Icons8 Fluency icon set used by the Aide iPhone interface.

.DESCRIPTION
    Every interface icon is stored locally so the PWA stays usable offline and
    does not depend on a third-party CDN at runtime. Icons are downloaded from
    https://img.icons8.com/fluency/200/<slug>.png and saved as
    icons/fluency/<key>.png, where <key> is the name passed to icon() in
    common.js.

    Icons8 Fluency is free to use with attribution:
    https://icons8.com/icons/set/fluency

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File ./scripts/download-icons.ps1

.EXAMPLE
    pwsh ./scripts/download-icons.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$RepoRoot = Split-Path -Parent $PSScriptRoot
$OutputDir = Join-Path $RepoRoot 'icons/fluency'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# key used by icon() -> Icons8 Fluency slug
$Icons = [ordered]@{
    'activity'        = 'line-chart'
    'alert-circle'    = 'error'
    'alert-triangle'  = 'high-priority'
    'arrow-right'     = 'right'
    'battery'         = 'battery'
    'bell'            = 'bell'
    'book-open'       = 'book'
    'camera'          = 'camera'
    'check'           = 'checkmark'
    'check-circle'    = 'ok'
    'chevron-down'    = 'chevron-down'
    'chevron-left'    = 'chevron-left'
    'chevron-right'   = 'chevron-right'
    'clock'           = 'clock'
    'copy'            = 'copy'
    'dashboard'       = 'dashboard'
    'database'        = 'database'
    'download'        = 'download'
    'external-link'   = 'external-link'
    'eye'             = 'visible'
    'file-text'       = 'document'
    'filter'          = 'filter'
    'gauge'           = 'speedometer'
    'globe'           = 'globe-earth'
    'help'            = 'help'
    'home'            = 'home'
    'info'            = 'info'
    'life-buoy'       = 'lifebuoy'
    'lock'            = 'lock'
    'log-out'         = 'logout-rounded'
    'mail'            = 'mail'
    'map'             = 'map'
    'map-pin'         = 'place-marker'
    'megaphone'       = 'megaphone'
    'message-square'  = 'chat'
    'moon'            = 'moon'
    'navigation'      = 'navigation'
    'paperclip'       = 'attach'
    'play'            = 'play'
    'plus'            = 'plus'
    'refresh'         = 'refresh'
    'rotate-ccw'      = 'undo'
    'search'          = 'search'
    'send'            = 'send'
    'settings'        = 'settings'
    'shield'          = 'shield'
    'signal'          = 'network'
    'smartphone'      = 'iphone'
    'sparkles'        = 'sparkles'
    'sun'             = 'sun'
    'ticket'          = 'ticket'
    'tool'            = 'wrench'
    'trash'           = 'trash'
    'user'            = 'user-male-circle'
    'users'           = 'collaboration'
    'volume'          = 'speaker'
    'wifi'            = 'wifi'
    'wifi-off'        = 'no-connection'
    'x'               = 'multiply'
}

$failed = @()

foreach ($entry in $Icons.GetEnumerator()) {
    $key = $entry.Key
    $slug = $entry.Value
    $path = Join-Path $OutputDir "$key.png"

    if ((Test-Path -LiteralPath $path) -and -not $Force) {
        Write-Host ("skip  {0,-16} (exists; use -Force to overwrite)" -f $key) -ForegroundColor DarkYellow
        continue
    }

    $url = "https://img.icons8.com/fluency/200/$slug.png"
    $downloaded = $false

    for ($attempt = 1; $attempt -le 3 -and -not $downloaded; $attempt++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $path -TimeoutSec 30 -UseBasicParsing
            $downloaded = $true
        } catch {
            if ($attempt -eq 3) {
                $failed += $key
                Write-Warning ("failed {0} ({1}): {2}" -f $key, $slug, $_.Exception.Message)
            } else {
                Start-Sleep -Milliseconds (400 * $attempt)
            }
        }
    }

    if (-not $downloaded) { continue }

    try {
        $bitmap = [System.Drawing.Bitmap]::FromFile($path)
        try {
            if ($bitmap.Width -ne 200 -or $bitmap.Height -ne 200) {
                throw "expected 200x200, got $($bitmap.Width)x$($bitmap.Height)"
            }
        } finally {
            $bitmap.Dispose()
        }
    } catch {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        $failed += $key
        Write-Warning ("invalid {0}: {1}" -f $key, $_.Exception.Message)
        continue
    }

    $size = (Get-Item -LiteralPath $path).Length
    Write-Host ("write {0,-16} <- {1,-18} {2,6:N0} bytes" -f $key, $slug, $size) -ForegroundColor Green
}

Write-Host ''
if ($failed.Count -gt 0) {
    Write-Warning ("Icon download incomplete: {0}" -f ($failed -join ', '))
    exit 1
}

Write-Host ("Downloaded {0} Fluency icons into icons/fluency." -f $Icons.Count) -ForegroundColor Cyan
Write-Host 'Icon source: https://icons8.com/icons/set/fluency (free license with attribution).'
