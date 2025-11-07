import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;

interface DeploymentRecord {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  repository: string;
  branch: string;
  message?: string;
  logs?: string[];
  deployedResources?: Record<string, any>;
  error?: string;
}

interface AnalysisRequest {
  sessionId: string;
  repository?: string;
  branch?: string;
  rootFolder?: string;
  stackDetails?: Record<string, any>;
}

interface AnalysisResult {
  sessionId: string;
  status: string;
  repository: string;
  branch: string;
  analysisTimestamp: string;
  errors: ErrorAnalysis[];
  fixInstructions: FixInstruction[];
  summary: string;
  deploymentDuration?: number;
  rootCause?: string;
}

interface ErrorAnalysis {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  location?: string;
  relatedLogs: string[];
}

interface FixInstruction {
  step: number;
  category: string;
  action: string;
  details: string;
  codeExample?: string;
  documentation?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const path = event.path;
    const method = event.httpMethod;

    // POST /analyze - analyze deployment output
    if (path === '/analyze' && method === 'POST') {
      return await handleAnalyze(event);
    }

    // GET /analyze/{sessionId} - get analysis for a specific deployment
    if (path.startsWith('/analyze/') && method === 'GET') {
      const sessionId = event.pathParameters?.sessionId;
      if (!sessionId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Session ID is required' }),
        };
      }
      return await handleGetAnalysis(sessionId);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function handleAnalyze(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (!event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Request body is required' }),
    };
  }

  const request: AnalysisRequest = JSON.parse(event.body);

  if (!request.sessionId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'sessionId is required' }),
    };
  }

  const analysis = await analyzeDeployment(request);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(analysis),
  };
}

async function handleGetAnalysis(sessionId: string): Promise<APIGatewayProxyResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const analysis = await analyzeDeployment({ sessionId });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(analysis),
  };
}

async function analyzeDeployment(request: AnalysisRequest): Promise<AnalysisResult> {
  // Fetch deployment records from DynamoDB
  const result = await docClient.send(
    new QueryCommand({
      TableName: DEPLOYMENTS_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': request.sessionId,
      },
      ScanIndexForward: true, // Chronological order
    })
  );

  if (!result.Items || result.Items.length === 0) {
    throw new Error(`Deployment not found for session: ${request.sessionId}`);
  }

  const records = result.Items as DeploymentRecord[];
  const latestRecord = records[records.length - 1];
  const allLogs = records.flatMap((r) => r.logs || []);

  // Calculate deployment duration
  const firstTimestamp = records[0].timestamp;
  const lastTimestamp = latestRecord.timestamp;
  const duration = (lastTimestamp - firstTimestamp) / 1000; // seconds

  // Analyze errors and generate fix instructions
  const errors = analyzeErrors(latestRecord, allLogs);
  const fixInstructions = generateFixInstructions(errors, latestRecord, request);
  const summary = generateSummary(latestRecord, errors, duration);
  const rootCause = identifyRootCause(errors, allLogs);

  return {
    sessionId: request.sessionId,
    status: latestRecord.status,
    repository: request.repository || latestRecord.repository,
    branch: request.branch || latestRecord.branch,
    analysisTimestamp: new Date().toISOString(),
    errors,
    fixInstructions,
    summary,
    deploymentDuration: duration,
    rootCause,
  };
}

function analyzeErrors(record: DeploymentRecord, logs: string[]): ErrorAnalysis[] {
  const errors: ErrorAnalysis[] = [];
  const allText = [...logs, record.error || '', record.message || ''].join(' ');

  // CloudFormation errors
  if (allText.includes('CREATE_FAILED') || allText.includes('ROLLBACK')) {
    const cfnErrors = analyzeCFNErrors(logs);
    errors.push(...cfnErrors);
  }

  // IAM permission errors
  if (
    allText.includes('AccessDenied') ||
    allText.includes('not authorized') ||
    allText.includes('UnauthorizedOperation') ||
    allText.includes('InvalidPermission')
  ) {
    errors.push({
      type: 'IAM_PERMISSION',
      severity: 'critical',
      message: 'IAM permission denied',
      relatedLogs: logs.filter((l) => l.includes('Access') || l.includes('authorized') || l.includes('Permission')),
    });
  }

  // Lambda errors
  if (allText.includes('InvalidParameterValueException') || allText.includes('ResourceConflict')) {
    errors.push({
      type: 'LAMBDA_CONFIG',
      severity: 'high',
      message: 'Lambda configuration error',
      relatedLogs: logs.filter((l) => l.includes('Lambda') || l.includes('function')),
    });
  }

  // Git/Repository errors
  if (allText.includes('clone') && allText.includes('failed')) {
    errors.push({
      type: 'GIT_CLONE',
      severity: 'critical',
      message: 'Failed to clone repository',
      relatedLogs: logs.filter((l) => l.includes('clone') || l.includes('repository')),
    });
  }

  // S3 errors
  if (allText.includes('NoSuchBucket') || allText.includes('S3') && allText.includes('error')) {
    errors.push({
      type: 'S3_ERROR',
      severity: 'high',
      message: 'S3 bucket access or configuration error',
      relatedLogs: logs.filter((l) => l.includes('S3') || l.includes('bucket')),
    });
  }

  // Template validation errors
  if (allText.includes('ValidationError') || allText.includes('Invalid template')) {
    errors.push({
      type: 'TEMPLATE_VALIDATION',
      severity: 'high',
      message: 'CloudFormation template validation failed',
      relatedLogs: logs.filter((l) => l.includes('template') || l.includes('Validation')),
    });
  }

  // Timeout errors
  if (allText.includes('timeout') || allText.includes('timed out')) {
    errors.push({
      type: 'TIMEOUT',
      severity: 'medium',
      message: 'Deployment or operation timed out',
      relatedLogs: logs.filter((l) => l.toLowerCase().includes('timeout')),
    });
  }

  // Network errors
  if (allText.includes('ENOTFOUND') || allText.includes('ECONNREFUSED') || allText.includes('network')) {
    errors.push({
      type: 'NETWORK',
      severity: 'high',
      message: 'Network connectivity error',
      relatedLogs: logs.filter((l) => l.includes('network') || l.includes('ENOTFOUND') || l.includes('ECONNREFUSED')),
    });
  }

  // Resource limit errors
  if (allText.includes('LimitExceeded') || allText.includes('Quota')) {
    errors.push({
      type: 'RESOURCE_LIMIT',
      severity: 'high',
      message: 'AWS resource limit or quota exceeded',
      relatedLogs: logs.filter((l) => l.includes('Limit') || l.includes('Quota')),
    });
  }

  return errors;
}

function analyzeCFNErrors(logs: string[]): ErrorAnalysis[] {
  const errors: ErrorAnalysis[] = [];
  const failedLogs = logs.filter((l) => l.includes('FAILED') || l.includes('ROLLBACK'));

  for (const log of failedLogs) {
    let type = 'CFN_GENERAL';
    let severity: 'critical' | 'high' | 'medium' | 'low' = 'high';

    if (log.includes('AlreadyExists')) {
      type = 'CFN_RESOURCE_EXISTS';
      severity = 'medium';
    } else if (log.includes('InvalidParameter')) {
      type = 'CFN_INVALID_PARAMETER';
      severity = 'high';
    } else if (log.includes('InsufficientCapabilities')) {
      type = 'CFN_CAPABILITIES';
      severity = 'critical';
    }

    errors.push({
      type,
      severity,
      message: log,
      location: extractResourceId(log),
      relatedLogs: [log],
    });
  }

  return errors;
}

function extractResourceId(log: string): string | undefined {
  const match = log.match(/([A-Za-z0-9]+):/);
  return match ? match[1] : undefined;
}

function identifyRootCause(errors: ErrorAnalysis[], logs: string[]): string | undefined {
  // Find the most critical error
  const criticalErrors = errors.filter((e) => e.severity === 'critical');
  if (criticalErrors.length > 0) {
    return criticalErrors[0].message;
  }

  const highErrors = errors.filter((e) => e.severity === 'high');
  if (highErrors.length > 0) {
    return highErrors[0].message;
  }

  // Look for first failed log
  const failedLog = logs.find((l) => l.includes('FAILED') || l.includes('error') || l.includes('Error'));
  return failedLog;
}

function generateFixInstructions(
  errors: ErrorAnalysis[],
  record: DeploymentRecord,
  request: AnalysisRequest
): FixInstruction[] {
  const instructions: FixInstruction[] = [];
  let stepCounter = 1;

  // Group errors by type
  const errorTypes = new Set(errors.map((e) => e.type));

  for (const errorType of errorTypes) {
    const typeErrors = errors.filter((e) => e.type === errorType);

    switch (errorType) {
      case 'IAM_PERMISSION':
        instructions.push({
          step: stepCounter++,
          category: 'IAM Permissions',
          action: 'Grant required IAM permissions',
          details: 'The deployment failed due to insufficient IAM permissions. You need to grant the necessary permissions to the execution role.',
          codeExample: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "lambda:*",
        "iam:*",
        "s3:*"
      ],
      "Resource": "*"
    }
  ]
}`,
          documentation: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html',
        });
        break;

      case 'LAMBDA_CONFIG':
        instructions.push({
          step: stepCounter++,
          category: 'Lambda Configuration',
          action: 'Fix Lambda function configuration',
          details: 'Check Lambda runtime, handler, memory, and timeout settings. Ensure the handler path matches your code structure.',
          codeExample: `// Correct handler format: filename.functionName
// For index.js with export handler = ... use: "index.handler"
// For handler.js with export handler = ... use: "handler.handler"`,
          documentation: 'https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html',
        });
        break;

      case 'GIT_CLONE':
        instructions.push({
          step: stepCounter++,
          category: 'Repository Access',
          action: 'Fix repository access issues',
          details: 'Ensure the repository URL is correct and publicly accessible, or configure credentials for private repositories.',
          codeExample: `# Public repository format:
https://github.com/username/repository

# Ensure the branch exists:
git ls-remote --heads ${request.repository || record.repository}`,
          documentation: 'https://docs.github.com/en/repositories',
        });
        break;

      case 'CFN_RESOURCE_EXISTS':
        instructions.push({
          step: stepCounter++,
          category: 'CloudFormation',
          action: 'Handle existing resources',
          details: 'Resources with the same name already exist. Either delete the existing resources or use different names in your template.',
          codeExample: `# Delete existing CloudFormation stack:
aws cloudformation delete-stack --stack-name <stack-name>

# Or update your template to use unique resource names`,
          documentation: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html',
        });
        break;

      case 'CFN_INVALID_PARAMETER':
        instructions.push({
          step: stepCounter++,
          category: 'CloudFormation',
          action: 'Fix template parameters',
          details: 'One or more parameters in your CloudFormation template are invalid. Review the parameter values and constraints.',
          codeExample: `# Validate your template locally:
aws cloudformation validate-template --template-body file://template.yaml

# Check parameter constraints in your template`,
          documentation: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html',
        });
        break;

      case 'CFN_CAPABILITIES':
        instructions.push({
          step: stepCounter++,
          category: 'CloudFormation',
          action: 'Add required capabilities',
          details: 'Your template creates IAM resources but lacks the required capabilities acknowledgment.',
          codeExample: `# The deployer should include these capabilities:
Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND']

# This is already configured in the deployer, but your template may need review.`,
          documentation: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-template.html',
        });
        break;

      case 'S3_ERROR':
        instructions.push({
          step: stepCounter++,
          category: 'S3 Storage',
          action: 'Fix S3 bucket configuration',
          details: 'Ensure the S3 bucket exists and has correct permissions. The deployer creates buckets automatically, but check for any bucket policy restrictions.',
          codeExample: `# Check bucket existence:
aws s3 ls s3://<bucket-name>

# Verify bucket permissions allow PutObject and GetObject operations`,
          documentation: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html',
        });
        break;

      case 'TEMPLATE_VALIDATION':
        instructions.push({
          step: stepCounter++,
          category: 'Template',
          action: 'Fix template syntax',
          details: 'Your CloudFormation/SAM template has syntax or validation errors. Review the template structure.',
          codeExample: `# Validate template:
aws cloudformation validate-template --template-body file://template.yaml

# Common issues:
# - YAML indentation
# - Missing required properties
# - Invalid resource types
# - Incorrect intrinsic functions`,
          documentation: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-reference.html',
        });
        break;

      case 'TIMEOUT':
        instructions.push({
          step: stepCounter++,
          category: 'Performance',
          action: 'Address timeout issues',
          details: 'The deployment or stack creation exceeded the time limit. This may indicate resource creation issues or networking problems.',
          codeExample: `# For CloudFormation, check:
# - VPC/Network configuration
# - Resource dependencies
# - Custom resource timeouts

# For Lambda deployment, ensure:
# - Package size is reasonable
# - No circular dependencies`,
          documentation: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html#troubleshooting-stack-creation',
        });
        break;

      case 'NETWORK':
        instructions.push({
          step: stepCounter++,
          category: 'Network',
          action: 'Fix network connectivity',
          details: 'Network connectivity issues prevented the deployment. Check VPC configuration, security groups, and internet access.',
          codeExample: `# Verify ECS task has:
# - Public IP assigned (for internet access)
# - Security group allows outbound traffic
# - Subnets have route to internet gateway or NAT

# Check DNS resolution works`,
          documentation: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-troubleshooting.html',
        });
        break;

      case 'RESOURCE_LIMIT':
        instructions.push({
          step: stepCounter++,
          category: 'AWS Limits',
          action: 'Request limit increase',
          details: 'You have reached an AWS service limit or quota. Request a limit increase through AWS Support.',
          codeExample: `# Check current limits:
aws service-quotas list-service-quotas --service-code lambda

# Request increase through AWS Console:
# Service Quotas -> AWS services -> Select service -> Request quota increase`,
          documentation: 'https://docs.aws.amazon.com/general/latest/gr/aws_service_limits.html',
        });
        break;

      default:
        if (errorType.startsWith('CFN_')) {
          instructions.push({
            step: stepCounter++,
            category: 'CloudFormation',
            action: 'Review CloudFormation errors',
            details: `Review the CloudFormation error logs: ${typeErrors.map((e) => e.message).join('; ')}`,
            documentation: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html',
          });
        }
        break;
    }
  }

  // Add general recommendations if no specific errors found
  if (instructions.length === 0 && record.status === 'failed') {
    instructions.push({
      step: 1,
      category: 'General',
      action: 'Review deployment logs',
      details: 'No specific error pattern detected. Review the full deployment logs for details.',
      codeExample: `# Check the deployment status:
GET /status/${record.sessionId}

# Review all logs in the response`,
    });
  }

  // Add success recommendations
  if (record.status === 'success') {
    instructions.push({
      step: 1,
      category: 'Success',
      action: 'Deployment completed successfully',
      details: 'Your deployment was successful. Review the deployed resources and test functionality.',
      codeExample: record.deployedResources
        ? `Deployed resources:\n${JSON.stringify(record.deployedResources, null, 2)}`
        : undefined,
    });
  }

  return instructions;
}

function generateSummary(record: DeploymentRecord, errors: ErrorAnalysis[], duration: number): string {
  if (record.status === 'success') {
    return `Deployment completed successfully in ${duration.toFixed(1)} seconds. All resources deployed without errors.`;
  }

  if (record.status === 'failed') {
    const errorCount = errors.length;
    const criticalCount = errors.filter((e) => e.severity === 'critical').length;
    const highCount = errors.filter((e) => e.severity === 'high').length;

    let summary = `Deployment failed after ${duration.toFixed(1)} seconds. `;

    if (errorCount === 0) {
      summary += 'No specific errors detected in logs. Review the deployment logs for details.';
    } else {
      summary += `Found ${errorCount} error(s): `;
      if (criticalCount > 0) {
        summary += `${criticalCount} critical, `;
      }
      if (highCount > 0) {
        summary += `${highCount} high severity, `;
      }
      summary += `${errorCount - criticalCount - highCount} other. `;
      summary += 'See fix instructions below.';
    }

    return summary;
  }

  if (record.status === 'deploying') {
    return `Deployment is currently in progress (${duration.toFixed(1)} seconds elapsed). Check back for final results.`;
  }

  return `Deployment is ${record.status} (${duration.toFixed(1)} seconds elapsed).`;
}
