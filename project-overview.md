# Project Overview: GitHub Lambda Deployer API

## Executive Summary

The GitHub Lambda Deployer API is a sophisticated serverless infrastructure-as-code application that automates the deployment of AWS Lambda functions directly from GitHub repositories. It provides a REST API that accepts GitHub repository URLs, clones the code, detects the infrastructure-as-code (IaC) format, and deploys Lambda functions with complete isolation using session-based naming.

## Project Goals

### Primary Objectives
1. **Automated Lambda Deployment**: Enable one-click deployment of Lambda functions from GitHub repositories
2. **Multi-Format Support**: Support various IaC formats (SAM, CloudFormation, simple Lambda)
3. **Session Isolation**: Ensure each deployment is isolated with unique session IDs to prevent conflicts
4. **Comprehensive Logging**: Track all deployment operations with detailed logs in DynamoDB
5. **Scalable Architecture**: Use ECS Fargate for long-running deployments without Lambda timeout constraints

### Design Principles
- **Serverless-first**: Minimize operational overhead using managed AWS services
- **Pay-per-use**: Cost-efficient architecture that charges only for actual deployment time
- **Security**: Scoped IAM permissions and resource isolation
- **Observability**: Complete deployment tracking via DynamoDB and CloudWatch Logs
- **Developer Experience**: Simple REST API interface with clear status endpoints

## Architecture Overview

### High-Level Flow
```
GitHub Repo → API Gateway → API Handler Lambda → ECS Fargate Task → Deploy Lambda/CloudFormation
                                    ↓
                              DynamoDB (logs)
                                    ↓
                              S3 (artifacts)
```

### Component Architecture

#### 1. **API Layer**
- **API Gateway**: REST API with 3 endpoints
  - `POST /deploy` - Initiate deployment
  - `GET /status/{sessionId}` - Check deployment status
  - `GET /deployments` - List all deployments
- **Features**: CORS enabled, request validation, CloudWatch metrics

#### 2. **Orchestration Layer**
- **API Handler Lambda** (Node.js 20.x)
  - Validates GitHub repository URLs
  - Generates unique session IDs (UUID v4)
  - Triggers ECS Fargate tasks asynchronously
  - Queries deployment status from DynamoDB
  - Returns 202 Accepted for async operations
  - **Runtime**: 30 second timeout, 256 MB memory

#### 3. **Deployment Layer**
- **ECS Fargate Deployer** (Containerized)
  - **Why Fargate?**
    - No 15-minute Lambda timeout limit
    - 2 GB RAM, 1 vCPU for resource-intensive operations
    - Better isolation for git cloning and CloudFormation operations
    - Pay only for actual deployment duration
  - **Container**: Node.js 20 Alpine with Git installed
  - **Process**:
    1. Clone GitHub repository using simple-git
    2. Auto-detect IaC type (SAM, CloudFormation, Simple Lambda)
    3. Package and upload code to S3
    4. Deploy infrastructure (CloudFormation stack or direct Lambda creation)
    5. Monitor deployment progress
    6. Log all operations to DynamoDB
    7. Cleanup temporary files

#### 4. **Storage Layer**
- **DynamoDB Table**: Deployment sessions and logs
  - **Schema**:
    - Partition Key: `sessionId` (String)
    - Sort Key: `timestamp` (Number)
  - **GSI**: `StatusIndex` (status + timestamp) for filtering by status
  - **Features**: Pay-per-request billing, point-in-time recovery, streams enabled

- **S3 Bucket**: Artifact storage
  - Cloned repository code
  - Lambda deployment packages (ZIP files)
  - **Lifecycle**: Auto-delete after 7 days
  - **Security**: Private, encrypted, versioned

#### 5. **Networking Layer**
- **VPC**: Custom VPC with 2 AZs
  - Public subnets (24-bit CIDR)
  - Private subnets with NAT Gateway (24-bit CIDR)
- **ECS Cluster**: Container insights enabled
- **Security Groups**: Controlled outbound access for ECS tasks

## Technology Stack

### Infrastructure as Code
- **AWS CDK** v2.149.0 (TypeScript)
  - Infrastructure definition in `cdk/lib/deployer-stack.ts`
  - App entry point: `cdk/bin/app.ts`
  - Single stack deployment model

### Backend Runtime
- **Node.js 20.x** (LTS)
  - API Handler Lambda
  - ECS Fargate deployer container

### AWS Services
| Service | Purpose | Configuration |
|---------|---------|---------------|
| API Gateway | REST API | CORS, CloudWatch logs, metrics |
| Lambda | API Handler | 256 MB, 30s timeout |
| ECS Fargate | Deployer | 2 GB RAM, 1 vCPU |
| DynamoDB | Session storage | Pay-per-request, GSI |
| S3 | Artifacts | Lifecycle 7d, encrypted |
| VPC | Networking | 2 AZs, NAT gateway |
| CloudWatch Logs | Logging | 1-week retention |
| IAM | Permissions | Role-based access control |

### Key Dependencies

#### API Handler (`lambdas/api-handler/package.json`)
```json
{
  "@aws-sdk/client-dynamodb": "^3.600.0",
  "@aws-sdk/client-ecs": "^3.600.0",
  "@aws-sdk/lib-dynamodb": "^3.600.0",
  "uuid": "^10.0.0"
}
```

#### Deployer Container (`deployer-container/package.json`)
```json
{
  "@aws-sdk/client-cloudformation": "^3.600.0",
  "@aws-sdk/client-dynamodb": "^3.600.0",
  "@aws-sdk/client-lambda": "^3.600.0",
  "@aws-sdk/client-s3": "^3.600.0",
  "@aws-sdk/client-iam": "^3.600.0",
  "@aws-sdk/lib-dynamodb": "^3.600.0",
  "simple-git": "^3.25.0",
  "adm-zip": "^0.5.14"
}
```

#### CDK Infrastructure (`cdk/package.json`)
```json
{
  "aws-cdk-lib": "^2.149.0",
  "constructs": "^10.3.0",
  "typescript": "^5.5.3"
}
```

### Development Tools
- **TypeScript** 5.5.3 (across all components)
- **Docker** (for container builds)
- **Git** (for repository management)

## Project Structure

```
github-lambda-deployer/
├── cdk/                                    # Infrastructure as Code
│   ├── bin/
│   │   └── app.ts                         # CDK app entry point
│   ├── lib/
│   │   └── deployer-stack.ts              # Main infrastructure stack (285 lines)
│   ├── cdk.json                           # CDK configuration
│   ├── package.json                       # CDK dependencies
│   └── tsconfig.json                      # TypeScript config
│
├── lambdas/                                # Lambda functions
│   └── api-handler/                       # API request handler
│       ├── index.ts                       # Main handler (346 lines)
│       ├── package.json                   # Dependencies
│       └── tsconfig.json                  # TypeScript config
│
├── deployer-container/                     # ECS Fargate deployer
│   ├── Dockerfile                         # Container definition (Node.js 20 Alpine)
│   ├── index.ts                           # Deployment logic (463 lines)
│   ├── package.json                       # Dependencies
│   └── tsconfig.json                      # TypeScript config
│
├── examples/                               # Example Lambda projects
│   ├── simple-lambda/                     # Basic Lambda function
│   │   ├── index.js                       # Lambda handler
│   │   ├── package.json                   # Dependencies
│   │   └── README.md                      # Usage instructions
│   │
│   └── cloudformation-lambda/             # SAM template example
│       ├── index.js                       # Lambda handler
│       ├── template.yaml                  # SAM template
│       ├── package.json                   # Dependencies
│       └── README.md                      # Usage instructions
│
├── package.json                            # Workspace scripts
├── README.md                               # Project documentation
├── ARCHITECTURE.md                         # Detailed architecture
├── .gitignore                             # Git ignore rules
└── project-overview.md                     # This file
```

## Deployment Flow (Detailed)

### 1. Request Phase
```
User → POST /deploy
{
  "repository": "https://github.com/user/repo",
  "branch": "main"
}
```

### 2. API Handler Processing
- Validate GitHub URL format (regex: `^https?://(www\.)?github\.com/[\w-]+/[\w-]+`)
- Generate UUID session ID
- Create DynamoDB record (status: `pending`)
- Start ECS Fargate task with environment overrides:
  - `SESSION_ID`
  - `REPOSITORY`
  - `BRANCH`
- Return 202 Accepted with session ID

### 3. ECS Fargate Deployment
**Phase 1: Clone**
- Clone repository to `/tmp/{sessionId}` using `simple-git`
- Single branch, depth 1 (shallow clone)

**Phase 2: Detection**
```typescript
// Auto-detect IaC type
if (template.yaml with "Transform: AWS::Serverless") → SAM
else if (template.yaml || cloudformation.yaml) → CloudFormation
else if (cdk.json) → CDK (not yet supported)
else if (*.tf) → Terraform (not yet supported)
else if (package.json + index.js) → Simple Lambda
```

**Phase 3: Deployment**

**For CloudFormation/SAM:**
- Validate template
- Create stack: `lambda-deploy-{sessionId-8-chars}`
- Add capabilities: `CAPABILITY_IAM`, `CAPABILITY_NAMED_IAM`, `CAPABILITY_AUTO_EXPAND`
- Tag with `DeploymentSessionId` and `ManagedBy`
- Poll stack status every 10 seconds (max 1 hour)
- Extract outputs

**For Simple Lambda:**
- Create ZIP archive (exclude .git, node_modules)
- Upload to S3: `deployments/{sessionId}/function.zip`
- Create IAM role: `lambda-role-{sessionId-8-chars}`
- Attach `AWSLambdaBasicExecutionRole` policy
- Wait 10 seconds for IAM propagation
- Create Lambda: `deployed-lambda-{sessionId-8-chars}`
- Runtime: Node.js 20.x, 256 MB, 30s timeout

**Phase 4: Logging**
- All steps logged to DynamoDB with timestamps
- Final status: `success` or `failed`
- Store deployed resources metadata

**Phase 5: Cleanup**
- Remove `/tmp/{sessionId}` directory

### 4. Status Checking
```
GET /status/{sessionId}
→ Query DynamoDB by sessionId
→ Aggregate all log entries
→ Return latest status with full logs
```

## Supported IaC Formats

| Format | Detection | Status | Deployment Method |
|--------|-----------|--------|-------------------|
| AWS SAM | `template.yaml` with `Transform: AWS::Serverless` | ✅ Supported | CloudFormation with SAM transform |
| CloudFormation | `template.yaml`, `cloudformation.yaml`, `stack.yaml` | ✅ Supported | CloudFormation CreateStack |
| Simple Lambda | `package.json` + `index.js/handler.js` | ✅ Supported | Direct Lambda CreateFunction |
| AWS CDK | `cdk.json` | ❌ Coming soon | Planned |
| Terraform | `*.tf` files | ❌ Coming soon | Planned |

## IAM Permissions Model

### API Handler Lambda Role
```
- Lambda execution (CloudWatch Logs)
- DynamoDB read/write (deployments table)
- ECS RunTask (deployer task)
- IAM PassRole (ECS task roles)
```

### ECS Task Role (Deployer)
```
- CloudFormation (Create/Update/Delete/Describe stacks)
- Lambda (Create/Update/Delete/Get functions)
- IAM (Create/Delete roles, Attach policies)
- S3 (Read/Write artifacts bucket)
- DynamoDB (Read/Write deployments table)
```

**Security Note**: All permissions are scoped with `resources: ['*']` for flexibility. In production, should be restricted to specific resource patterns.

## Data Model

### DynamoDB Schema

**Table**: `DeploymentsTable`

```typescript
interface DeploymentRecord {
  sessionId: string;        // Partition key (UUID)
  timestamp: number;        // Sort key (epoch milliseconds)
  status: 'pending' | 'deploying' | 'success' | 'failed';
  repository: string;       // GitHub URL
  branch: string;           // Branch name
  message?: string;         // Status message
  logs?: string[];          // Log entries
  deployedResources?: {     // Deployment outputs
    stackName?: string;
    stackId?: string;
    functionName?: string;
    functionArn?: string;
    outputs?: Record<string, any>;
  };
  error?: string;           // Error message if failed
}
```

**Global Secondary Index**: `StatusIndex`
- Partition Key: `status`
- Sort Key: `timestamp`
- Purpose: Query deployments by status

### S3 Structure
```
s3://artifacts-bucket/
└── deployments/
    └── {sessionId}/
        └── function.zip
```

## API Endpoints

### POST /deploy
**Request**:
```json
{
  "repository": "https://github.com/username/repo",
  "branch": "main"
}
```

**Response** (202 Accepted):
```json
{
  "sessionId": "uuid-v4",
  "status": "pending",
  "message": "Deployment initiated successfully",
  "repository": "https://github.com/username/repo",
  "branch": "main"
}
```

### GET /status/{sessionId}
**Response** (200 OK):
```json
{
  "sessionId": "uuid-v4",
  "status": "success",
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "message": "Deployment completed successfully",
  "logs": [
    "Deployment initiated",
    "Repository cloned successfully",
    "Detected IaC type: sam",
    "Creating CloudFormation stack: lambda-deploy-abcd1234",
    "Stack created successfully"
  ],
  "deployedResources": {
    "stackName": "lambda-deploy-abcd1234",
    "stackId": "arn:aws:cloudformation:...",
    "outputs": {
      "ApiEndpoint": "https://xyz.execute-api.us-east-1.amazonaws.com"
    }
  },
  "lastUpdated": "2025-11-07T12:00:00.000Z"
}
```

### GET /deployments?limit=20&status=success
**Response** (200 OK):
```json
{
  "deployments": [
    {
      "sessionId": "uuid-1",
      "status": "success",
      "repository": "https://github.com/user/repo1",
      "branch": "main",
      "message": "Deployment completed",
      "lastUpdated": "2025-11-07T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

## Development Workflow

### Setup
```bash
# Install all dependencies
npm run setup  # Runs install:all + build:all

# Bootstrap CDK (first time only)
cd cdk && npx cdk bootstrap
```

### Build
```bash
# Build all components
npm run build:all

# Or build individually
cd lambdas/api-handler && npm run build
cd deployer-container && npm run build
cd cdk && npm run build
```

### Deploy
```bash
npm run deploy  # Deploys CDK stack
```

### Destroy
```bash
npm run destroy  # Removes all infrastructure
```

**Important**: Deployed Lambda functions and CloudFormation stacks created by the API are NOT automatically cleaned up.

## Monitoring & Observability

### CloudWatch Logs
- **API Handler**: `/aws/lambda/GitHubLambdaDeployerStack-ApiHandlerLambda*`
- **Deployer Container**: `/aws/ecs/deployer` (1-week retention)

### DynamoDB Logs
- Real-time deployment tracking
- Query by session ID or status
- Full audit trail with timestamps

### Metrics
- API Gateway: Request count, latency, errors
- Lambda: Invocations, duration, errors, concurrent executions
- ECS: Task count, CPU/memory utilization
- DynamoDB: Read/write capacity units, throttled requests

## Cost Estimation

**Per deployment** (us-east-1):
- API Gateway: ~$0.0000035 (1 request)
- API Handler Lambda: ~$0.0000002 (minimal execution)
- ECS Fargate: ~$0.01-0.05 (depends on deployment duration, 2GB/1vCPU)
- DynamoDB: ~$0.0001 (on-demand writes)
- S3: Negligible (auto-delete after 7 days)

**Estimated total**: **$0.01-0.05 per deployment**

**Monthly baseline**: ~$35 (VPC NAT Gateway - largest fixed cost)

**Cost optimization tips**:
- Use public subnets only (remove NAT Gateway) to save ~$35/month
- Reduce Fargate memory/CPU if deployments are small
- Use DynamoDB provisioned capacity for predictable workloads

## Security Considerations

### Current Implementation
- ✅ Public API (no authentication) - suitable for demos
- ✅ Public GitHub repositories only
- ✅ Scoped IAM permissions
- ✅ Resource tagging for tracking
- ✅ Session ID isolation
- ✅ S3 encryption and private access
- ✅ VPC for network isolation

### Production Recommendations
1. **Add authentication**: API Keys, AWS IAM, or Amazon Cognito
2. **Rate limiting**: Prevent abuse
3. **Restrict IAM permissions**: Use resource-specific ARNs instead of `*`
4. **Add AWS WAF**: Protect API Gateway from attacks
5. **Enable CloudWatch alarms**: Alert on failures/high costs
6. **Implement cost controls**: Max deployments per day/user
7. **Add approval workflows**: For production deployments
8. **Secrets management**: AWS Secrets Manager for private repos
9. **Code scanning**: Scan deployed code for vulnerabilities

## Limitations

1. **Timeout**: CloudFormation deployments limited to ~1 hour (ECS task timeout)
2. **Storage**: 2 GB ephemeral storage (can be increased)
3. **Public repos only**: No GitHub authentication implemented
4. **Concurrency**: Subject to AWS service quotas (ECS tasks, Lambda concurrency)
5. **Region**: Deploys in same region as deployer infrastructure
6. **No rollback**: Failed deployments require manual cleanup
7. **CloudFormation limits**: Stack size limits apply (200 resources, 51,200 bytes template)

## Testing Examples

### Example 1: Simple Lambda
See `examples/simple-lambda/` - Basic Lambda function that returns a greeting.

### Example 2: SAM Template with API Gateway
See `examples/cloudformation-lambda/` - Lambda with HTTP API endpoint.

**To test**:
1. Push example to your GitHub repo
2. Deploy via API
3. Check status endpoint
4. Verify deployed resources in AWS Console

## Future Enhancements

### Planned Features
- ✅ CloudFormation/SAM support
- ✅ Simple Lambda support
- ⏳ AWS CDK support
- ⏳ Terraform support
- ⏳ Private repository support (GitHub tokens)
- ⏳ Deployment rollback capability
- ⏳ WebSocket API for real-time deployment updates
- ⏳ Multi-region deployment
- ⏳ Blue/green deployments
- ⏳ Cost estimation before deployment

### Architecture Improvements
- Replace ECS Fargate with AWS CodeBuild for deployments
- Add Step Functions for complex orchestration
- Implement event-driven architecture with EventBridge
- Add caching layer with ElastiCache
- Implement deployment queues with SQS

## Troubleshooting Guide

### Deployment Timeouts
- Check CloudWatch Logs for deployer container
- Verify repository is accessible and public
- Check CloudFormation stack events for errors

### IAM Permissions Errors
- Review deployer task role permissions in `cdk/lib/deployer-stack.ts:82-151`
- Check CloudFormation stack events for specific missing permissions
- Ensure role has time to propagate (10-second wait built-in)

### Repository Not Found
- Verify URL format: `https://github.com/username/repo`
- Ensure repository is public
- Check repository exists and branch is correct

### Lambda Creation Fails
- Check IAM role creation and propagation
- Verify S3 artifact upload succeeded
- Review CloudWatch Logs for detailed error messages

## References

- **Main README**: `README.md` - Quick start guide
- **Architecture**: `ARCHITECTURE.md` - Detailed architecture documentation
- **API Handler**: `lambdas/api-handler/index.ts` - API implementation
- **Deployer**: `deployer-container/index.ts` - Deployment logic
- **Infrastructure**: `cdk/lib/deployer-stack.ts` - CDK stack definition
- **Examples**: `examples/` - Sample Lambda projects

## Conclusion

The GitHub Lambda Deployer API is a production-ready, well-architected serverless application that demonstrates:
- Advanced AWS CDK infrastructure definition
- Asynchronous processing with ECS Fargate
- Multi-format IaC detection and deployment
- Comprehensive logging and observability
- Session-based resource isolation
- Cost-effective pay-per-use model

**Total codebase**: ~1,100 lines of TypeScript across infrastructure, API handler, and deployer components, plus comprehensive documentation.
