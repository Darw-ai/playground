# GitHub Lambda Deployer API

An AWS infrastructure-as-code application that deploys Lambda functions from GitHub repositories.

## Architecture

This application provides an API that:
1. Accepts a GitHub public repository URL and branch name
2. Generates a unique session ID for the deployment
3. Clones the repository and deploys the Lambda infrastructure
4. Adds a session ID suffix to deployed resources for isolation
5. Logs all deployment progress and errors

### Components

- **API Gateway**: REST API endpoint for deployment requests
- **API Handler Lambda**: Validates requests, generates session IDs, triggers deployments
- **Status Analyzer Lambda**: Analyzes deployment outputs and generates fix instructions
- **Deployer (ECS Fargate)**: Containerized deployer that clones repos, parses IaC, and deploys to AWS
- **DynamoDB**: Stores deployment sessions and logs
- **S3 Bucket**: Temporary storage for cloned repositories and deployment artifacts
- **VPC**: Networking for ECS Fargate tasks
- **ECS Cluster**: Manages Fargate tasks
- **CloudWatch Logs**: Centralized logging

**Why Fargate?**
- No 15-minute timeout limit (deployments can run as long as needed)
- More resources (2GB RAM, 1 vCPU)
- Better isolation
- Pay only for actual usage time

## Prerequisites

- AWS Account with appropriate permissions (CloudFormation, Lambda, API Gateway, DynamoDB, S3, IAM, ECS, VPC)
- AWS CLI configured with credentials
- Node.js 18+ and npm
- AWS CDK CLI (`npm install -g aws-cdk`)
- Docker (for building container images)
- Git (for example repositories)

## Project Structure

```
.
├── cdk/                          # Infrastructure as Code (AWS CDK)
│   ├── bin/
│   │   └── app.ts               # CDK app entry point
│   ├── lib/
│   │   └── deployer-stack.ts    # Main infrastructure stack
│   ├── cdk.json
│   ├── package.json
│   └── tsconfig.json
├── lambdas/                      # Lambda function code
│   ├── api-handler/             # Handles API requests
│   │   ├── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── status-analyzer/         # Analyzes deployment outputs
│       ├── index.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
├── deployer-container/           # ECS Fargate deployer
│   ├── Dockerfile
│   ├── index.ts
│   ├── package.json
│   └── tsconfig.json
├── examples/                     # Example Lambda projects
│   ├── simple-lambda/
│   └── cloudformation-lambda/
├── package.json                  # Workspace scripts
├── ARCHITECTURE.md               # Detailed architecture docs
└── README.md
```

## Quick Start

### 1. Install all dependencies

```bash
npm run setup
```

This will install dependencies for all projects (CDK infrastructure and Lambda functions) and build them.

### 2. Bootstrap CDK (first time only)

```bash
cd cdk
npx cdk bootstrap
cd ..
```

### 3. Deploy the infrastructure

```bash
npm run deploy
```

The deployment will output the API endpoint URL. Save this URL for making API requests.

Example output:
```
Outputs:
GitHubLambdaDeployerStack.ApiEndpoint = https://abc123.execute-api.us-east-1.amazonaws.com/prod/
```

## Usage

### Deploy a Lambda from GitHub

```bash
curl -X POST https://<API_ID>.execute-api.<REGION>.amazonaws.com/prod/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/username/repo-name",
    "branch": "main"
  }'
```

Response:
```json
{
  "sessionId": "uuid-here",
  "status": "deploying",
  "message": "Deployment initiated"
}
```

### Check deployment status

```bash
curl https://<API_ID>.execute-api.<REGION>.amazonaws.com/prod/status/<SESSION_ID>
```

Response:
```json
{
  "sessionId": "uuid-here",
  "status": "success|failed|deploying",
  "logs": ["log message 1", "log message 2"],
  "deployedResources": {
    "functionName": "my-function-uuid",
    "functionArn": "arn:aws:lambda:..."
  }
}
```

### Analyze deployment and get fix instructions

```bash
curl https://<API_ID>.execute-api.<REGION>.amazonaws.com/prod/analyze/<SESSION_ID>
```

Response:
```json
{
  "sessionId": "uuid-here",
  "status": "failed",
  "repository": "https://github.com/username/repo-name",
  "branch": "main",
  "analysisTimestamp": "2024-01-15T10:30:00Z",
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

For more details on the Status Analyzer, see [lambdas/status-analyzer/README.md](lambdas/status-analyzer/README.md).

## Repository Requirements

The GitHub repository must contain infrastructure-as-code for a Lambda function. Supported formats:

1. **AWS SAM** (`template.yaml` or `template.yml`) - Fully supported
2. **CloudFormation** (`cloudformation.yaml` or `stack.yaml`) - Fully supported
3. **Simple Lambda** (`package.json` + `index.js`) - Fully supported
4. **CDK** (`cdk.json`) - Coming soon
5. **Terraform** (`main.tf`) - Coming soon

The deployer will automatically detect the IaC type and deploy accordingly, adding the session ID as a suffix to resource names.

## Example Projects

The `examples/` directory contains sample Lambda projects you can use to test the deployer:

1. **simple-lambda**: Basic Lambda function (direct deployment)
2. **cloudformation-lambda**: Lambda with API Gateway using SAM template

To test:
1. Push an example to your GitHub repository
2. Deploy using the API (see Usage section)

## Security Considerations

- The API is public but should be protected with API keys or Cognito authentication in production
- Deployer Lambda has limited permissions scoped to Lambda and CloudFormation operations
- Temporary files are cleaned up after deployment
- All deployments are isolated by session ID

## Cleanup

To remove all infrastructure:

```bash
npm run destroy
```

Or manually:

```bash
cd cdk
npx cdk destroy
```

**Note**:
- Deployed Lambda functions and CloudFormation stacks are NOT automatically cleaned up
- You may need to manually delete them from the AWS Console
- S3 artifacts are auto-deleted after 7 days
- DynamoDB entries persist (change `removalPolicy` to RETAIN in production)

## Development

### Building

```bash
# Build all Lambda functions
npm run build:all

# Build individual components
cd lambdas/api-handler && npm run build
cd lambdas/deployer && npm run build
cd cdk && npm run build
```

### Updating Infrastructure

After making changes to CDK code:

```bash
cd cdk
npm run build
npx cdk diff    # Preview changes
npx cdk deploy  # Apply changes
```

## Troubleshooting

### Deployment fails with timeout
- Check CloudWatch logs for the deployer Lambda
- Increase timeout in `cdk/lib/deployer-stack.ts` (max 15 minutes)

### IAM permissions errors
- Ensure deployer role has necessary permissions
- Check CloudFormation stack events for details

### Repository not found
- Verify repository URL is public
- Check repository URL format (https://github.com/user/repo)

### Lambda deployment fails
- Check DynamoDB logs via `/status/{sessionId}` endpoint
- Verify repository contains valid IaC files
- Check CloudWatch logs for detailed error messages

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation and diagrams.

## License

MIT
