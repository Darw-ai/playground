# Architecture

## Overview

The GitHub Lambda Deployer is a serverless application that provides two main functionalities:
1. **Automated Deployment**: Deploys Lambda functions from GitHub repositories
2. **Sanity Testing**: Generates and runs sanity tests on deployed stacks

## Architecture Diagram

```
┌─────────────────┐
│   GitHub Repo   │
│  (Public Repo)  │
└────────┬────────┘
         │
         │ 1. API Request
         ▼
┌─────────────────────────────────────────────────────────┐
│                     API Gateway                         │
│  - POST /deploy                                         │
│  - GET /status/{sessionId}                              │
│  - GET /deployments                                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ 2. Invoke
                     ▼
         ┌──────────────────────┐
         │  API Handler Lambda  │
         │  - Validate request  │
         │  - Generate session  │
         │  - Return 202        │
         └──────┬───────────────┘
                │
      ┌─────────┼─────────┐
      │         │         │
      │ 3a.Save │         │ 3b. Async Invoke
      ▼         │         ▼
┌──────────┐    │   ┌──────────────────┐
│ DynamoDB │◄───┘   │ Deployer Lambda  │
│  Table   │◄───────┤  - Clone repo    │
│          │ 4.Log  │  - Detect IaC    │
│Sessions/ │        │  - Deploy infra  │
│ Logs     │        │  - Update logs   │
└──────────┘        └────────┬─────────┘
                             │
                    ┌────────┼────────┐
                    │        │        │
              5a.Upload│   5b.Deploy │
                    ▼        │        ▼
            ┌─────────┐      │  ┌──────────────┐
            │   S3    │      │  │CloudFormation│
            │ Bucket  │      │  │    Stack     │
            │         │      │  │              │
            │Artifacts│      │  └──────┬───────┘
            └─────────┘      │         │
                             │         │ 6. Create
                             │         ▼
                             │  ┌──────────────┐
                             └─►│ User Lambda  │
                                │  + IAM Role  │
                                │  + API GW    │
                                └──────────────┘
```

## Components

### 1. API Gateway
- **Purpose**: HTTP REST API endpoint
- **Endpoints**:
  - `POST /deploy` - Initiate deployment
  - `GET /status/{sessionId}` - Check deployment status
  - `GET /deployments` - List all deployments
  - `POST /test` - Initiate sanity test generation
  - `GET /test-status/{sessionId}` - Check test status and results
- **Security**: CORS enabled, optionally API keys

### 2. API Handler Lambda
- **Runtime**: Node.js 20.x
- **Purpose**: Handle API requests and coordinate deployments and tests
- **Responsibilities**:
  - Validate repository URLs
  - Generate unique session IDs
  - Invoke deployer and test generator ECS tasks asynchronously
  - Query deployment and test status from DynamoDB
  - Return deployment and test information

### 3. Deployer (ECS Fargate)
- **Runtime**: Node.js 20.x (containerized)
- **Memory**: 2048 MB
- **CPU**: 1024 (1 vCPU)
- **No timeout limit**: Runs as long as needed
- **Purpose**: Clone repos and deploy infrastructure
- **Responsibilities**:
  - Clone GitHub repository using simple-git
  - Detect infrastructure-as-code type (SAM, CloudFormation, simple Lambda)
  - Package and upload code to S3
  - Create CloudFormation stacks or Lambda functions
  - Monitor deployment progress
  - Log all operations to DynamoDB
  - Clean up temporary files

### 4. Test Generator (ECS Fargate)
- **Runtime**: Node.js 20.x (containerized)
- **Memory**: 2048 MB
- **CPU**: 1024 (1 vCPU)
- **No timeout limit**: Runs as long as needed
- **Purpose**: Generate and execute sanity tests for deployed stacks
- **Responsibilities**:
  - Clone GitHub repository at specified commit using simple-git
  - Discover deployed resources from CloudFormation stack or Lambda function name
  - Generate appropriate sanity tests based on resource types:
    - **Lambda Functions**: Test invocation with sample payload
    - **API Gateway Endpoints**: HTTP GET/POST requests
    - **S3 Buckets**: Check accessibility and list objects
    - **IAM Roles**: Skip (not directly testable)
  - Execute all generated tests
  - Collect test results (pass/fail/skip status, duration, error messages)
  - Log all operations and results to DynamoDB
  - Clean up temporary files

### 5. DynamoDB Table
- **Purpose**: Store deployment and test sessions with logs
- **Schema**:
  - Partition Key: `sessionId` (String)
  - Sort Key: `timestamp` (Number)
  - Attributes:
    - For deployments: status, repository, branch, logs, deployedResources, error
    - For tests: status, repository, branch, commit, stackName, functionName, logs, testResults, error
- **GSI**: StatusIndex (status + timestamp) for querying by status
- **Features**: Point-in-time recovery, streams enabled

### 6. S3 Bucket
- **Purpose**: Store deployment artifacts
- **Contents**:
  - Cloned repository code
  - Lambda deployment packages (ZIP files)
  - Build artifacts
- **Lifecycle**: Auto-delete after 7 days
- **Security**: Private, encrypted, versioned

### 7. IAM Roles
- **API Handler Role**:
  - Basic Lambda execution
  - DynamoDB read/write
  - Run ECS tasks (deployer and test generator)
  - Pass roles to ECS tasks

- **ECS Task Role** (shared by deployer and test generator):
  - CloudFormation operations (for deployer and test resource discovery)
  - Lambda operations (create, invoke, get function details)
  - API Gateway operations (for test resource discovery)
  - S3 operations (for deployer artifacts and test bucket checks)
  - IAM role creation (for deployed Lambdas)
  - DynamoDB read/write

## Deployment Flow

1. **User Request**: POST to `/deploy` with repository URL and branch
2. **Validation**: API Handler validates input and generates session ID
3. **Async Execution**: Deployer ECS task is started asynchronously (returns 202 immediately)
4. **Clone**: Deployer clones the GitHub repository to `/tmp`
5. **Detection**: Automatically detects IaC type (SAM, CloudFormation, simple Lambda)
6. **Package**: Creates ZIP file of code if needed
7. **Upload**: Uploads artifacts to S3
8. **Deploy**:
   - For SAM/CloudFormation: Creates CloudFormation stack
   - For simple Lambda: Creates Lambda function + IAM role directly
9. **Monitor**: Polls CloudFormation for completion
10. **Logging**: All steps logged to DynamoDB with timestamps
11. **Cleanup**: Removes temporary files from `/tmp`
12. **Status**: User queries `/status/{sessionId}` to get results

## Test Generation Flow

1. **User Request**: POST to `/test` with repository URL, branch, commit, and stack/function details
2. **Validation**: API Handler validates input and generates test session ID
3. **Async Execution**: Test Generator ECS task is started asynchronously (returns 202 immediately)
4. **Clone**: Test Generator clones the GitHub repository to `/tmp` at specified commit
5. **Resource Discovery**:
   - If stackName provided: Queries CloudFormation for stack resources and outputs
   - If functionName provided: Queries Lambda for function details
   - Identifies testable resources (Lambda, API Gateway, S3, etc.)
6. **Test Generation**: Creates appropriate tests for each resource type:
   - **Lambda**: Invoke with test payload
   - **API Gateway**: HTTP GET request to endpoint
   - **S3**: Check bucket accessibility
   - **IAM**: Skip (not testable)
7. **Test Execution**: Runs all generated tests in sequence
8. **Result Collection**: Captures test status (pass/fail/skip), duration, and error messages
9. **Logging**: All steps and test results logged to DynamoDB with timestamps
10. **Cleanup**: Removes temporary files from `/tmp`
11. **Status**: User queries `/test-status/{sessionId}` to get test results

## Supported IaC Types

### 1. AWS SAM
- **Detection**: `template.yaml` with `Transform: AWS::Serverless`
- **Deployment**: CloudFormation with SAM transform

### 2. CloudFormation
- **Detection**: `template.yaml`, `cloudformation.yaml`, or `stack.yaml`
- **Deployment**: CloudFormation CreateStack

### 3. Simple Lambda
- **Detection**: `package.json` + `index.js`/`handler.js`
- **Deployment**: Direct Lambda CreateFunction

### 4. Future Support (not implemented)
- AWS CDK
- Terraform

## Security Considerations

### Current Implementation
- Public API (no authentication)
- Read-only GitHub access (public repos only)
- Scoped IAM permissions
- Resource tagging for tracking
- Session ID isolation

### Production Recommendations
1. Add API Gateway authentication (API Keys or Cognito)
2. Implement rate limiting
3. Add webhook validation for GitHub
4. Restrict IAM permissions to specific resource patterns
5. Add CloudWatch alarms for failures
6. Implement cost controls (max deployments per day)
7. Add VPC configuration for Lambdas
8. Enable AWS WAF for API Gateway

## Monitoring

### CloudWatch Logs
- API Handler logs: `/aws/lambda/GitHubLambdaDeployerStack-ApiHandlerLambda*`
- Deployer logs: `/aws/lambda/GitHubLambdaDeployerStack-DeployerLambda*`

### DynamoDB Logs
- All deployment operations logged with timestamps
- Query by sessionId or status

### Metrics
- API Gateway request count
- Lambda invocations, errors, duration
- DynamoDB read/write capacity
- S3 bucket size

## Limitations

1. **Timeout**: Deployments must complete within 15 minutes
2. **Storage**: Limited to 2 GB ephemeral storage
3. **Public Repos**: Only public GitHub repositories (no auth)
4. **Concurrency**: Default Lambda concurrency limits apply
5. **CloudFormation**: Subject to CloudFormation stack limits
6. **Region**: Resources deployed in same region as deployer

## Cost Estimation

Approximate costs (us-east-1, pay-as-you-go):

- **API Gateway**: $3.50 per million requests
- **Lambda**:
  - API Handler: ~$0.20 per million requests (minimal)
  - Deployer: ~$0.05 per deployment (depends on size)
- **DynamoDB**: On-demand pricing, ~$0.01 per deployment
- **S3**: Minimal (auto-delete after 7 days)

**Estimated**: <$1 for 100 deployments
