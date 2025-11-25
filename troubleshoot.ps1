# SDLC Deployment Troubleshooting Tool
# Usage: .\troubleshoot.ps1 -SessionId <session-id>

param(
    [Parameter(Mandatory=$false)]
    [string]$SessionId = "",

    [Parameter(Mandatory=$false)]
    [switch]$ListAllTasks,

    [Parameter(Mandatory=$false)]
    [switch]$ShowCloudWatchLogs
)

$STACK_NAME = "GitHubLambdaDeployerStack"
$REGION = "us-east-1"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SDLC Troubleshooting Tool" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Get stack outputs
Write-Host "Getting Stack Information..." -ForegroundColor Yellow
$stackOutputs = aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION --query "Stacks[0].Outputs" | ConvertFrom-Json

$clusterName = ($stackOutputs | Where-Object {$_.OutputKey -eq "ECSClusterName"}).OutputValue
$tableName = ($stackOutputs | Where-Object {$_.OutputKey -eq "DeploymentsTableName"}).OutputValue
$apiEndpoint = ($stackOutputs | Where-Object {$_.OutputKey -eq "ApiEndpoint"}).OutputValue

Write-Host "Cluster: $clusterName" -ForegroundColor Green
Write-Host "Table: $tableName" -ForegroundColor Green
Write-Host "API: $apiEndpoint`n" -ForegroundColor Green

# List all running tasks if requested
if ($ListAllTasks) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Running ECS Tasks" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan

    $tasks = aws ecs list-tasks --cluster $clusterName --region $REGION --query "taskArns" | ConvertFrom-Json

    if ($tasks.Count -eq 0) {
        Write-Host "No running tasks found" -ForegroundColor Yellow
    } else {
        Write-Host "Found $($tasks.Count) running tasks:`n" -ForegroundColor Green

        foreach ($taskArn in $tasks) {
            $taskId = $taskArn.Split('/')[-1]
            Write-Host "Task: $taskId" -ForegroundColor Cyan

            $taskDetails = aws ecs describe-tasks --cluster $clusterName --tasks $taskArn --region $REGION | ConvertFrom-Json
            $task = $taskDetails.tasks[0]

            Write-Host "  Status: $($task.lastStatus)" -ForegroundColor $(if ($task.lastStatus -eq "RUNNING") {"Green"} else {"Yellow"})
            Write-Host "  Task Definition: $($task.taskDefinitionArn.Split('/')[-1])"
            Write-Host "  Started: $($task.startedAt)"

            # Get container status
            foreach ($container in $task.containers) {
                Write-Host "  Container: $($container.name)"
                Write-Host "    Status: $($container.lastStatus)" -ForegroundColor $(if ($container.lastStatus -eq "RUNNING") {"Green"} else {"Yellow"})
                if ($container.exitCode) {
                    Write-Host "    Exit Code: $($container.exitCode)" -ForegroundColor Red
                }
                if ($container.reason) {
                    Write-Host "    Reason: $($container.reason)" -ForegroundColor Yellow
                }
            }
            Write-Host ""
        }
    }
}

# If SessionId is provided, show detailed info
if ($SessionId) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Session Details: $SessionId" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan

    # Get DynamoDB record
    Write-Host "DynamoDB Record:" -ForegroundColor Yellow
    $dynamoRecord = aws dynamodb query `
        --table-name $tableName `
        --key-condition-expression "sessionId = :sid" `
        --expression-attribute-values "{`":sid`":{`"S`":`"$SessionId`"}}" `
        --region $REGION | ConvertFrom-Json

    if ($dynamoRecord.Items.Count -eq 0) {
        Write-Host "  No record found for session $SessionId" -ForegroundColor Red
    } else {
        $item = $dynamoRecord.Items[0]
        Write-Host "  Status: $($item.status.S)" -ForegroundColor $(
            switch ($item.status.S) {
                "success" {"Green"}
                "failed" {"Red"}
                "deploying" {"Cyan"}
                default {"Yellow"}
            }
        )
        Write-Host "  Repository: $($item.repository.S)"
        Write-Host "  Branch: $($item.branch.S)"
        if ($item.message) {
            Write-Host "  Message: $($item.message.S)"
        }
        if ($item.error) {
            Write-Host "  Error: $($item.error.S)" -ForegroundColor Red
        }

        # Show logs
        if ($item.logs -and $item.logs.L) {
            Write-Host "`n  Recent Logs:" -ForegroundColor Yellow
            $item.logs.L | Select-Object -Last 10 | ForEach-Object {
                Write-Host "    → $($_.S)" -ForegroundColor Gray
            }
        }
    }

    # Find associated ECS tasks
    Write-Host "`nSearching for associated ECS tasks..." -ForegroundColor Yellow
    $allTasks = aws ecs list-tasks --cluster $clusterName --region $REGION --query "taskArns" | ConvertFrom-Json

    foreach ($taskArn in $allTasks) {
        $taskDetails = aws ecs describe-tasks --cluster $clusterName --tasks $taskArn --region $REGION | ConvertFrom-Json
        $task = $taskDetails.tasks[0]

        # Check if this task is for our session
        $envVars = $task.overrides.containerOverrides[0].environment
        $sessionEnv = $envVars | Where-Object {$_.name -eq "SESSION_ID"}

        if ($sessionEnv -and $sessionEnv.value -eq $SessionId) {
            $taskId = $taskArn.Split('/')[-1]
            Write-Host "`nFound ECS Task: $taskId" -ForegroundColor Green
            Write-Host "  Status: $($task.lastStatus)" -ForegroundColor $(if ($task.lastStatus -eq "RUNNING") {"Green"} else {"Yellow"})
            Write-Host "  Task Definition: $($task.taskDefinitionArn.Split('/')[-1])"
            Write-Host "  Started: $($task.startedAt)"

            foreach ($container in $task.containers) {
                Write-Host "  Container: $($container.name)"
                Write-Host "    Status: $($container.lastStatus)" -ForegroundColor $(if ($container.lastStatus -eq "RUNNING") {"Green"} else {"Yellow"})
            }

            # Show CloudWatch log stream
            $containerName = $task.containers[0].name
            $taskDefFamily = $task.taskDefinitionArn.Split('/')[1].Split(':')[0]

            # Determine log stream prefix based on task definition
            $logPrefix = switch -Wildcard ($taskDefFamily) {
                "*DeployerTaskDef*" { "deployer" }
                "*FixerTaskDef*" { "fixer" }
                "*SDLCManagerTaskDef*" { "sdlc-manager" }
                "*SanityTesterTaskDef*" { "sanity-tester" }
                default { "unknown" }
            }

            $logGroup = "/aws/ecs/$taskDefFamily"
            $logStream = "$logPrefix/$containerName/$taskId"

            Write-Host "`n  CloudWatch Logs:" -ForegroundColor Yellow
            Write-Host "    Log Group: $logGroup" -ForegroundColor Gray
            Write-Host "    Log Stream: $logStream" -ForegroundColor Gray
            Write-Host "`n  To view logs, run:" -ForegroundColor Yellow
            Write-Host "    aws logs tail $logGroup --follow --log-stream-names $logStream" -ForegroundColor Cyan

            if ($ShowCloudWatchLogs) {
                Write-Host "`n  Recent Log Events:" -ForegroundColor Yellow
                try {
                    $logs = aws logs get-log-events `
                        --log-group-name $logGroup `
                        --log-stream-name $logStream `
                        --limit 50 `
                        --region $REGION | ConvertFrom-Json

                    $logs.events | Select-Object -Last 20 | ForEach-Object {
                        $timestamp = [DateTimeOffset]::FromUnixTimeMilliseconds($_.timestamp).ToString("HH:mm:ss")
                        Write-Host "    [$timestamp] $($_.message)" -ForegroundColor Gray
                    }
                } catch {
                    Write-Host "    Could not fetch logs (stream may not exist yet)" -ForegroundColor Yellow
                }
            }
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Quick Commands" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nList all CloudWatch log groups:" -ForegroundColor Yellow
Write-Host "  aws logs describe-log-groups --region $REGION | Select-String 'GitHubLambdaDeployer'" -ForegroundColor Gray

Write-Host "`nList recent deployments:" -ForegroundColor Yellow
Write-Host "  aws dynamodb scan --table-name $tableName --limit 10 --region $REGION" -ForegroundColor Gray

Write-Host "`nView API Gateway logs:" -ForegroundColor Yellow
Write-Host "  aws logs tail /aws/lambda/GitHubLambdaDeployerStack-ApiHandlerLambda --follow --region $REGION" -ForegroundColor Gray

Write-Host ""
