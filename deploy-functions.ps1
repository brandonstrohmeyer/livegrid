$fnList = ((firebase functions:list --json | ConvertFrom-Json).result).id
foreach ($fn in $fnList) {
    Write-Host "Starting deploy for function: $($fn)"
    $maxAttempts = 3
    $attempt = 1
    $deployed = $false
    while ($attempt -le $maxAttempts -and -not $deployed) {
        Write-Host "Attempt $($attempt): Deploying $($fn)..."
        $output = firebase deploy --only functions:$fn 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Success: $($fn) deployed."
            $deployed = $true
        } elseif ($output -match "429") {
            Write-Host "429 detected for $($fn), waiting 1 minute before retry..."
            Write-Host "Error output:"
            Write-Host $output
            if ($attempt -lt $maxAttempts) {
                Start-Sleep -Seconds 60
            } else {
                Write-Host "Failed to deploy $($fn) after $($maxAttempts) attempts due to repeated 429 errors. Exiting script."
                exit 1
            }
            $attempt++
        } else {
            Write-Host "Failed to deploy $($fn). Output:"
            Write-Host $output
            exit 1
        }
    }
}
