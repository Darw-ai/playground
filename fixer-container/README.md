# Fixer Module

The Fixer module is an automated code fixing system that uses AI (Claude) to analyze, plan, and implement code fixes based on instructions.

## Overview

The fixer module follows the same async task orchestration pattern as the deployer module:

1. **API Layer**: `/fix` endpoint in the API Handler Lambda
2. **Processing Layer**: ECS Fargate task (fixer-container) for the actual work
3. **Storage**: DynamoDB for session tracking
4. **Output**: Returns deployment job details for the fixed code

## Architecture

```
Client → API Gateway → Lambda (API Handler) → DynamoDB (session record)
                                          ↓
                                     ECS Fargate Task (Fixer)
                                          ↓
        GitHub Repo Clone ← Simple-Git ← Environment Variables
                ↓
        AI Fix Planning (Claude API)
                ↓
        AI Fix Implementation
                ↓
        Create Fix Branch & Push
                ↓
        DynamoDB Logging ← Status updates
                ↓
        Return Deployment Job
```

## Input Parameters

The `/fix` endpoint accepts the following parameters:

```json
{
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "customRootFolder": "optional/path",
  "stackDetails": { "optional": "stack info" },
  "fixInstructions": "Fix the authentication bug in user login"
}
```

- **repository** (required): GitHub repository URL
- **branch** (required): Branch to branch from for the fix
- **customRootFolder** (optional): Subdirectory within the repo to work in
- **stackDetails** (optional): Additional context about the stack/infrastructure
- **fixInstructions** (required): Description of what needs to be fixed

## Process Flow

1. **Clone Repository**: Clones the repo at the specified branch
2. **Analyze Context**: Scans repository structure to understand the codebase
3. **Create Fix Plan**: Uses Claude AI to create a detailed fix plan including:
   - Summary of what needs to be fixed
   - Step-by-step implementation plan
   - List of files that need to be modified
4. **Implement Fix**: Uses Claude AI to implement the fix according to the plan
5. **Create Fix Branch**: Creates a new branch named `fix/{sessionId}`
6. **Commit & Push**: Commits changes and pushes to the remote repository
7. **Output Deployment Job**: Returns deployment job details with the new branch

## Output

The fixer outputs a deployment job that can be used to deploy the fixed code:

```json
{
  "repository": "https://github.com/username/repo",
  "branch": "fix/fixer-abc123",
  "customRootFolder": "optional/path",
  "stackDetails": { "optional": "stack info" }
}
```

This deployment job can be passed directly to the deployer module to deploy the fixed code.

## Environment Variables

The fixer container requires the following environment variables:

- **SESSION_ID**: Unique session identifier
- **REPOSITORY**: GitHub repository URL
- **BRANCH**: Branch to branch from
- **CUSTOM_ROOT_FOLDER**: Optional subdirectory path
- **FIX_INSTRUCTIONS**: Description of what to fix
- **STACK_DETAILS**: Optional JSON string with stack details
- **ANTHROPIC_API_KEY**: API key for Claude AI (required)
- **DEPLOYMENTS_TABLE**: DynamoDB table name
- **AWS_ACCOUNT_ID**: AWS account ID
- **AWS_REGION**: AWS region

## API Usage

### Initiate Fix

```bash
curl -X POST https://api-endpoint/fix \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/username/repo",
    "branch": "main",
    "fixInstructions": "Fix the authentication bug in user login"
  }'
```

Response:
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

### Check Fix Status

```bash
curl https://api-endpoint/status/fixer-abc123
```

Response:
```json
{
  "sessionId": "fixer-abc123",
  "status": "success",
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "fixInstructions": "Fix the authentication bug in user login",
  "logs": ["Starting fix process", "Repository cloned", "Fix plan created", ...],
  "fixPlan": {
    "summary": "Fix authentication bug in login handler",
    "steps": ["Update validateUser function", "Add error handling"],
    "filesToModify": ["src/auth/login.ts"]
  },
  "deploymentJob": {
    "repository": "https://github.com/username/repo",
    "branch": "fix/fixer-abc123",
    "customRootFolder": ""
  }
}
```

## AI Client

The fixer uses two AI operations:

1. **Create Fix Plan** (`ai-client.ts:createFixPlan`):
   - Analyzes the fix instructions and repository context
   - Creates a structured plan with summary, steps, and files to modify
   - Uses Claude Sonnet 4.5 model

2. **Implement Fix** (`ai-client.ts:implementFix`):
   - Takes the fix plan and current file contents
   - Implements the fix according to the plan
   - Returns the complete new content for each modified file
   - Uses Claude Sonnet 4.5 model

## Security Considerations

1. **Path Validation**: Custom root folder paths are validated to prevent path traversal attacks
2. **Git Credentials**: The fixer requires write access to the repository to push the fix branch
3. **API Key Management**: ANTHROPIC_API_KEY should be stored in AWS Secrets Manager in production
4. **IAM Permissions**: The ECS task role needs permissions for DynamoDB and CloudWatch Logs

## Production Setup

For production use:

1. **Store API Key in Secrets Manager**:
   ```typescript
   import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

   const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
     this, 'AnthropicApiKey', 'anthropic-api-key'
   );

   secrets: {
     ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicApiKey)
   }
   ```

2. **Configure Git Credentials**: Set up GitHub tokens or SSH keys for pushing to repositories

3. **Enable API Key Authentication**: Add API Gateway API keys for the `/fix` endpoint

4. **Set Up Monitoring**: Configure CloudWatch alarms for task failures

## Limitations

1. The fixer creates a new branch for each fix - manual PR creation may be needed
2. Git credentials must be configured for pushing to private repositories
3. Large codebases may exceed AI context limits
4. Fix quality depends on the clarity of fix instructions and available context

## Future Enhancements

- Automatic PR creation after fix
- Support for multi-file complex fixes
- Integration with CI/CD pipelines
- Fix verification and testing
- Support for custom AI models
- Incremental fixes with feedback loops
