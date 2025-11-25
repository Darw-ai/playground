# Quick SDLC Test - Uses a simple Hello World Lambda repository
# This will test the entire SDLC workflow

$API_ENDPOINT = "https://424n5iwvji.execute-api.us-east-1.amazonaws.com/prod"

# Using a simple AWS Lambda Hello World example
# You can replace this with any public CDK/CloudFormation repository
$TEST_REPO = "https://github.com/aws-samples/serverless-patterns"
$TEST_BRANCH = "main"
$TEST_ROOT = "lambda-eventbridge" # Simple Lambda pattern

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Quick SDLC Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing with: $TEST_REPO" -ForegroundColor Green
Write-Host "Branch: $TEST_BRANCH" -ForegroundColor Green
Write-Host "Root: $TEST_ROOT" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

# Just initiate the deployment and return the session ID
$requestBody = @{
    repository = $TEST_REPO
    branch = $TEST_BRANCH
    customRootFolder = $TEST_ROOT
} | ConvertTo-Json

Write-Host "Initiating SDLC deployment..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "$API_ENDPOINT/sdlc-deploy" `
        -Method Post `
        -ContentType "application/json" `
        -Body $requestBody

    Write-Host "`nDeployment initiated successfully!" -ForegroundColor Green
    Write-Host "Session ID: $($response.sessionId)" -ForegroundColor Cyan
    Write-Host "`nTo monitor progress, run:" -ForegroundColor Yellow
    Write-Host "  .\test-deployment.ps1 -Repository '$TEST_REPO' -Branch '$TEST_BRANCH' -CustomRoot '$TEST_ROOT'" -ForegroundColor Gray
    Write-Host "`nOr check status directly:" -ForegroundColor Yellow
    Write-Host "  curl $API_ENDPOINT/status/$($response.sessionId)" -ForegroundColor Gray
}
catch {
    Write-Host "Failed to start deployment:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
}
