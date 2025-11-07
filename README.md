# GitHub Lambda Deployer API

An AWS infrastructure-as-code application that deploys Lambda functions from GitHub repositories.

## Architecture

This application provides two main APIs:

### 1. Lambda Deployer API
Deploys Lambda functions from GitHub repositories:
1. Accepts a GitHub public repository URL and branch name
2. Generates a unique session ID for the deployment
3. Clones the repository and deploys the Lambda infrastructure
4. Adds a session ID suffix to deployed resources for isolation
5. Logs all deployment progress and errors

### 2. Sanity Test Generator API
Generates and runs sanity tests on deployed stacks:
1. Accepts a GitHub repository, branch, commit, and deployed stack details
2. Clones the repository at the specified commit
3. Discovers deployed resources (Lambda functions, API endpoints, S3 buckets, etc.)
4. Automatically generates appropriate sanity tests for each resource type
5. Executes the tests and reports results

### Components

- **API Gateway**: REST API endpoints for deployment and testing requests
- **API Handler Lambda**: Validates requests, generates session IDs, triggers deployments and tests
- **Deployer (ECS Fargate)**: Containerized deployer that clones repos, parses IaC, and deploys to AWS
- **Test Generator (ECS Fargate)**: Containerized test generator that clones repos, discovers resources, and runs sanity tests
- **DynamoDB**: Stores deployment sessions, test sessions, and logs
- **S3 Bucket**: Temporary storage for cloned repositories and deployment artifacts
- **VPC**: Networking for ECS Fargate tasks
- **ECS Cluster**: Manages Fargate tasks for both deployment and testing
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
│   └── api-handler/             # Handles API requests
│       ├── index.ts
│       ├── package.json
│       └── tsconfig.json
├── deployer-container/           # ECS Fargate deployer
│   ├── Dockerfile
│   ├── index.ts
│   ├── package.json
│   └── tsconfig.json
├── test-generator-container/     # ECS Fargate test generator
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

### Generate and run sanity tests

```bash
curl -X POST https://<API_ID>.execute-api.<REGION>.amazonaws.com/prod/test \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/username/repo-name",
    "branch": "main",
    "commit": "abc123def456",
    "stackName": "my-deployed-stack"
  }'
```

Or test a specific Lambda function:

```bash
curl -X POST https://<API_ID>.execute-api.<REGION>.amazonaws.com/prod/test \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/username/repo-name",
    "branch": "main",
    "functionName": "my-lambda-function"
  }'
```

Response:
```json
{
  "sessionId": "test-uuid-here",
  "status": "pending",
  "message": "Test generation initiated successfully"
}
```

### Check test status and results

```bash
curl https://<API_ID>.execute-api.<REGION>.amazonaws.com/prod/test-status/<TEST_SESSION_ID>
```

Response:
```json
{
  "sessionId": "test-uuid-here",
  "status": "completed",
  "repository": "https://github.com/username/repo-name",
  "branch": "main",
  "commit": "abc123def456",
  "testResults": [
    {
      "testName": "Lambda Function: MyFunction",
      "status": "pass",
      "message": "Function invoked successfully",
      "duration": 1234
    },
    {
      "testName": "API Endpoint: MyApi",
      "status": "pass",
      "message": "Endpoint responded with status 200",
      "duration": 567
    }
  ],
  "logs": ["Starting test generation...", "Found 2 resources to test..."]
}
```

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
