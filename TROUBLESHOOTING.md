# SDLC Deployment Troubleshooting Guide

## Overview

The SDLC system consists of 4 main components, each with their own logs:

1. **API Handler Lambda** - Entry point for API requests
2. **SDLC Manager (ECS)** - Orchestrates the workflow
3. **Deployer (ECS)** - Deploys the repository
4. **Sanity Tester (ECS)** - Runs AI-generated tests

## Where to Find Logs

### 1. CloudWatch Log Groups

All logs are in CloudWatch. Here are the key log groups:

```bash
# API Handler Lambda (entry point)
/aws/lambda/GitHubLambdaDeployerStack-ApiHandlerLambdaB8B72F13-*

# SDLC Manager Container
GitHubLambdaDeployerStack-SDLCManagerTaskDefSDLCManagerContainerLogGroupD2BFBFB4-*

# Deployer Container
GitHubLambdaDeployerStack-DeployerTaskDefDeployerContainerLogGroup5E995D80-*

# Sanity Tester Container
GitHubLambdaDeployerStack-SanityTesterTaskDefSanityTesterContainerLogGroupB644172B-*

# Fixer Container
GitHubLambdaDeployerStack-FixerTaskDefFixerContainerLogGroup8395E174-*

# Status Analyzer Lambda
/aws/lambda/GitHubLambdaDeployerStack-StatusAnalyzerLambdaDA18-*
```

### 2. DynamoDB Table

All session data and logs are stored in DynamoDB:

```bash
# Table name (from stack outputs)
GitHubLambdaDeployerStack-DeploymentsTable5D087E52-132UVUHOXD9VU
```

### 3. ECS Tasks

Running/stopped tasks in the ECS cluster:

```bash
# Cluster name (from stack outputs)
GitHubLambdaDeployerStack-DeployerClusterC3ADB834-sOJIW9S447uh
```

## Troubleshooting Steps

### Step 1: Check API Response

When you initiate a deployment, you get a session ID:

```bash
curl -X POST https://424n5iwvji.execute-api.us-east-1.amazonaws.com/prod/sdlc-deploy \
  -H "Content-Type: application/json" \
  -d '{"repository": "https://github.com/user/repo", "branch": "main"}'
```

Response:
```json
{
  "sessionId": "sdlc-xxxxx",
  "status": "pending",
  "message": "SDLC deployment workflow initiated successfully"
}
```

### Step 2: Check Deployment Status

Use the session ID to check status:

```bash
curl https://424n5iwvji.execute-api.us-east-1.amazonaws.com/prod/status/sdlc-xxxxx
```

This returns:
- `status`: pending | deploying | success | failed
- `logs`: Array of log messages from all stages
- `deployedResources`: Deployed resources (if successful)
- `error`: Error message (if failed)

### Step 3: Check API Handler Lambda Logs

If the deployment doesn't start, check the API Handler Lambda:

```bash
aws logs tail /aws/lambda/GitHubLambdaDeployerStack-ApiHandlerLambdaB8B72F13-s6tiPqJM6f7B \
  --follow --region us-east-1
```

Look for:
- Validation errors (invalid repository URL, etc.)
- ECS task start failures
- DynamoDB write errors

### Step 4: Find Your ECS Task

List recent log streams to find your task:

```bash
# For SDLC Manager
aws logs describe-log-streams \
  --log-group-name "GitHubLambdaDeployerStack-SDLCManagerTaskDefSDLCManagerContainerLogGroupD2BFBFB4-OSEMRYIbYfft" \
  --order-by LastEventTime \
  --descending \
  --max-items 10 \
  --region us-east-1
```

Log stream name format:
```
sdlc-manager/<container-name>/<task-id>
```

### Step 5: View Container Logs

Once you have the log stream name:

```bash
aws logs get-log-events \
  --log-group-name "GitHubLambdaDeployerStack-SDLCManagerTaskDefSDLCManagerContainerLogGroupD2BFBFB4-OSEMRYIbYfft" \
  --log-stream-name "sdlc-manager/SDLCManagerContainer/<task-id>" \
  --limit 100 \
  --region us-east-1
```

Or use tail for real-time:

```bash
aws logs tail "GitHubLambdaDeployerStack-SDLCManagerTaskDefSDLCManagerContainerLogGroupD2BFBFB4-OSEMRYIbYfft" \
  --follow \
  --log-stream-names "sdlc-manager/SDLCManagerContainer/<task-id>" \
  --region us-east-1
```

### Step 6: Check ECS Task Status

See why a task might have failed:

```bash
# List all tasks (running and stopped)
aws ecs list-tasks \
  --cluster GitHubLambdaDeployerStack-DeployerClusterC3ADB834-sOJIW9S447uh \
  --region us-east-1

# Describe a specific task
aws ecs describe-tasks \
  --cluster GitHubLambdaDeployerStack-DeployerClusterC3ADB834-sOJIW9S447uh \
  --tasks <task-arn> \
  --region us-east-1
```

Look for:
- `lastStatus`: PENDING, RUNNING, STOPPED
- `stoppedReason`: Why the task stopped
- `containers[].exitCode`: Container exit code (0 = success, non-zero = error)
- `containers[].reason`: Container failure reason

### Step 7: Check DynamoDB Directly

Query the deployments table:

```bash
# Get a specific session
aws dynamodb query \
  --table-name GitHubLambdaDeployerStack-DeploymentsTable5D087E52-132UVUHOXD9VU \
  --key-condition-expression "sessionId = :sid" \
  --expression-attribute-values '{":sid":{"S":"sdlc-xxxxx"}}' \
  --region us-east-1

# Scan recent deployments
aws dynamodb scan \
  --table-name GitHubLambdaDeployerStack-DeploymentsTable5D087E52-132UVUHOXD9VU \
  --limit 10 \
  --region us-east-1
```

## Common Issues

### Issue: Container Status "PENDING"

**Symptoms:**
- Container stuck in PENDING state
- No logs appearing in CloudWatch

**Causes:**
1. Image pull failure (ECR permissions)
2. VPC/subnet configuration issues
3. Resource constraints (CPU/memory limits)

**Check:**
```bash
aws ecs describe-tasks \
  --cluster <cluster-name> \
  --tasks <task-arn> \
  --region us-east-1 \
  --query "tasks[0].containers[0].reason"
```

### Issue: 502 Bad Gateway from Status Analyzer

**Symptoms:**
- SDLC Manager logs show "Error polling status: 502"
- Status checks failing

**Causes:**
1. Lambda timeout (Status Analyzer takes too long)
2. Lambda cold start
3. CloudFormation stack operations taking longer than Lambda timeout

**Solution:**
- This is usually transient - the SDLC Manager retries
- Check Status Analyzer Lambda logs:
```bash
aws logs tail /aws/lambda/GitHubLambdaDeployerStack-StatusAnalyzerLambdaDA18-* \
  --follow --region us-east-1
```

### Issue: Deployment Fails with "Unsupported IaC type"

**Symptoms:**
- Deployer fails quickly
- Error: "Unsupported IaC type: unknown"

**Causes:**
- Repository doesn't contain recognizable IaC files
- Project root specified incorrectly

**Check Deployer Logs:**
Look for the IaC detection logic output

**Supported IaC Types:**
- CDK (cdk.json)
- SAM (template.yaml/template.yml with Transform: AWS::Serverless)
- Serverless Framework (serverless.yml)
- Terraform (.tf files)
- CloudFormation (.yaml/.yml/.json templates)
- Simple Lambda (index.js/py without templates)

### Issue: Bedrock Model Access Denied

**Symptoms:**
- AI features fail
- Error: "Access Denied" for Bedrock

**Solution:**
1. Enable Amazon Nova Pro in AWS Bedrock console
2. Go to: AWS Console → Bedrock → Model Access
3. Enable "Amazon Nova Pro" for us-east-1 region
4. Wait 2-3 minutes for permissions to propagate

## Debugging Tools

### PowerShell Troubleshooting Script

```powershell
# List all running tasks
.\troubleshoot.ps1 -ListAllTasks

# Debug a specific session
.\troubleshoot.ps1 -SessionId "sdlc-xxxxx"

# Include CloudWatch logs
.\troubleshoot.ps1 -SessionId "sdlc-xxxxx" -ShowCloudWatchLogs
```

### Monitor Deployment Progress

```powershell
# Real-time monitoring
.\test-deployment.ps1 -Repository "https://github.com/user/repo" -Branch "main"
```

### Quick Status Check

```bash
# Check status via API
curl https://424n5iwvji.execute-api.us-east-1.amazonaws.com/prod/status/<session-id>

# Pretty print with PowerShell
Invoke-RestMethod -Uri "https://424n5iwvji.execute-api.us-east-1.amazonaws.com/prod/status/<session-id>" | ConvertTo-Json -Depth 10
```

## Log Locations Summary

| Component | Where Logs Are |
|-----------|---------------|
| API requests/responses | DynamoDB `logs` field + API Handler Lambda logs |
| SDLC orchestration | SDLC Manager ECS logs |
| Repository cloning/deployment | Deployer ECS logs |
| AI API discovery | Sanity Tester ECS logs |
| Sanity test execution | Sanity Tester ECS logs |
| Code fixes | Fixer ECS logs |
| Stack status analysis | Status Analyzer Lambda logs |

## Useful AWS Console Links

1. **ECS Cluster**: AWS Console → ECS → Clusters → GitHubLambdaDeployerStack-DeployerCluster*
2. **DynamoDB Table**: AWS Console → DynamoDB → Tables → GitHubLambdaDeployerStack-DeploymentsTable*
3. **CloudWatch Logs**: AWS Console → CloudWatch → Log Groups → Filter: "GitHubLambdaDeployer"
4. **API Gateway**: AWS Console → API Gateway → DeployerApi*
5. **Bedrock Model Access**: AWS Console → Bedrock → Model Access

## Getting Help

If you're stuck, collect this information:

1. **Session ID** from the initial API response
2. **Status endpoint output**: `curl https://.../status/<session-id>`
3. **Recent CloudWatch logs** from the relevant component
4. **ECS task status** if the task exists
5. **Error message** from DynamoDB or logs

Then you have everything you need to troubleshoot!
