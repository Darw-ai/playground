# Complete Project Overview & Onboarding Guide

**AI-Powered SDLC Deployment System**

Version: 1.0.0
Last Updated: November 2025
Technology Stack: TypeScript, AWS CDK, ECS Fargate, Lambda, DynamoDB, AWS Bedrock

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Project Goals & Intent](#project-goals--intent)
3. [Architecture Overview](#architecture-overview)
4. [System Components](#system-components)
5. [API Documentation](#api-documentation)
6. [Infrastructure Details](#infrastructure-details)
7. [Development Setup](#development-setup)
8. [Usage Guide](#usage-guide)
9. [Maintenance & Operations](#maintenance--operations)
10. [Troubleshooting](#troubleshooting)
11. [Security Considerations](#security-considerations)
12. [Future Enhancements](#future-enhancements)

---

## Executive Summary

This system is an **automated Software Development Lifecycle (SDLC) deployment platform** that:

1. **Deploys** any public GitHub repository containing Infrastructure-as-Code (IaC)
2. **Tests** deployed applications with AI-generated sanity tests
3. **Fixes** deployment failures automatically using AI
4. **Reports** comprehensive results with detailed logs

**Key Differentiators:**
- Fully automated end-to-end deployment pipeline
- AI-powered API discovery and test generation (AWS Bedrock Nova Pro)
- Self-healing capabilities with automatic fix generation
- Support for multiple IaC frameworks (SAM, CDK, Terraform, CloudFormation, Serverless)
- No timeout limitations (ECS Fargate for long-running operations)

---

## Project Goals & Intent

### Primary Objectives

1. **Automated Deployment**: Deploy any IaC-based project from GitHub without manual intervention
2. **Quality Assurance**: Automatically discover APIs and generate comprehensive happy-flow tests
3. **Self-Healing**: Detect deployment failures and automatically generate fixes
4. **Developer Experience**: Provide a simple REST API for deployment operations
5. **Observability**: Detailed logging and status tracking for every operation

### Use Cases

- **CI/CD Integration**: Automate deployment pipelines for multiple projects
- **Testing Automation**: Generate and run sanity tests for deployed APIs
- **Development Acceleration**: Deploy and test branches quickly without manual setup
- **Learning Platform**: Understand IaC best practices through automated analysis

### Non-Goals

- This is NOT a production deployment system (no authentication, monitoring, or SLAs)
- Does NOT support private repositories (requires GitHub credentials)
- Does NOT replace comprehensive testing suites (focuses on happy-flow sanity tests)
- Does NOT manage production infrastructure (designed for dev/test environments)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────────────────────────┐
│      API Gateway (REST API)         │
│  /deploy, /sdlc-deploy, /status,   │
│  /sanity-test, /fix, /analyze      │
└──────────┬──────────────────────────┘
           │
           ▼
    ┌──────────────┐
    │ API Handler  │◄────────────┐
    │   Lambda     │             │
    └──────┬───────┘             │
           │                     │
           ├─────────────────────┴──────┐
           │                            │
           ▼                            ▼
    ┌────────────┐              ┌─────────────┐
    │  DynamoDB  │              │ ECS Cluster │
    │   Table    │              │  (Fargate)  │
    └────────────┘              └──────┬──────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
            ┌───────────────┐  ┌──────────────┐  ┌──────────────┐
            │ SDLC Manager  │  │   Deployer   │  │    Fixer     │
            │  Container    │  │  Container   │  │  Container   │
            └───────┬───────┘  └──────┬───────┘  └──────┬───────┘
                    │                  │                  │
                    │         ┌────────┴────────┐         │
                    │         │                 │         │
                    ▼         ▼                 ▼         ▼
            ┌──────────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐
            │Sanity Tester │  │ GitHub  │  │   AWS   │  │  Bedrock │
            │  Container   │  │  Repos  │  │Services │  │   AI     │
            └──────────────┘  └─────────┘  └─────────┘  └──────────┘
```

### Data Flow

#### 1. SDLC Deployment Flow (Full Automation)

```
Client → API Gateway → API Handler Lambda
                         ↓
                    [Create DynamoDB Record]
                         ↓
                    [Start SDLC Manager ECS Task]
                         ↓
        ┌────────────────┴────────────────┐
        │     SDLC Manager Loop           │
        │                                  │
        │  1. Deploy (via Deployer)       │
        │  2. Check Status (Poll)         │
        │  3. On Success: Run Tests       │
        │  4. On Failure: Fix & Retry     │
        └─────────────────────────────────┘
```

#### 2. Deployer Flow

```
Clone GitHub Repo → Detect IaC Type → Execute Deployment
                                          ↓
                    ┌─────────────────────┴──────────────────────┐
                    │                                             │
         [SAM/CloudFormation]              [CDK/Terraform/Serverless]
                    │                                             │
                aws sam deploy                    cdk deploy / terraform apply
                    │                                             │
                    └─────────────────────┬─────────────────────┘
                                          ↓
                              [Extract Stack Outputs]
                                          ↓
                              [Update DynamoDB with Results]
```

#### 3. Sanity Tester Flow

```
Clone Repo → Inspect Code → Discover APIs (Bedrock AI)
                                    ↓
                          Generate Tests (Bedrock AI)
                                    ↓
                           Execute Tests (HTTP Requests)
                                    ↓
                           Store Results in DynamoDB
```

#### 4. Fixer Flow

```
Clone Repo → Analyze Code → Create Fix Plan (Bedrock AI)
                                    ↓
                           Implement Fix (Bedrock AI)
                                    ↓
                           Create Branch → Commit → Push
                                    ↓
                           Return Deployment Job
```

---

## System Components

### 1. API Handler Lambda

**Location**: `lambdas/api-handler/`

**Purpose**: Entry point for all API requests. Validates inputs, creates DynamoDB records, and triggers ECS tasks.

**Endpoints**:
- `POST /deploy` - Deploy a repository
- `POST /sdlc-deploy` - Full SDLC workflow
- `POST /sanity-test` - Run sanity tests
- `POST /fix` - Fix code issues
- `POST /analyze` - Analyze deployment status
- `GET /status/{sessionId}` - Get status
- `GET /deployments` - List deployments

**Key Files**:
- `index.ts` - Request handlers and validation logic
- `package.json` - Dependencies (@aws-sdk/*, uuid)

**Environment Variables**:
- `DEPLOYMENTS_TABLE` - DynamoDB table name
- `ECS_CLUSTER_ARN` - ECS cluster ARN
- `ECS_TASK_DEFINITION_ARN` - Task definition ARN for deployer
- `FIXER_TASK_DEFINITION_ARN` - Task definition ARN for fixer
- `SDLC_MANAGER_TASK_DEFINITION_ARN` - Task definition ARN for SDLC manager
- `SANITY_TESTER_TASK_DEFINITION_ARN` - Task definition ARN for sanity tester
- `ECS_SUBNETS` - Comma-separated subnet IDs
- `ECS_SECURITY_GROUP` - Security group ID
- `API_BASE_URL` - API Gateway base URL

### 2. Status Analyzer Lambda

**Location**: `lambdas/status-analyzer/`

**Purpose**: Analyzes deployment results, identifies errors, and provides fix recommendations.

**Functionality**:
- Queries CloudFormation stack events
- Categorizes errors (IAM, resource limits, syntax, etc.)
- Generates actionable fix instructions
- Provides code examples and documentation links

**Key Files**:
- `index.ts` - Analysis logic
- `README.md` - Detailed documentation

**Environment Variables**:
- `DEPLOYMENTS_TABLE` - DynamoDB table name

### 3. Deployer Container (ECS Fargate)

**Location**: `deployer-container/`

**Purpose**: Clones repositories and deploys infrastructure using various IaC tools.

**Supported IaC Types**:
1. **AWS SAM** - `template.yaml` with `Transform: AWS::Serverless`
2. **CloudFormation** - `cloudformation.yaml`, `stack.yaml`, or `template.yaml`
3. **AWS CDK** - `cdk.json`
4. **Terraform** - `*.tf` files
5. **Serverless Framework** - `serverless.yml`
6. **Simple Lambda** - `index.js/ts` + `package.json`

**Key Files**:
- `index.ts` - Main deployment orchestration
- `Dockerfile` - Container image with AWS CLI, SAM CLI, CDK, Terraform, Serverless
- `package.json` - Dependencies

**Installed Tools** (in Docker image):
- AWS CLI
- SAM CLI
- AWS CDK
- Terraform 1.7.5
- Serverless Framework 3.x
- Node.js 18+
- Git

**Process**:
1. Clone repository from GitHub
2. Detect IaC type by scanning for marker files
3. Execute appropriate deployment tool
4. Extract outputs from deployed stack
5. Update DynamoDB with results

**Environment Variables**:
- `SESSION_ID` - Unique deployment session ID
- `REPOSITORY` - GitHub repository URL
- `BRANCH` - Branch to deploy
- `PROJECT_ROOT` - Optional subdirectory within repo
- `DEPLOYMENTS_TABLE` - DynamoDB table name
- `ARTIFACTS_BUCKET` - S3 bucket for artifacts
- `AWS_ACCOUNT_ID` - AWS account ID
- `AWS_REGION` - AWS region

### 4. SDLC Manager Container (ECS Fargate)

**Location**: `sdlc-manager-container/`

**Purpose**: Orchestrates the complete SDLC workflow with automatic retry and fix loops.

**Workflow**:
```
Loop (max 15 minutes):
  1. Deploy via Deployer
  2. Poll Status Analyzer (5 attempts, 502 retry logic)
  3. If deployment succeeds:
     - Run Sanity Tests
     - If tests pass: Success, exit
     - If tests fail: Continue to fix
  4. If deployment fails:
     - Trigger Fixer
     - Wait for fix completion
     - If fix succeeds: Retry deployment with new branch
     - If fix fails: Exit with failure
```

**Key Features**:
- Automatic retry with fixes
- Timeout management (15 minutes)
- Comprehensive logging to DynamoDB
- Session tracking with attempt numbers

**Key Files**:
- `index.ts` - Orchestration logic
- `package.json` - Dependencies (axios, DynamoDB SDK)

**Environment Variables**:
- `SESSION_ID` - Unique SDLC session ID
- `REPOSITORY` - GitHub repository URL
- `BRANCH` - Initial branch
- `CUSTOM_ROOT_FOLDER` - Optional subdirectory
- `API_BASE_URL` - API Gateway base URL
- `DEPLOYMENTS_TABLE` - DynamoDB table name

### 5. Sanity Tester Container (ECS Fargate)

**Location**: `sanity-tester-container/`

**Purpose**: Automatically discovers APIs, generates tests, and executes them.

**Components**:

#### a. API Inspector (`api-inspector.ts`)
- Scans codebase for API-related files
- Looks for Express, Fastify, Lambda handlers, OpenAPI specs
- Generates repository context for AI

#### b. AI Client (`ai-client.ts`)
- `discoverAPIs()` - Uses Bedrock to identify all endpoints
- `generateSanityTests()` - Creates realistic happy-flow test scenarios

#### c. Test Executor (`test-executor.ts`)
- Executes HTTP requests sequentially
- Supports variable substitution (`${userId}`)
- Validates status codes and responses
- Stores variables from responses for later steps

**Test Structure**:
```typescript
{
  name: "User Management Flow",
  description: "Tests user creation, retrieval, and deletion",
  steps: [
    {
      action: "Create new user",
      endpoint: "/users",
      method: "POST",
      body: { name: "Test User", email: "test@example.com" },
      expectedStatus: 201,
      storeVariables: { userId: "response.id" }
    },
    {
      action: "Retrieve created user",
      endpoint: "/users/${userId}",
      method: "GET",
      expectedStatus: 200
    }
  ]
}
```

**Key Files**:
- `index.ts` - Main orchestrator
- `ai-client.ts` - Bedrock AI integration
- `api-inspector.ts` - Code scanner
- `test-executor.ts` - HTTP test runner
- `README.md` - Detailed documentation

**Environment Variables**:
- `SESSION_ID` - Unique test session ID
- `REPOSITORY` - GitHub repository URL
- `BRANCH` - Branch to test
- `CUSTOM_ROOT_FOLDER` - Optional subdirectory
- `STACK_DETAILS` - JSON with deployment info (must include API URL)
- `DEPLOYMENTS_TABLE` - DynamoDB table name

### 6. Fixer Container (ECS Fargate)

**Location**: `fixer-container/`

**Purpose**: AI-powered automatic code fixing.

**Process**:
1. Clone repository
2. Analyze codebase structure
3. Create fix plan using Bedrock AI (summary, steps, files to modify)
4. Implement fix using Bedrock AI (generates new file contents)
5. Create new branch `fix/{sessionId}`
6. Commit and push changes
7. Return deployment job with new branch

**AI Operations**:

#### a. Create Fix Plan
```typescript
Input: {
  fixInstructions: "Fix authentication bug",
  repositoryContext: "File structure and relevant code",
  stackDetails: { /* optional */ }
}

Output: {
  summary: "Fix authentication bug in login handler",
  steps: ["Update validateUser", "Add error handling"],
  filesToModify: ["src/auth/login.ts"]
}
```

#### b. Implement Fix
```typescript
Input: {
  fixInstructions: "Fix authentication bug",
  fixPlan: { /* plan from above */ },
  fileContents: Map<filePath, currentContent>
}

Output: Map<filePath, newContent>
```

**Key Files**:
- `index.ts` - Main orchestrator
- `ai-client.ts` - Bedrock AI integration
- `README.md` - Detailed documentation

**Environment Variables**:
- `SESSION_ID` - Unique fix session ID
- `REPOSITORY` - GitHub repository URL
- `BRANCH` - Branch to fix
- `CUSTOM_ROOT_FOLDER` - Optional subdirectory
- `FIX_INSTRUCTIONS` - What to fix
- `STACK_DETAILS` - JSON with optional stack info
- `DEPLOYMENTS_TABLE` - DynamoDB table name

### 7. AWS Bedrock AI Integration

**Model**: Amazon Nova Pro (`amazon.nova-pro-v1:0`)

**API**: Bedrock Converse API

**Configuration**:
- Temperature: 0.7
- Max Tokens: 4096 (fix plan), 8192 (fix implementation, tests)

**IAM Permissions Required**:
```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream"
  ],
  "Resource": "arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0"
}
```

**Setup Requirement**: Amazon Nova Pro must be enabled in AWS Bedrock console for the deployment region.

---

## API Documentation

### Base URL

After deployment, you'll receive an API endpoint:
```
https://{api-id}.execute-api.{region}.amazonaws.com/prod/
```

### Authentication

**Current**: None (public API)
**Production**: Add API Gateway API keys or Cognito authentication

### Common Response Structure

All endpoints return JSON with this structure:
```json
{
  "sessionId": "string",
  "status": "pending|deploying|testing|fixing|success|failed",
  "message": "string",
  "repository": "string",
  "branch": "string",
  "logs": ["log1", "log2"],
  "error": "string (if failed)",
  "lastUpdated": "ISO 8601 timestamp"
}
```

---

### POST /deploy

Deploy a repository using the Deployer module.

**Request**:
```json
{
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "projectRoot": "optional/subdirectory"
}
```

**Response** (202 Accepted):
```json
{
  "sessionId": "abc123",
  "status": "pending",
  "message": "Deployment initiated successfully",
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "projectRoot": "optional/subdirectory"
}
```

**Validation**:
- `repository` must match `https://github.com/[user]/[repo]`
- `branch` is required
- `projectRoot` must be relative path (no `..` or absolute paths)

**Example**:
```bash
curl -X POST https://api-endpoint/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/aws-samples/serverless-patterns",
    "branch": "main",
    "projectRoot": "lambda-eventbridge"
  }'
```

---

### POST /sdlc-deploy

Full SDLC workflow: deploy → check status → run tests → (fix & retry if needed).

**Request**:
```json
{
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "customRootFolder": "optional/subdirectory"
}
```

**Response** (202 Accepted):
```json
{
  "sessionId": "sdlc-abc123",
  "status": "pending",
  "message": "SDLC deployment workflow initiated successfully",
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "customRootFolder": "optional/subdirectory"
}
```

**Progress Tracking**: Use `GET /status/{sessionId}` to monitor progress.

**Example**:
```bash
curl -X POST https://api-endpoint/sdlc-deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/aws-samples/serverless-patterns",
    "branch": "main"
  }'
```

---

### POST /sanity-test

Run automated sanity tests on a deployed application.

**Request**:
```json
{
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "customRootFolder": "optional/subdirectory",
  "stackDetails": {
    "apiUrl": "https://deployed-api.example.com",
    "region": "us-east-1"
  }
}
```

**Response** (202 Accepted):
```json
{
  "sessionId": "sanity-abc123",
  "status": "pending",
  "message": "Sanity test initiated successfully",
  "repository": "https://github.com/username/repo",
  "branch": "main"
}
```

**Required**: `stackDetails` must contain an API endpoint URL (keys: `apiUrl`, `baseUrl`, `endpoint`, etc.)

**Example**:
```bash
curl -X POST https://api-endpoint/sanity-test \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/user/api-repo",
    "branch": "main",
    "stackDetails": {"apiUrl": "https://api.example.com"}
  }'
```

---

### POST /fix

Trigger AI-powered code fixing.

**Request**:
```json
{
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "customRootFolder": "optional/subdirectory",
  "fixInstructions": "Fix the authentication bug in user login",
  "stackDetails": {
    "optional": "context"
  }
}
```

**Response** (202 Accepted):
```json
{
  "sessionId": "fixer-abc123",
  "status": "pending",
  "message": "Fix initiated successfully",
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "fixInstructions": "Fix the authentication bug in user login"
}
```

**Output**: Creates a new branch `fix/fixer-{sessionId}` with the fix.

**Example**:
```bash
curl -X POST https://api-endpoint/fix \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/user/repo",
    "branch": "main",
    "fixInstructions": "Fix IAM permissions error in deployment"
  }'
```

---

### POST /analyze

Analyze a deployment session and get detailed error analysis.

**Request**: URL parameter only

**Response**:
```json
{
  "sessionId": "abc123",
  "status": "failed",
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "analysisTimestamp": "2025-11-09T00:00:00Z",
  "deploymentDuration": 45.2,
  "rootCause": "IAM permission denied",
  "summary": "Deployment failed after 45.2 seconds. Found 2 error(s)...",
  "errors": [
    {
      "type": "IAM_PERMISSION",
      "severity": "critical",
      "message": "IAM permission denied",
      "relatedLogs": ["AccessDenied: User not authorized..."]
    }
  ],
  "fixInstructions": [
    {
      "step": 1,
      "category": "IAM Permissions",
      "action": "Grant required IAM permissions",
      "details": "The deployment failed due to insufficient IAM permissions...",
      "codeExample": "{\n  \"Version\": \"2012-10-17\",\n  ...\n}",
      "documentation": "https://docs.aws.amazon.com/IAM/..."
    }
  ]
}
```

**Example**:
```bash
curl -X POST https://api-endpoint/analyze/abc123
```

---

### GET /status/{sessionId}

Get the current status of any session.

**Response**:
```json
{
  "sessionId": "abc123",
  "status": "success",
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "projectRoot": "optional/subdirectory",
  "message": "Deployment completed successfully",
  "logs": [
    "Deployment initiated",
    "Cloning repository...",
    "Detected IaC type: sam",
    "Deploying SAM stack...",
    "Deployment completed successfully"
  ],
  "deployedResources": {
    "stackName": "sam-deploy-abc123",
    "outputs": {
      "ApiUrl": "https://abc.execute-api.us-east-1.amazonaws.com/"
    }
  },
  "error": null,
  "lastUpdated": "2025-11-09T00:00:00Z"
}
```

**Example**:
```bash
curl https://api-endpoint/status/abc123
```

---

### GET /deployments

List recent deployments.

**Query Parameters**:
- `limit` (optional): Number of results (default: 20, max: 100)
- `status` (optional): Filter by status (pending|deploying|success|failed)

**Response**:
```json
{
  "deployments": [
    {
      "sessionId": "abc123",
      "status": "success",
      "repository": "https://github.com/username/repo",
      "branch": "main",
      "message": "Deployment completed successfully",
      "lastUpdated": "2025-11-09T00:00:00Z"
    }
  ],
  "count": 1
}
```

**Example**:
```bash
curl "https://api-endpoint/deployments?status=success&limit=10"
```

---

## Infrastructure Details

### AWS Resources Created

| Resource | Type | Purpose | Cost Impact |
|----------|------|---------|-------------|
| API Gateway | REST API | Entry point for all requests | Minimal (pay per request) |
| Lambda (API Handler) | Function | Request validation and orchestration | Minimal (pay per invocation) |
| Lambda (Status Analyzer) | Function | Deployment analysis | Minimal (pay per invocation) |
| ECS Cluster | Fargate | Container orchestration | None (cluster is free) |
| ECS Task Definitions | 4 tasks | Container specifications | None |
| DynamoDB Table | NoSQL DB | Session and log storage | Minimal (on-demand pricing) |
| S3 Bucket | Object Storage | Artifact storage | Minimal (auto-cleanup after 7 days) |
| VPC | Networking | Isolated network | ~$30/month (NAT Gateway) |
| CloudWatch Logs | Logging | Centralized logging | Minimal |
| ECR Repositories | Container Registry | Docker images | Minimal |

### Resource Naming Convention

All resources are prefixed with `GitHubLambdaDeployerStack-`:

```
GitHubLambdaDeployerStack-DeployerCluster-{id}
GitHubLambdaDeployerStack-DeploymentsTable-{id}
GitHubLambdaDeployerStack-ArtifactsBucket-{id}
```

### IAM Permissions

#### Deployer Task Role
```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "lambda:*",
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:GetRole",
        "s3:PutObject",
        "s3:GetObject",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "bedrock:InvokeModel"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Fixer/Sanity Tester Task Role
```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "bedrock:InvokeModel"
      ],
      "Resource": "*"
    }
  ]
}
```

### Network Architecture

```
VPC (10.0.0.0/16)
├── Public Subnet 1 (10.0.1.0/24) - AZ 1
│   └── NAT Gateway
├── Public Subnet 2 (10.0.2.0/24) - AZ 2
│   └── NAT Gateway
├── Private Subnet 1 (10.0.11.0/24) - AZ 1
│   └── ECS Tasks
└── Private Subnet 2 (10.0.12.0/24) - AZ 2
    └── ECS Tasks
```

---

## Development Setup

### Prerequisites

1. **AWS Account** with admin permissions
2. **AWS CLI** configured (`aws configure`)
3. **Node.js 18+** and npm
4. **Docker** (for building container images)
5. **AWS CDK CLI**: `npm install -g aws-cdk`
6. **Git**

### Initial Setup

```bash
# 1. Clone the repository
git clone <repository-url>
cd playground

# 2. Install all dependencies
npm run setup

# This runs:
# - cd cdk && npm install
# - cd lambdas/api-handler && npm install
# - cd lambdas/status-analyzer && npm install
# - cd deployer-container && npm install
# - cd fixer-container && npm install
# - cd sanity-tester-container && npm install
# - cd sdlc-manager-container && npm install
# And builds all TypeScript code

# 3. Bootstrap CDK (first time only)
cd cdk
npx cdk bootstrap
cd ..

# 4. Enable Amazon Nova Pro in Bedrock
# Go to AWS Console → Bedrock → Model Access
# Enable "Amazon Nova Pro" for your region
# Wait 2-3 minutes for activation

# 5. Deploy infrastructure
npm run deploy

# Save the API endpoint from the output:
# Outputs:
# GitHubLambdaDeployerStack.ApiEndpoint = https://abc123.execute-api.us-east-1.amazonaws.com/prod/
```

### Project Structure

```
playground/
├── cdk/                          # Infrastructure as Code
│   ├── bin/app.ts               # CDK app entry point
│   ├── lib/deployer-stack.ts    # Main stack definition
│   ├── package.json
│   └── tsconfig.json
│
├── lambdas/                      # Lambda functions
│   ├── api-handler/             # API Gateway handler
│   │   ├── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── status-analyzer/         # Deployment analyzer
│       ├── index.ts
│       ├── package.json
│       ├── README.md
│       └── tsconfig.json
│
├── deployer-container/           # ECS Fargate deployer
│   ├── Dockerfile
│   ├── index.ts
│   ├── package.json
│   └── tsconfig.json
│
├── sdlc-manager-container/       # SDLC orchestrator
│   ├── index.ts
│   ├── package.json
│   └── tsconfig.json
│
├── fixer-container/              # AI-powered fixer
│   ├── Dockerfile
│   ├── index.ts
│   ├── ai-client.ts
│   ├── package.json
│   ├── README.md
│   └── tsconfig.json
│
├── sanity-tester-container/      # Automated testing
│   ├── Dockerfile
│   ├── index.ts
│   ├── ai-client.ts
│   ├── api-inspector.ts
│   ├── test-executor.ts
│   ├── package.json
│   ├── README.md
│   └── tsconfig.json
│
├── examples/                     # Example projects
│   ├── simple-lambda/
│   └── cloudformation-lambda/
│
├── package.json                  # Root workspace
├── README.md
├── ARCHITECTURE.md
├── TROUBLESHOOTING.md
└── COMPLETE-OVERVIEW.md
```

### Building & Testing

```bash
# Build all components
npm run build:all

# Build individual components
cd lambdas/api-handler && npm run build
cd deployer-container && npm run build
cd fixer-container && npm run build
cd sanity-tester-container && npm run build
cd sdlc-manager-container && npm run build
cd cdk && npm run build

# Deploy infrastructure changes
npm run deploy

# Preview infrastructure changes
cd cdk && npx cdk diff

# Destroy all infrastructure
npm run destroy
```

### Local Development Tips

1. **Test Lambda functions locally**:
```bash
cd lambdas/api-handler
npm run build
# Set environment variables
export DEPLOYMENTS_TABLE=test-table
# Run tests
```

2. **Build Docker images locally**:
```bash
cd deployer-container
docker build -t deployer:test .
docker run -it deployer:test /bin/bash
```

3. **Test individual modules**:
Use the provided PowerShell scripts:
```powershell
# Monitor SDLC deployment
.\test-deployment.ps1 -Repository "https://github.com/user/repo" -Branch "main"

# Troubleshoot specific session
.\troubleshoot.ps1 -SessionId "sdlc-abc123"

# List all running tasks
.\troubleshoot.ps1 -ListAllTasks
```

### Environment Variables Reference

Create a `.env` file (DO NOT COMMIT) for local testing:

```env
# DynamoDB
DEPLOYMENTS_TABLE=GitHubLambdaDeployerStack-DeploymentsTable-XXXXX

# ECS
ECS_CLUSTER_ARN=arn:aws:ecs:us-east-1:ACCOUNT:cluster/CLUSTER_NAME
ECS_TASK_DEFINITION_ARN=arn:aws:ecs:us-east-1:ACCOUNT:task-definition/TASK:VERSION

# S3
ARTIFACTS_BUCKET=githublambdadeployerstack-artifactsbucket-XXXXX

# AWS
AWS_ACCOUNT_ID=123456789012
AWS_REGION=us-east-1

# API
API_BASE_URL=https://abc123.execute-api.us-east-1.amazonaws.com/prod

# Session-specific (set by ECS task overrides)
SESSION_ID=test-session-123
REPOSITORY=https://github.com/user/repo
BRANCH=main
```

---

## Usage Guide

### Basic Deployment

```bash
# 1. Deploy a repository
curl -X POST https://api-endpoint/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/aws-samples/serverless-patterns",
    "branch": "main",
    "projectRoot": "lambda-eventbridge"
  }'

# Response: {"sessionId": "abc123", "status": "pending", ...}

# 2. Monitor progress
curl https://api-endpoint/status/abc123

# 3. View detailed logs
curl https://api-endpoint/status/abc123 | jq '.logs'
```

### Full SDLC Workflow

```powershell
# Use the monitoring script
.\test-deployment.ps1 `
  -Repository "https://github.com/aws-samples/serverless-patterns" `
  -Branch "main" `
  -CustomRoot "lambda-eventbridge"

# This will:
# 1. Initiate SDLC deployment
# 2. Show real-time progress
# 3. Display final results
```

### Running Sanity Tests Only

```bash
# 1. Deploy your application first
curl -X POST https://api-endpoint/deploy \
  -H "Content-Type: application/json" \
  -d '{"repository": "...", "branch": "main"}'

# 2. Wait for deployment to complete
# Check: curl https://api-endpoint/status/{sessionId}

# 3. Extract deployed API URL from deployedResources
# Then run sanity tests:
curl -X POST https://api-endpoint/sanity-test \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/user/repo",
    "branch": "main",
    "stackDetails": {
      "apiUrl": "https://deployed-api.execute-api.us-east-1.amazonaws.com"
    }
  }'
```

### Fixing Failed Deployments

```bash
# 1. Check deployment failure
curl https://api-endpoint/status/{failed-session-id}

# 2. Analyze the failure
curl https://api-endpoint/analyze/{failed-session-id}

# 3. Trigger automatic fix
curl -X POST https://api-endpoint/fix \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/user/repo",
    "branch": "main",
    "fixInstructions": "Fix IAM permissions error shown in deployment logs"
  }'

# 4. Monitor fix progress
curl https://api-endpoint/status/fixer-{session-id}

# 5. Deploy the fixed code
# The fix creates a new branch: fix/fixer-{session-id}
curl -X POST https://api-endpoint/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/user/repo",
    "branch": "fix/fixer-{session-id}"
  }'
```

---

## Maintenance & Operations

### Monitoring

#### CloudWatch Logs

All logs are in CloudWatch Log Groups:

```bash
# API Handler Lambda
aws logs tail /aws/lambda/GitHubLambdaDeployerStack-ApiHandlerLambda* --follow

# Status Analyzer Lambda
aws logs tail /aws/lambda/GitHubLambdaDeployerStack-StatusAnalyzerLambda* --follow

# ECS Containers (find log streams first)
aws logs describe-log-streams \
  --log-group-name "GitHubLambdaDeployerStack-DeployerTaskDef*" \
  --order-by LastEventTime --descending

# Then tail specific stream
aws logs tail "GitHubLambdaDeployerStack-DeployerTaskDef*" \
  --log-stream-names "deployer/DeployerContainer/{task-id}" \
  --follow
```

#### DynamoDB Queries

```bash
# List recent deployments
aws dynamodb scan \
  --table-name GitHubLambdaDeployerStack-DeploymentsTable-* \
  --limit 10

# Query specific session
aws dynamodb query \
  --table-name GitHubLambdaDeployerStack-DeploymentsTable-* \
  --key-condition-expression "sessionId = :sid" \
  --expression-attribute-values '{":sid":{"S":"abc123"}}'
```

#### ECS Task Monitoring

```bash
# List running tasks
aws ecs list-tasks \
  --cluster GitHubLambdaDeployerStack-DeployerCluster-*

# Describe task details
aws ecs describe-tasks \
  --cluster GitHubLambdaDeployerStack-DeployerCluster-* \
  --tasks {task-arn}

# Check task failures
aws ecs describe-tasks \
  --cluster GitHubLambdaDeployerStack-DeployerCluster-* \
  --tasks {task-arn} \
  --query "tasks[0].containers[0].{status:lastStatus,exitCode:exitCode,reason:reason}"
```

### Updating the System

```bash
# 1. Make code changes
# Edit files in lambdas/, deployer-container/, etc.

# 2. Build updated code
npm run build:all

# 3. Preview changes
cd cdk && npx cdk diff

# 4. Deploy changes
npm run deploy

# Note: CDK will update only changed resources
# Docker images are rebuilt and pushed automatically
```

### Updating CDK Infrastructure

```bash
# 1. Edit cdk/lib/deployer-stack.ts

# 2. Build CDK code
cd cdk && npm run build

# 3. Preview changes
npx cdk diff

# 4. Deploy
npx cdk deploy --require-approval never
```

### Cleaning Up Resources

```bash
# Delete all infrastructure
npm run destroy

# Or manually:
cd cdk && npx cdk destroy

# Clean up deployed stacks (created by deployments)
# These are NOT automatically deleted
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE
aws cloudformation delete-stack --stack-name {stack-name}

# Clean up Docker images
aws ecr list-images --repository-name cdk-*
aws ecr batch-delete-image --repository-name cdk-* --image-ids imageDigest={digest}
```

### Cost Management

**Monthly Cost Estimate** (with moderate usage):

| Resource | Estimated Cost |
|----------|---------------|
| NAT Gateway | $30-40 |
| ECS Fargate (transient) | $5-10 (pay per second) |
| Lambda | $1-5 (first 1M requests free) |
| DynamoDB | $1-5 (on-demand) |
| S3 | $1-2 |
| CloudWatch Logs | $1-2 |
| API Gateway | $1-3 |
| **Total** | **$40-70/month** |

**Cost Optimization**:
1. Delete NAT Gateway when not in use (requires infrastructure update)
2. Use DynamoDB Time-to-Live (TTL) for old sessions
3. Set S3 lifecycle policies for artifacts (already configured: 7 days)
4. Enable CloudWatch Logs retention (already configured: 1 week)

---

## Troubleshooting

### Common Issues

#### Issue 1: Container Stuck in PENDING

**Symptoms**:
- ECS task shows "PENDING" status
- No logs in CloudWatch

**Causes**:
1. ECR image pull failure
2. VPC/subnet configuration
3. Resource limits

**Solution**:
```bash
# Check task details
aws ecs describe-tasks \
  --cluster {cluster-name} \
  --tasks {task-arn} \
  --query "tasks[0].containers[0].reason"

# Common fixes:
# - Ensure ECR image exists and is accessible
# - Check security group allows outbound traffic
# - Verify subnets have NAT Gateway access
```

#### Issue 2: Status Analyzer Lambda Timeout (502)

**Symptoms**:
- SDLC Manager logs show "Error polling status: 502"
- Deployment succeeds but SDLC workflow fails

**Root Cause**:
- Status Analyzer Lambda times out querying CloudFormation
- CloudFormation operations take longer than Lambda timeout

**Solution**:
1. **Check underlying deployment**:
```bash
# SDLC session failed, but check the deployment session
curl https://api-endpoint/status/{deployment-session-id}
# If status is "success", the deployment actually worked
```

2. **Increase Lambda timeout** (in `cdk/lib/deployer-stack.ts`):
```typescript
timeout: cdk.Duration.minutes(5), // Increase from default
```

3. **Add retry logic** (already implemented in SDLC Manager)

#### Issue 3: Bedrock Access Denied

**Symptoms**:
- Error: "Access Denied" when calling Bedrock
- AI features fail

**Solution**:
```bash
# 1. Enable model in Bedrock console
# AWS Console → Bedrock → Model Access
# Enable "Amazon Nova Pro" for us-east-1

# 2. Wait 2-3 minutes for propagation

# 3. Verify IAM permissions
aws iam get-policy --policy-arn {task-role-policy-arn}

# Should include:
# - bedrock:InvokeModel
# - bedrock:InvokeModelWithResponseStream
```

#### Issue 4: Deployment Fails - Unsupported IaC Type

**Symptoms**:
- Error: "Unsupported IaC type: unknown"
- Deployer fails immediately

**Cause**:
- Repository doesn't contain recognized IaC files
- Project root specified incorrectly

**Solution**:
```bash
# Check repository structure
git clone {repository}
cd {repository}/{project-root}
ls -la

# Should contain one of:
# - template.yaml (SAM)
# - cdk.json (CDK)
# - serverless.yml (Serverless)
# - *.tf (Terraform)
# - cloudformation.yaml (CloudFormation)
# - index.js + package.json (Simple Lambda)
```

### Debugging Tools

#### PowerShell Troubleshooting Script

```powershell
# Show all running tasks
.\troubleshoot.ps1 -ListAllTasks

# Debug specific session with CloudWatch logs
.\troubleshoot.ps1 -SessionId "abc123" -ShowCloudWatchLogs

# Check ECS task status
aws ecs describe-tasks \
  --cluster {cluster} \
  --tasks {task-arn} \
  --query "tasks[0].{status:lastStatus,cpu:cpu,memory:memory,containers:containers[*].{name:name,status:lastStatus,exitCode:exitCode}}"
```

#### Manual Log Inspection

```bash
# 1. Find log group
aws logs describe-log-groups \
  --query "logGroups[?contains(logGroupName, 'GitHubLambdaDeployer')].logGroupName"

# 2. Find recent log streams
aws logs describe-log-streams \
  --log-group-name {log-group} \
  --order-by LastEventTime \
  --descending \
  --max-items 5

# 3. Read logs
aws logs get-log-events \
  --log-group-name {log-group} \
  --log-stream-name {log-stream} \
  --limit 100
```

### Getting Help

If stuck, collect this information:

1. **Session ID** from API response
2. **Status output**: `curl https://api-endpoint/status/{sessionId}`
3. **CloudWatch logs** from relevant component
4. **ECS task details** (if applicable)
5. **Error message** from logs or DynamoDB

Then review:
- `TROUBLESHOOTING.md` for detailed troubleshooting steps
- CloudWatch Logs for error stack traces
- DynamoDB `logs` field for deployment progress

---

## Security Considerations

### Current Security Posture

⚠️ **NOT PRODUCTION-READY**

Current implementation is **proof-of-concept only**:

1. **No Authentication**: API is publicly accessible
2. **No Authorization**: Anyone can deploy to your AWS account
3. **No Rate Limiting**: Vulnerable to abuse
4. **No Input Sanitization**: Limited validation
5. **No Secrets Management**: AI API keys should be in Secrets Manager
6. **No VPC Endpoints**: Containers use public internet

### Production Security Checklist

Before using in production:

- [ ] Add API Gateway API Keys or Cognito authentication
- [ ] Implement IAM-based authorization
- [ ] Add rate limiting and throttling
- [ ] Store Bedrock credentials in AWS Secrets Manager
- [ ] Use VPC endpoints for AWS services (no internet access)
- [ ] Enable CloudTrail for audit logging
- [ ] Add WAF rules for API Gateway
- [ ] Implement input validation and sanitization
- [ ] Use AWS KMS for encryption at rest
- [ ] Set up VPC Flow Logs
- [ ] Enable GuardDuty for threat detection
- [ ] Implement least-privilege IAM policies
- [ ] Add resource tagging for cost allocation
- [ ] Set up budget alerts

### Recommended Security Hardening

```typescript
// 1. Add API Key authentication
const apiKey = api.addApiKey('DeployerApiKey');
const plan = api.addUsagePlan('DeployerUsagePlan', {
  throttle: { rateLimit: 10, burstLimit: 20 }
});
plan.addApiKey(apiKey);

// 2. Use Secrets Manager for Bedrock credentials
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

const bedrockCredentials = secretsmanager.Secret.fromSecretNameV2(
  this, 'BedrockCredentials', 'bedrock-credentials'
);

// In task definition:
secrets: {
  BEDROCK_ACCESS_KEY_ID: ecs.Secret.fromSecretsManager(bedrockCredentials, 'accessKeyId'),
  BEDROCK_SECRET_ACCESS_KEY: ecs.Secret.fromSecretsManager(bedrockCredentials, 'secretAccessKey')
}

// 3. Add input validation
function validateRepository(repo: string): boolean {
  const pattern = /^https:\/\/github\.com\/[\w-]+\/[\w-]+$/;
  return pattern.test(repo) && !repo.includes('..');
}

// 4. Enable CloudTrail
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';

new cloudtrail.Trail(this, 'DeployerTrail', {
  enableFileValidation: true,
  includeGlobalServiceEvents: true
});
```

---

## Future Enhancements

### Planned Features

#### Phase 1: Security & Stability
- [ ] API authentication (API Keys)
- [ ] Rate limiting
- [ ] Secrets Manager integration
- [ ] VPC endpoints
- [ ] CloudTrail logging
- [ ] Enhanced error handling

#### Phase 2: Features
- [ ] Private repository support (GitHub tokens)
- [ ] Pull request creation from fixer
- [ ] Multi-region support
- [ ] Custom test frameworks (Jest, Mocha)
- [ ] Slack/email notifications
- [ ] Deployment approval workflow

#### Phase 3: AI Enhancements
- [ ] Support for other AI models (Claude, GPT-4)
- [ ] Custom prompts for test generation
- [ ] Incremental fixes with feedback loops
- [ ] Security vulnerability scanning
- [ ] Performance optimization suggestions

#### Phase 4: Enterprise Features
- [ ] Multi-tenancy
- [ ] RBAC (Role-Based Access Control)
- [ ] Deployment scheduling
- [ ] Blue/green deployments
- [ ] Canary deployments
- [ ] Rollback capabilities
- [ ] Cost tracking per deployment
- [ ] Compliance reporting

### Contributing

To contribute:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Make changes and test**:
```bash
npm run build:all
npm run deploy
# Test your changes
```
4. **Commit with clear messages**: `git commit -m "Add: feature description"`
5. **Push and create PR**: `git push origin feature/my-feature`

### Roadmap

**Q1 2026**: Security hardening and production readiness
**Q2 2026**: Private repository support and PR automation
**Q3 2026**: Multi-region and advanced deployment strategies
**Q4 2026**: Enterprise features and compliance

---

## Appendix

### Glossary

- **IaC (Infrastructure as Code)**: Declarative configuration files for infrastructure
- **SAM (Serverless Application Model)**: AWS framework for serverless applications
- **ECS Fargate**: Serverless container execution service
- **Bedrock**: AWS managed AI service with foundation models
- **Sanity Test**: Basic happy-flow tests to verify core functionality
- **SDLC**: Software Development Lifecycle

### Additional Resources

- **AWS CDK Documentation**: https://docs.aws.amazon.com/cdk/
- **AWS Bedrock**: https://docs.aws.amazon.com/bedrock/
- **ECS Fargate**: https://docs.aws.amazon.com/AmazonECS/latest/userguide/what-is-fargate.html
- **SAM CLI**: https://docs.aws.amazon.com/serverless-application-model/
- **Terraform**: https://www.terraform.io/docs

### Support

- **GitHub Issues**: https://github.com/{org}/{repo}/issues
- **Documentation**: See TROUBLESHOOTING.md for detailed guides
- **CloudWatch Logs**: Primary source of debugging information

---

## Quick Reference

### Essential Commands

```bash
# Deploy infrastructure
npm run deploy

# Update infrastructure
cd cdk && npx cdk deploy

# Destroy everything
npm run destroy

# Monitor deployment
curl https://api-endpoint/status/{sessionId}

# List deployments
curl https://api-endpoint/deployments

# View logs
aws logs tail {log-group} --follow
```

### Important URLs

After deployment, save these from CDK output:

```
API Endpoint: https://{api-id}.execute-api.{region}.amazonaws.com/prod/
ECS Cluster: GitHubLambdaDeployerStack-DeployerCluster-{id}
DynamoDB Table: GitHubLambdaDeployerStack-DeploymentsTable-{id}
S3 Bucket: githublambdadeployerstack-artifactsbucket-{id}
```

### Support Matrix

| IaC Type | Status | Notes |
|----------|--------|-------|
| AWS SAM | ✅ Fully Supported | Best tested |
| CloudFormation | ✅ Fully Supported | |
| AWS CDK | ✅ Fully Supported | Requires `cdk.json` |
| Terraform | ✅ Fully Supported | Uses S3 backend |
| Serverless | ✅ Fully Supported | Framework v3 |
| Simple Lambda | ✅ Fully Supported | Basic Node.js functions |

---

**Document Version**: 1.0.0
**Last Updated**: November 2025
**Maintained By**: Development Team

For questions or issues, please refer to TROUBLESHOOTING.md or create a GitHub issue.
