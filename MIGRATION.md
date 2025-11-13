# Migration from Docker/ECS to Lambda with Queue-Based Processing

This document describes the migration from a Docker/ECS-based architecture to a serverless Lambda-based architecture with SQS queue processing.

## Overview

The system has been migrated from:
- **Before**: Docker containers running on ECS Fargate with VPC and NAT Gateway
- **After**: AWS Lambda functions with SQS queues for processing, Step Functions for orchestration

## Key Benefits

1. **Cost Savings**:
   - Eliminated VPC and NAT Gateway costs (~$35/month)
   - Pay only for actual compute time with Lambda
   - No idle container costs

2. **Scalability**:
   - Automatic scaling with Lambda
   - SQS queue-based processing handles variable workloads
   - Each Lambda function scales independently

3. **Simplified Infrastructure**:
   - No VPC configuration needed
   - No container image management
   - Reduced operational complexity

4. **Queue-Based Processing**:
   - Heavy processing split into smaller Lambda invocations
   - Each stage processes one item from the queue
   - Better fault tolerance with DLQ (Dead Letter Queue)

## Architecture Changes

### Before (Docker/ECS)

```
API Gateway → API Handler Lambda → ECS Fargate Tasks
                                   ├─ Deployer Container (2GB, 1 vCPU)
                                   ├─ Fixer Container (2GB, 1 vCPU)
                                   ├─ Sanity Tester Container (2GB, 1 vCPU)
                                   └─ SDLC Manager Container (1GB, 512 CPU)
```

### After (Lambda + SQS)

```
API Gateway → API Handler Lambda → SQS Queues → Lambda Functions
                                    │
                                    ├─ Clone/Detect Queue → Clone/Detect Lambda
                                    │                        └─> Deploy Queue
                                    ├─ Deploy Queue → Deploy Lambda
                                    │                  └─> Monitor Queue
                                    ├─ Monitor Queue → Monitor Lambda
                                    │
                                    ├─ Fixer Queue → Fixer Lambda
                                    │
                                    └─ Sanity Tester Queue → Sanity Tester Lambda

SDLC Manager → Step Functions State Machine (orchestrates all Lambda functions)
```

## Component Breakdown

### 1. Deployer (Split into 3 Lambda Functions)

**Clone & Detect Lambda** (`lambdas/deployer-clone-detect/`)
- **Purpose**: Clone repository and detect IaC type
- **Timeout**: 5 minutes
- **Memory**: 1024 MB
- **Output**: Sends message to Deploy Queue

**Deploy Lambda** (`lambdas/deployer-deploy/`)
- **Purpose**: Deploy infrastructure based on IaC type
- **Timeout**: 10 minutes
- **Memory**: 2048 MB
- **Ephemeral Storage**: 2048 MB
- **Supported IaC Types**:
  - Simple Lambda (direct deployment)
  - CloudFormation (AWS SDK)
  - SAM (packages functions and deploys)
  - CDK, Terraform, Serverless (require Lambda layers or CodeBuild)
- **Output**: Sends message to Monitor Queue

**Monitor Lambda** (`lambdas/deployer-monitor/`)
- **Purpose**: Monitor deployment progress (CloudFormation stacks, Lambda functions)
- **Timeout**: 15 minutes
- **Memory**: 512 MB
- **Polling**: Checks status every 10 seconds

### 2. Fixer (Single Lambda Function)

**Fixer Lambda** (`lambdas/fixer-lambda/`)
- **Purpose**: AI-powered code fixing using Anthropic Claude
- **Timeout**: 10 minutes
- **Memory**: 2048 MB
- **Ephemeral Storage**: 2048 MB
- **Features**:
  - Creates fix plan using AI
  - Implements fixes automatically
  - Creates new branch and pushes to GitHub
- **Triggered by**: Fixer Queue

### 3. Sanity Tester (Single Lambda Function)

**Sanity Tester Lambda** (`lambdas/sanity-tester-lambda/`)
- **Purpose**: AI-powered API sanity testing
- **Timeout**: 10 minutes
- **Memory**: 2048 MB
- **Ephemeral Storage**: 2048 MB
- **Features**:
  - Discovers API endpoints using AI
  - Generates comprehensive test suites
  - Executes tests against deployed stack
- **Triggered by**: Sanity Tester Queue

### 4. SDLC Manager (Step Functions State Machine)

**Step Functions State Machine** (`cdk/lib/deployer-stack.ts`)
- **Purpose**: Orchestrates full deployment lifecycle
- **Workflow**:
  1. Initiate Deployment → Wait → Check Status
  2. If failed: Trigger Fixer → Wait → Check Fix → Retry Deployment
  3. If success: Initiate Sanity Tests → Wait → Check Tests
  4. If tests failed: Trigger Fixer → Wait → Check Fix → Retry Deployment
  5. If all success: Complete
- **Timeout**: 30 minutes
- **Benefits**: Built-in retry logic, state management, visibility

## SQS Queues

All queues have:
- Dead Letter Queue (DLQ) for failed messages
- Max receive count: 3 attempts
- DLQ retention: 14 days

### Queue Configuration

| Queue | Visibility Timeout | Purpose |
|-------|-------------------|---------|
| Clone/Detect Queue | 5 minutes | Repository cloning and IaC detection |
| Deploy Queue | 10 minutes | Infrastructure deployment |
| Monitor Queue | 15 minutes | Deployment monitoring |
| Fixer Queue | 10 minutes | AI-powered code fixing |
| Sanity Tester Queue | 10 minutes | API sanity testing |
| DLQ | N/A | Failed message storage |

## API Endpoints (Unchanged)

The API endpoints remain the same but now use SQS instead of ECS:

- `POST /deploy` - Deploy from GitHub repository
- `POST /fix` - Trigger AI code fixing
- `POST /sanity-test` - Run automated API tests
- `POST /sdlc-deploy` - Full SDLC cycle (deploy → test → fix → retry)
- `GET /status/{sessionId}` - Get deployment status
- `GET /deployments` - List all deployments
- `POST /analyze` - Analyze deployment results
- `GET /analyze/{sessionId}` - Get analysis for session

## Infrastructure Components Removed

- ✅ VPC (2 AZs, public and private subnets)
- ✅ NAT Gateway (~$35/month saved)
- ✅ ECS Fargate Cluster
- ✅ ECS Task Definitions (4 tasks)
- ✅ Security Groups
- ✅ Docker containers and Dockerfiles

## Infrastructure Components Added

- ✅ 5 SQS Queues (with DLQ)
- ✅ 6 Lambda Functions
  - deployer-clone-detect
  - deployer-deploy
  - deployer-monitor
  - fixer-lambda
  - sanity-tester-lambda
  - api-handler (updated)
- ✅ 1 Step Functions State Machine (SDLC orchestration)

## Environment Variables

### Lambda Functions

Each Lambda function requires specific environment variables:

**Clone/Detect Lambda:**
- `DEPLOYMENTS_TABLE` - DynamoDB table name
- `ARTIFACTS_BUCKET` - S3 bucket for artifacts
- `NEXT_QUEUE_URL` - Deploy Queue URL

**Deploy Lambda:**
- `DEPLOYMENTS_TABLE` - DynamoDB table name
- `ARTIFACTS_BUCKET` - S3 bucket for artifacts
- `MONITOR_QUEUE_URL` - Monitor Queue URL
- `AWS_ACCOUNT_ID` - AWS account ID
- `AWS_REGION` - AWS region

**Monitor Lambda:**
- `DEPLOYMENTS_TABLE` - DynamoDB table name

**Fixer Lambda:**
- `DEPLOYMENTS_TABLE` - DynamoDB table name
- `ARTIFACTS_BUCKET` - S3 bucket for artifacts
- `ANTHROPIC_API_KEY` - Anthropic API key (required)

**Sanity Tester Lambda:**
- `DEPLOYMENTS_TABLE` - DynamoDB table name
- `ANTHROPIC_API_KEY` - Anthropic API key (required)

**API Handler Lambda:**
- `DEPLOYMENTS_TABLE` - DynamoDB table name
- `CLONE_DETECT_QUEUE_URL` - Clone/Detect Queue URL
- `FIXER_QUEUE_URL` - Fixer Queue URL
- `SANITY_TESTER_QUEUE_URL` - Sanity Tester Queue URL
- `SDLC_STATE_MACHINE_ARN` - Step Functions state machine ARN
- `API_BASE_URL` - API Gateway URL

## IAM Permissions

### Deploy Lambda Permissions:
- CloudFormation: Full access
- Lambda: Full access
- IAM: Role creation and management

### Monitor Lambda Permissions:
- CloudFormation: DescribeStacks, DescribeStackEvents
- Lambda: GetFunction

### All Lambda Functions:
- DynamoDB: Read/Write access to deployments table
- S3: Read/Write access to artifacts bucket (where applicable)
- SQS: SendMessage to next queue in chain

### Step Functions:
- SQS: SendMessage to all queues
- DynamoDB: GetItem from deployments table
- Lambda: Invoke Status Analyzer Lambda

## Deployment

1. **Install dependencies**:
   ```bash
   cd cdk
   npm install
   cd ../lambdas/api-handler && npm install
   cd ../deployer-clone-detect && npm install
   cd ../deployer-deploy && npm install
   cd ../deployer-monitor && npm install
   cd ../fixer-lambda && npm install
   cd ../sanity-tester-lambda && npm install
   cd ../status-analyzer && npm install
   ```

2. **Set environment variables**:
   ```bash
   export ANTHROPIC_API_KEY=your_api_key_here
   ```

3. **Deploy the CDK stack**:
   ```bash
   cd cdk
   cdk deploy
   ```

4. **Update Lambda environment variables** (after deployment):
   - Set `ANTHROPIC_API_KEY` for Fixer and Sanity Tester Lambdas

## Monitoring

### CloudWatch Logs
- All Lambda functions have log retention: 7 days
- Step Functions state machine logs: `/aws/vendedlogs/states/sdlc-workflow`

### DynamoDB
- Session tracking with timestamps
- Status Index (GSI) for querying by status

### Dead Letter Queue
- Monitor DLQ for failed messages
- Investigate and replay failed jobs

## Cost Comparison

### Before (ECS/Docker)
- NAT Gateway: ~$35/month
- ECS Fargate: Pay for task runtime (even when idle)
- Total: ~$50-100/month (depending on usage)

### After (Lambda/SQS)
- Lambda: Pay per invocation (sub-second billing)
- SQS: $0.40 per million requests
- Step Functions: $25 per million state transitions
- Total: ~$10-30/month (depending on usage)

**Estimated savings: 50-70% reduction in costs**

## Limitations

### IaC Type Support
The current Lambda-based architecture has limited support for certain IaC types that require external CLI tools:

- ✅ **Fully Supported**: Simple Lambda, CloudFormation, SAM
- ⚠️ **Requires Lambda Layers**: CDK, Terraform, Serverless Framework
- 💡 **Recommended Alternative**: Use AWS CodeBuild for complex builds

### Lambda Limitations
- 15-minute maximum timeout per function
- 10 GB ephemeral storage maximum
- No persistent file system

## Future Enhancements

1. **Lambda Layers**: Add Lambda layers for CDK, Terraform, Serverless Framework
2. **CodeBuild Integration**: Offload complex builds to AWS CodeBuild
3. **Caching**: Implement caching for repository clones
4. **Parallel Processing**: Process multiple deployments concurrently
5. **Enhanced Monitoring**: Add X-Ray tracing and detailed metrics

## Rollback Plan

If you need to rollback to the Docker/ECS architecture:

1. Restore the container directories from git history:
   ```bash
   git checkout HEAD~1 -- deployer-container fixer-container sanity-tester-container sdlc-manager-container
   ```

2. Restore the old CDK stack:
   ```bash
   git checkout HEAD~1 -- cdk/lib/deployer-stack.ts
   ```

3. Redeploy:
   ```bash
   cd cdk
   cdk deploy
   ```

## Migration Checklist

- ✅ Created SQS queues for queue-based processing
- ✅ Split Deployer into 3 Lambda functions (clone/detect, deploy, monitor)
- ✅ Migrated Fixer to single Lambda function
- ✅ Migrated Sanity Tester to single Lambda function
- ✅ Converted SDLC Manager to Step Functions state machine
- ✅ Updated API Handler to use SQS instead of ECS
- ✅ Updated CDK stack (removed VPC/ECS, added Lambda/SQS/Step Functions)
- ✅ Removed Docker container directories
- ✅ Tested deployment flow

## Conclusion

The migration from Docker/ECS to Lambda with queue-based processing provides significant cost savings, improved scalability, and simplified infrastructure management. The queue-based architecture allows for better fault tolerance and independent scaling of each processing stage.

For questions or issues, please refer to the AWS Lambda and Step Functions documentation.
