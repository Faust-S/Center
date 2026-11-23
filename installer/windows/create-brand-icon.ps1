[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Output
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# The same shapes and proportions as the Personal Agent's favicon.svg.
# Admin Center changes only the green field to red #EF5350.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IwxaIconNative {
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr handle);
}
'@
$target = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(64,64,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
$fill = [System.Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(239,83,80))
$ink = [System.Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(5,7,13))
$pen = [System.Drawing.Pen]::new([Drawing.Color]::FromArgb(5,7,13),7)
$handle = [IntPtr]::Zero
try {
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $shape.AddArc(0,0,20,20,180,90)
    $shape.AddArc(44,0,20,20,270,90)
    $shape.AddArc(44,44,20,20,0,90)
    $shape.AddArc(0,44,20,20,90,90)
    $shape.CloseFigure()
    $graphics.FillPath($fill,$shape)
    $graphics.FillRectangle($ink,13,13,7,38)
    $pen.StartCap = [Drawing.Drawing2D.LineCap]::Flat
    $pen.EndCap = [Drawing.Drawing2D.LineCap]::Flat
    $graphics.DrawLine($pen,29,14,51,50)
    $graphics.DrawLine($pen,51,14,29,50)
    $handle = $bitmap.GetHicon()
    $icon = [Drawing.Icon]::FromHandle($handle)
    try {
        $stream = [IO.File]::Open($target,[IO.FileMode]::Create,[IO.FileAccess]::Write)
        try { $icon.Save($stream) } finally { $stream.Dispose() }
    } finally { $icon.Dispose() }
} finally {
    if ($handle -ne [IntPtr]::Zero) {
        [void][IwxaIconNative]::DestroyIcon($handle)
    }
    $graphics.Dispose()
    $shape.Dispose()
    $fill.Dispose()
    $ink.Dispose()
    $pen.Dispose()
    $bitmap.Dispose()
}
Write-Host "IWXA_ADMIN_CENTER_RED_BRAND_ICON_READY $target"
