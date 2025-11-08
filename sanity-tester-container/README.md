# Sanity Tester Module

Automated sanity testing module that inspects web applications, discovers API endpoints, and generates/executes happy-flow sanity tests.

## Overview

The sanity tester module:
1. Clones a git repository and checks out a specific branch
2. Inspects the codebase to discover API endpoints
3. Uses AI to map all API routes and their schemas
4. Generates comprehensive happy-flow sanity tests
5. Executes tests against the deployed stack
6. Reports detailed results with pass/fail status

## Features

- **Automated API Discovery**: Scans codebase for REST APIs, Lambda handlers, Express routes, etc.
- **Intelligent Test Generation**: Uses AI to create realistic test scenarios with proper sequencing
- **Variable Management**: Supports storing and reusing values between test steps (e.g., IDs, tokens)
- **Comprehensive Validation**: Validates HTTP status codes and response schemas
- **Detailed Reporting**: Provides step-by-step test execution logs with timing information
- **Stack Integration**: Automatically extracts deployment URLs from stack information

## Architecture

The module runs as an ECS Fargate container and consists of:

- **index.ts**: Main orchestrator that coordinates the testing process
- **ai-client.ts**: AI integration for API discovery and test generation
- **api-inspector.ts**: Codebase scanner that identifies API-related files
- **test-executor.ts**: HTTP test runner with variable substitution

## Environment Variables

Required:
- `SESSION_ID`: Unique session identifier
- `REPOSITORY`: Git repository URL
- `BRANCH`: Branch to test
- `STACK_DETAILS`: JSON string containing deployment information (must include API endpoint)
- `ANTHROPIC_API_KEY`: API key for Claude AI
- `DEPLOYMENTS_TABLE`: DynamoDB table for storing results

Optional:
- `CUSTOM_ROOT_FOLDER`: Subdirectory within the repository to analyze

## Stack Details Format

The `STACK_DETAILS` should contain the deployed API endpoint. Supported keys:
- `apiUrl`, `ApiUrl`
- `baseUrl`, `BaseUrl`
- `endpoint`, `Endpoint`
- `apiEndpoint`, `ApiEndpoint`
- `url`, `Url`
- `apiGatewayUrl`, `ApiGatewayUrl`

Example:
```json
{
  "apiUrl": "https://api.example.com",
  "region": "us-east-1",
  "stage": "prod"
}
```

Or CloudFormation outputs format:
```json
{
  "outputs": {
    "ApiUrl": "https://api.example.com"
  }
}
```

## API Discovery

The inspector scans for files containing:
- Express/Fastify/Koa route definitions
- AWS Lambda handlers
- API Gateway integrations
- OpenAPI/Swagger specifications
- GraphQL schemas

Excluded directories: `node_modules`, `.git`, `dist`, `build`, `coverage`

## Test Generation

AI-generated tests include:
- Logical sequencing (e.g., create before update, login before protected resources)
- Realistic test data
- Variable substitution (e.g., `${userId}` in URLs)
- Expected status codes and response validation
- Authentication headers when needed

## Test Execution

Tests run sequentially with:
- HTTP request/response logging
- Variable storage from responses (using JSONPath-like syntax)
- Status code validation
- Response schema validation
- Detailed timing information

## Results

Results are stored in DynamoDB with:
- Session ID and timestamp
- Status: `pending`, `inspecting`, `generating`, `testing`, `success`, `failed`
- Discovered API map
- Generated test suite
- Test execution results with pass/fail for each step
- Detailed logs

## Usage via API

```bash
curl -X POST https://api.example.com/sanity-test \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/user/repo.git",
    "branch": "main",
    "customRootFolder": "backend",
    "stackDetails": {
      "apiUrl": "https://deployed-api.example.com"
    }
  }'
```

## Local Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (requires environment variables)
export SESSION_ID=test-123
export REPOSITORY=https://github.com/user/repo.git
export BRANCH=main
export STACK_DETAILS='{"apiUrl":"https://api.example.com"}'
export ANTHROPIC_API_KEY=your-key
export DEPLOYMENTS_TABLE=your-table
npm start
```

## Example Test Flow

1. **API Discovery**: Finds endpoints like `POST /users`, `GET /users/:id`, `DELETE /users/:id`
2. **Test Generation**: Creates test:
   - Step 1: POST /users (create user) → Store `userId`
   - Step 2: GET /users/${userId} (fetch created user)
   - Step 3: DELETE /users/${userId} (cleanup)
3. **Execution**: Runs each step, validates responses, reports results

## Error Handling

- Repository clone failures
- Invalid custom root folder paths
- Missing stack details or API endpoints
- API discovery failures
- Test generation errors
- Test execution failures (network, validation, etc.)

All errors are logged to DynamoDB with detailed messages.
