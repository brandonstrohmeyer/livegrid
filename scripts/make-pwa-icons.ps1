Add-Type -AssemblyName System.Drawing
$sizes = 192,512
foreach ($size in $sizes) {
  $bmp = New-Object Drawing.Bitmap $size, $size
  $graphics = [Drawing.Graphics]::FromImage($bmp)
  $graphics.Clear([Drawing.Color]::FromArgb(255,32,44,64))

  $primaryColor = [Drawing.Color]::FromArgb(255,94,129,172)
  $accentColor = [Drawing.Color]::FromArgb(255,236,239,244)
  $brush = New-Object Drawing.SolidBrush $primaryColor
  $pen = New-Object Drawing.Pen $accentColor, ($size / 16)

  $graphics.FillRectangle($brush, $size * 0.1, $size * 0.25, $size * 0.8, $size * 0.5)
  $graphics.DrawRectangle($pen, $size * 0.1, $size * 0.25, $size * 0.8, $size * 0.5)
  $graphics.FillEllipse($brush, $size * 0.3, $size * 0.35, $size * 0.4, $size * 0.4)
  $graphics.DrawArc($pen, $size * 0.2, $size * 0.2, $size * 0.6, $size * 0.6, 200, 140)

  $graphics.Dispose()
  $outputPath = Join-Path $PSScriptRoot "..\public\pwa-icon-$size.png"
  $bmp.Save($outputPath, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
