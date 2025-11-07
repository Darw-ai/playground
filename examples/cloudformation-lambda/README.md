# CloudFormation/SAM Lambda Example

This is a Lambda function with API Gateway, defined using AWS SAM template.

## What it does

- Deploys a Lambda function with an HTTP API endpoint
- Returns a greeting message with request metadata
- Includes API Gateway integration

## Structure

- `template.yaml` - SAM template defining infrastructure
- `index.js` - Lambda function code
- `package.json` - Node.js dependencies

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

3. Check deployment status:

```bash
curl https://YOUR_API_ENDPOINT/prod/status/SESSION_ID
```

4. Once deployed, the API endpoint URL will be in the stack outputs
5. Test the endpoint:

```bash
curl https://STACK_API_ENDPOINT/hello?name=YourName
```

## Notes

- The deployer will automatically detect this as a SAM template
- CloudFormation stack will be created with session ID suffix
- All resources are tagged with DeploymentSessionId
