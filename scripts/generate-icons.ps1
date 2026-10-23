<#
.SYNOPSIS
    Generates the PWA raster icons from the Icons8 Fluency "help" artwork.

.DESCRIPTION
    Downloads the 512 px source once (unless already cached in the temp folder)
    and composites it on the app's dark brand background. ImageMagick is not
    required: System.Drawing (GDI+) is available on Windows PowerShell 5.1
    and PowerShell 7.

    Output files (written to the repository's icons/ folder):
        icons/icon-192.png           192 x 192   purpose "any"
        icons/icon-512.png           512 x 512   purpose "any"
        icons/icon-maskable-512.png  512 x 512   purpose "maskable" (safe zone)
        icons/apple-touch-icon.png   180 x 180   opaque iOS home-screen icon
        icons/favicon-32.png          32 x 32    transparent browser favicon
        icons/favicon-48.png          48 x 48    transparent browser favicon

    Icon source: https://icons8.com/icons/set/fluency (free license with attribution).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File ./scripts/generate-icons.ps1

.EXAMPLE
    pwsh ./scripts/generate-icons.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$RepoRoot = Split-Path -Parent $PSScriptRoot
$IconsDir = Join-Path $RepoRoot 'icons'
New-Item -ItemType Directory -Force -Path $IconsDir | Out-Null

$SourceUrl = 'https://img.icons8.com/fluency/512/help.png'
$SourcePath = Join-Path ([System.IO.Path]::GetTempPath()) 'aide-iphone-icons8-help-512.png'

if (-not (Test-Path -LiteralPath $SourcePath)) {
    Write-Host 'Downloading Icons8 Fluency help icon...' -ForegroundColor DarkCyan
    Invoke-WebRequest -Uri $SourceUrl -OutFile $SourcePath -TimeoutSec 30 -UseBasicParsing
}

Add-Type -AssemblyName System.Drawing

function New-Color {
    param([int]$R, [int]$G, [int]$B, [int]$A = 255)
    [System.Drawing.Color]::FromArgb($A, $R, $G, $B)
}

function Set-HighQuality {
    param([Parameter(Mandatory)][System.Drawing.Graphics]$Graphics)
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

function New-Icon {
    param(
        [Parameter(Mandatory)][int]$Size,
        [Parameter(Mandatory)][string]$Path,
        [ValidateSet('standard', 'maskable', 'apple', 'favicon')][string]$Variant,
        [Parameter(Mandatory)][System.Drawing.Image]$Source
    )

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            Set-HighQuality -Graphics $graphics
            $graphics.Clear([System.Drawing.Color]::Transparent)

            if ($Variant -ne 'favicon') {
                $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
                    (New-Object System.Drawing.PointF(0, 0)),
                    (New-Object System.Drawing.PointF([float]$Size, [float]$Size)),
                    (New-Color 49 46 129),
                    (New-Color 6 9 19)
                )
                try {
                    $graphics.FillRectangle($background, 0, 0, $Size, $Size)
                } finally {
                    $background.Dispose()
                }
            }

            switch ($Variant) {
                'standard' { $contentScale = 0.92 }
                'apple'    { $contentScale = 0.90 }
                'maskable' { $contentScale = 0.76 }
                'favicon'  { $contentScale = 1.00 }
            }

            $drawSize = [int]($Size * $contentScale)
            $offset = [int](($Size - $drawSize) / 2)
            $graphics.DrawImage($Source, $offset, $offset, $drawSize, $drawSize)
        } finally {
            $graphics.Dispose()
        }

        $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq 'image/png' } |
            Select-Object -First 1
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
            [System.Drawing.Imaging.Encoder]::Quality,
            [long]100
        )
        try {
            $bitmap.Save($Path, $encoder, $encoderParams)
        } finally {
            $encoderParams.Dispose()
        }
    } finally {
        $bitmap.Dispose()
    }
}

$source = [System.Drawing.Image]::FromFile($SourcePath)
try {
    $targets = @(
        @{ File = 'icon-192.png';          Size = 192; Variant = 'standard' },
        @{ File = 'icon-512.png';          Size = 512; Variant = 'standard' },
        @{ File = 'icon-maskable-512.png'; Size = 512; Variant = 'maskable' },
        @{ File = 'apple-touch-icon.png';  Size = 180; Variant = 'apple' },
        @{ File = 'favicon-32.png';        Size = 32;  Variant = 'favicon' },
        @{ File = 'favicon-48.png';        Size = 48;  Variant = 'favicon' }
    )

    foreach ($target in $targets) {
        $path = Join-Path $IconsDir $target.File
        if ((Test-Path -LiteralPath $path) -and -not $Force) {
            Write-Host ("skip  {0,-24} (exists; use -Force to overwrite)" -f $target.File) -ForegroundColor DarkYellow
            continue
        }

        New-Icon -Size $target.Size -Path $path -Variant $target.Variant -Source $source
        $info = Get-Item -LiteralPath $path
        Write-Host ("write {0,-24} {1,4} x {2,-4} {3,7:N0} bytes" -f $target.File, $target.Size, $target.Size, $info.Length) -ForegroundColor Green
    }
} finally {
    $source.Dispose()
}

Write-Host ''
Write-Host 'Icon generation complete.' -ForegroundColor Cyan
Write-Host 'Icon source: https://icons8.com/icons/set/fluency (free license with attribution).'
