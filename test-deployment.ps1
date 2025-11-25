# SDLC Deployment Monitor (PowerShell)
# Usage: .\test-deployment.ps1 -Repository <url> -Branch <branch> [-CustomRoot <path>]

param(
    [Parameter(Mandatory=$true)]
    [string]$Repository,

    [Parameter(Mandatory=$true)]
    [string]$Branch,

    [Parameter(Mandatory=$false)]
    [string]$CustomRoot = ""
)

$API_ENDPOINT = "https://424n5iwvji.execute-api.us-east-1.amazonaws.com/prod"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SDLC Deployment Monitor" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Repository: $Repository" -ForegroundColor Green
Write-Host "Branch: $Branch" -ForegroundColor Green
if ($CustomRoot) {
    Write-Host "Custom Root: $CustomRoot" -ForegroundColor Green
}
Write-Host "========================================`n" -ForegroundColor Cyan

# Build request body
$requestBody = @{
    repository = $Repository
    branch = $Branch
}

if ($CustomRoot) {
    $requestBody.customRootFolder = $CustomRoot
}

$requestJson = $requestBody | ConvertTo-Json

# Start SDLC deployment
Write-Host "Starting SDLC deployment..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "$API_ENDPOINT/sdlc-deploy" `
        -Method Post `
        -ContentType "application/json" `
        -Body $requestJson

    $sessionId = $response.sessionId
    Write-Host "Deployment started!" -ForegroundColor Green
    Write-Host "Session ID: $sessionId`n" -ForegroundColor Green
}
catch {
    Write-Host "Failed to start deployment: $_" -ForegroundColor Red
    exit 1
}

# Track logs
$lastLogCount = 0

# Poll for status
while ($true) {
    try {
        $status = Invoke-RestMethod -Uri "$API_ENDPOINT/status/$sessionId"

        # Display status
        $statusColor = switch ($status.status) {
            "pending" { "Yellow" }
            "deploying" { "Cyan" }
            "success" { "Green" }
            "failed" { "Red" }
            default { "White" }
        }

        Write-Host "[$($status.status.ToUpper())] $($status.message)" -ForegroundColor $statusColor

        # Display new logs
        if ($status.logs) {
            $currentLogCount = $status.logs.Count
            if ($currentLogCount -gt $lastLogCount) {
                $newLogs = $status.logs[$lastLogCount..($currentLogCount-1)]
                foreach ($log in $newLogs) {
                    Write-Host "  → $log" -ForegroundColor Blue
                }
                $lastLogCount = $currentLogCount
            }
        }

        # Check if complete
        if ($status.status -eq "success" -or $status.status -eq "failed") {
            Write-Host "`n========================================" -ForegroundColor Cyan
            Write-Host "Deployment Complete" -ForegroundColor Cyan
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host "Final Status: $($status.status)" -ForegroundColor $statusColor

            if ($status.status -eq "success") {
                if ($status.deployedResources) {
                    Write-Host "`nDeployed Resources:" -ForegroundColor Green
                    $status.deployedResources.PSObject.Properties | ForEach-Object {
                        Write-Host "  • $($_.Name): $($_.Value)" -ForegroundColor Green
                    }
                }

                Write-Host "`nView full details:" -ForegroundColor Green
                Write-Host "  Invoke-RestMethod -Uri '$API_ENDPOINT/status/$sessionId' | ConvertTo-Json -Depth 10" -ForegroundColor Gray
            }
            else {
                if ($status.error) {
                    Write-Host "`nError: $($status.error)" -ForegroundColor Red
                }
            }

            break
        }

        Start-Sleep -Seconds 5
    }
    catch {
        Write-Host "Failed to get status: $_" -ForegroundColor Red
        Start-Sleep -Seconds 5
    }
}
