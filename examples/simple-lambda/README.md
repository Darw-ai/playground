# Simple Lambda Example

This is a basic Lambda function that can be deployed using the GitHub Lambda Deployer API.

## What it does

Returns a simple greeting message with a timestamp.

## How to test deployment

1. Push this code to a GitHub repository
2. Use the deployer API to deploy:

```bash
curl -X POST https://YOUR_API_ENDPOINT/prod/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/YOUR_USERNAME/YOUR_REPO",
    "branch": "main"
  }'
```

3. Check deployment status with the returned sessionId:

```bash
curl https://YOUR_API_ENDPOINT/prod/status/SESSION_ID
```

4. Once deployed, test the Lambda function in AWS Console or via AWS CLI
