[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Output
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# IWXA common symbol. Geometry and dark strokes match the Personal Agent.
# Admin Center has its own canonical red #EF5350.
# Never round-trip through Bitmap.GetHicon()/Icon.Save(): on Windows that
# produces a four-bit palette and silently changes #EF5350 to #FF0000.
$target = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(64,64,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
$fill = [System.Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(239,83,80))
$ink = [System.Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(5,7,13))
$pen = [System.Drawing.Pen]::new([Drawing.Color]::FromArgb(5,7,13),7)
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

    # Native ICO with a 32-bit BGRA DIB, full alpha and explicit AND mask.
    # Both csc.exe /win32icon and Windows Explorer read this standard format.
    # The legacy GetHicon()/Icon.Save() WinForms path quantizes to red/black.
    $width=64
    $height=64
    $xorBytes=$width*$height*4
    $andStride=[int](($width+31)/32)*4
    $andBytes=$andStride*$height
    $imageBytes=40+$xorBytes+$andBytes
    $stream = [IO.File]::Open($target,[IO.FileMode]::Create,[IO.FileAccess]::Write)
    $writer = [IO.BinaryWriter]::new($stream)
    try {
        # ICONDIR + one ICONDIRENTRY (22 bytes total).
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]1)
        $writer.Write([byte]$width)
        $writer.Write([byte]$height)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$imageBytes)
        $writer.Write([UInt32]22)
        # BITMAPINFOHEADER: doubled icon height includes the AND mask.
        $writer.Write([UInt32]40)
        $writer.Write([Int32]$width)
        $writer.Write([Int32]($height*2))
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]0)
        $writer.Write([UInt32]$xorBytes)
        $writer.Write([Int32]0)
        $writer.Write([Int32]0)
        $writer.Write([UInt32]0)
        $writer.Write([UInt32]0)
        $maskRows = [System.Collections.Generic.List[byte[]]]::new()
        # BGRA XOR bitmap, bottom row first. No color palette.
        for($y=$height-1;$y -ge 0;$y--){
            $mask = New-Object byte[] $andStride
            for($x=0;$x -lt $width;$x++){
                $pixel=$bitmap.GetPixel($x,$y)
                $writer.Write([byte]$pixel.B)
                $writer.Write([byte]$pixel.G)
                $writer.Write([byte]$pixel.R)
                $writer.Write([byte]$pixel.A)
                if($pixel.A -lt 128){
                    $index=[int][Math]::Floor($x/8)
                    $mask[$index] = [byte]($mask[$index] -bor (0x80 -shr ($x%8)))
                }
            }
            $maskRows.Add($mask)
        }
        foreach($row in $maskRows){$writer.Write([byte[]]$row)}
    } finally {
        $writer.Dispose()
    }
} finally {
    $graphics.Dispose()
    $shape.Dispose()
    $fill.Dispose()
    $ink.Dispose()
    $pen.Dispose()
    $bitmap.Dispose()
}
if((Get-Item -LiteralPath $target).Length -ne 16958){
    throw 'IWXA_ADMIN_CENTER_TRUECOLOR_ICO_SIZE_INVALID'
}
Write-Host "IWXA_ADMIN_CENTER_TRUECOLOR_RED_BRAND_ICON_READY $target"
