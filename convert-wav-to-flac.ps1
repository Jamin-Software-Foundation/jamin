# Set your target folder (defaults to the current directory if left as ".")
$TargetFolder = "."

# Find all .wav files recursively
$WavFiles = Get-ChildItem -Path $TargetFolder -Filter "*.wav" -Recurse -File

foreach ($File in $WavFiles) {
    # Build the output path with a .flac extension in the same subfolder
    $OutputFile = [System.IO.Path]::ChangeExtension($File.FullName, ".flac")

    # Skip if the .flac file already exists
    if (Test-Path -LiteralPath $OutputFile) {
        Write-Host "Skipping (already exists): $OutputFile" -ForegroundColor Yellow
        continue
    }

    Write-Host "Converting: $($File.FullName)" -ForegroundColor Cyan

    # Run FFmpeg (-y overwrites if needed, -compression_level 8 gives maximum FLAC compression)
    ffmpeg -i "$($File.FullName)" -c:a flac -compression_level 8 -hide_banner -loglevel error "$OutputFile"

    # Optional: Uncomment the line below ONLY if you want to delete the original .wav after a successful conversion
    if ($LASTEXITCODE -eq 0) { Remove-Item -LiteralPath $File.FullName }
}

Write-Host "All conversions complete!" -ForegroundColor Green
