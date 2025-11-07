import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import { LambdaClient, InvokeCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Client, GetApisCommand, GetRoutesCommand } from '@aws-sdk/client-apigatewayv2';
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cfnClient = new CloudFormationClient({});
const lambdaClient = new LambdaClient({});
const apiGatewayClient = new ApiGatewayV2Client({});
const s3Client = new S3Client({});

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const AWS_REGION = process.env.AWS_REGION!;

// Container-specific environment variables (passed as overrides)
const SESSION_ID = process.env.SESSION_ID!;
const REPOSITORY = process.env.REPOSITORY!;
const BRANCH = process.env.BRANCH!;
const COMMIT = process.env.COMMIT || 'HEAD';
const STACK_NAME = process.env.STACK_NAME;
const FUNCTION_NAME = process.env.FUNCTION_NAME;

interface TestResult {
  testName: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  duration: number;
  error?: string;
}

interface DeployedResource {
  type: string;
  id: string;
  name: string;
  arn?: string;
  details?: any;
}

interface TestSession {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  repository: string;
  branch: string;
  commit: string;
  stackName?: string;
  functionName?: string;
  message?: string;
  logs?: string[];
  testResults?: TestResult[];
  error?: string;
}

async function main() {
  console.log(`Starting test generation for session ${SESSION_ID}`);
  console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}, Commit: ${COMMIT}`);
  console.log(`Stack: ${STACK_NAME}, Function: ${FUNCTION_NAME}`);

  try {
    await updateTestStatus(SESSION_ID, 'running', 'Cloning repository...', [
      'Starting test generation process',
      `Cloning ${REPOSITORY} (branch: ${BRANCH}, commit: ${COMMIT})`,
    ]);

    // Clone repository
    const repoPath = await cloneRepository(SESSION_ID, REPOSITORY, BRANCH, COMMIT);
    await addLog(SESSION_ID, 'Repository cloned successfully');

    // Discover deployed resources
    await addLog(SESSION_ID, 'Discovering deployed resources...');
    const resources = await discoverResources(SESSION_ID);
    await addLog(SESSION_ID, `Found ${resources.length} resources to test`);

    // Generate and run tests
    await addLog(SESSION_ID, 'Generating sanity tests...');
    const testResults: TestResult[] = [];

    for (const resource of resources) {
      await addLog(SESSION_ID, `Testing ${resource.type}: ${resource.name}`);
      const result = await runTestForResource(resource);
      testResults.push(result);

      const statusEmoji = result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '⊘';
      await addLog(SESSION_ID, `  ${statusEmoji} ${result.testName}: ${result.message}`);
    }

    // Summary
    const passed = testResults.filter(r => r.status === 'pass').length;
    const failed = testResults.filter(r => r.status === 'fail').length;
    const skipped = testResults.filter(r => r.status === 'skip').length;

    await addLog(SESSION_ID, `\nTest Summary: ${passed} passed, ${failed} failed, ${skipped} skipped`);

    const finalStatus = failed > 0 ? 'completed' : 'completed';
    await updateTestStatus(
      SESSION_ID,
      finalStatus,
      `Tests completed: ${passed} passed, ${failed} failed`,
      undefined,
      testResults
    );

    // Cleanup
    cleanupTempFiles(repoPath);

    console.log('Test generation and execution completed');
    process.exit(0);
  } catch (error) {
    console.error('Test generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateTestStatus(
      SESSION_ID,
      'failed',
      'Test generation failed',
      [errorMessage],
      undefined,
      errorMessage
    );

    process.exit(1);
  }
}

async function cloneRepository(
  sessionId: string,
  repository: string,
  branch: string,
  commit: string
): Promise<string> {
  const tmpDir = `/tmp/${sessionId}`;

  // Clean up if exists
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const git = simpleGit();
  await git.clone(repository, tmpDir, ['--branch', branch, '--single-branch']);

  // Checkout specific commit if not HEAD
  if (commit !== 'HEAD') {
    const repoGit = simpleGit(tmpDir);
    await repoGit.checkout(commit);
    await addLog(sessionId, `Checked out commit: ${commit}`);
  }

  return tmpDir;
}

async function discoverResources(sessionId: string): Promise<DeployedResource[]> {
  const resources: DeployedResource[] = [];

  try {
    // If stack name provided, get resources from CloudFormation
    if (STACK_NAME) {
      await addLog(sessionId, `Querying CloudFormation stack: ${STACK_NAME}`);

      const stackResources = await cfnClient.send(
        new DescribeStackResourcesCommand({ StackName: STACK_NAME })
      );

      const stackInfo = await cfnClient.send(
        new DescribeStacksCommand({ StackName: STACK_NAME })
      );

      for (const resource of stackResources.StackResources || []) {
        const deployed: DeployedResource = {
          type: resource.ResourceType || 'Unknown',
          id: resource.PhysicalResourceId || '',
          name: resource.LogicalResourceId || '',
          arn: resource.PhysicalResourceId,
        };

        // Get additional details based on resource type
        if (resource.ResourceType === 'AWS::Lambda::Function') {
          try {
            const funcDetails = await lambdaClient.send(
              new GetFunctionCommand({ FunctionName: resource.PhysicalResourceId })
            );
            deployed.details = {
              runtime: funcDetails.Configuration?.Runtime,
              handler: funcDetails.Configuration?.Handler,
              timeout: funcDetails.Configuration?.Timeout,
            };
          } catch (err) {
            console.error(`Error getting Lambda details: ${err}`);
          }
        }

        resources.push(deployed);
      }

      // Add stack outputs as testable resources
      for (const output of stackInfo.Stacks?.[0]?.Outputs || []) {
        if (output.OutputKey?.toLowerCase().includes('url') ||
            output.OutputKey?.toLowerCase().includes('endpoint') ||
            output.OutputKey?.toLowerCase().includes('api')) {
          resources.push({
            type: 'AWS::ApiGateway::Endpoint',
            id: output.OutputValue || '',
            name: output.OutputKey || '',
            details: { url: output.OutputValue },
          });
        }
      }
    }

    // If function name provided, test that specific function
    if (FUNCTION_NAME) {
      await addLog(sessionId, `Querying Lambda function: ${FUNCTION_NAME}`);

      const funcDetails = await lambdaClient.send(
        new GetFunctionCommand({ FunctionName: FUNCTION_NAME })
      );

      resources.push({
        type: 'AWS::Lambda::Function',
        id: FUNCTION_NAME,
        name: FUNCTION_NAME,
        arn: funcDetails.Configuration?.FunctionArn,
        details: {
          runtime: funcDetails.Configuration?.Runtime,
          handler: funcDetails.Configuration?.Handler,
          timeout: funcDetails.Configuration?.Timeout,
        },
      });
    }

    return resources;
  } catch (error) {
    console.error('Error discovering resources:', error);
    await addLog(sessionId, `Error discovering resources: ${error}`);
    throw error;
  }
}

async function runTestForResource(resource: DeployedResource): Promise<TestResult> {
  const startTime = Date.now();

  try {
    switch (resource.type) {
      case 'AWS::Lambda::Function':
        return await testLambdaFunction(resource, startTime);

      case 'AWS::ApiGateway::RestApi':
      case 'AWS::ApiGatewayV2::Api':
      case 'AWS::ApiGateway::Endpoint':
        return await testApiEndpoint(resource, startTime);

      case 'AWS::S3::Bucket':
        return await testS3Bucket(resource, startTime);

      case 'AWS::IAM::Role':
        return {
          testName: `IAM Role: ${resource.name}`,
          status: 'skip',
          message: 'IAM roles are not directly testable',
          duration: Date.now() - startTime,
        };

      default:
        return {
          testName: `${resource.type}: ${resource.name}`,
          status: 'skip',
          message: `No test implemented for resource type: ${resource.type}`,
          duration: Date.now() - startTime,
        };
    }
  } catch (error) {
    return {
      testName: `${resource.type}: ${resource.name}`,
      status: 'fail',
      message: 'Test execution failed',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testLambdaFunction(
  resource: DeployedResource,
  startTime: number
): Promise<TestResult> {
  try {
    // Invoke Lambda with empty test payload
    const response = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: resource.id,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({ test: true, message: 'Sanity test invocation' }),
      })
    );

    const statusCode = response.StatusCode || 0;
    const functionError = response.FunctionError;

    if (functionError) {
      const payload = response.Payload
        ? JSON.parse(Buffer.from(response.Payload).toString())
        : {};

      return {
        testName: `Lambda Function: ${resource.name}`,
        status: 'fail',
        message: `Function returned error: ${functionError}`,
        duration: Date.now() - startTime,
        error: JSON.stringify(payload),
      };
    }

    if (statusCode === 200) {
      return {
        testName: `Lambda Function: ${resource.name}`,
        status: 'pass',
        message: `Function invoked successfully (runtime: ${resource.details?.runtime})`,
        duration: Date.now() - startTime,
      };
    } else {
      return {
        testName: `Lambda Function: ${resource.name}`,
        status: 'fail',
        message: `Function returned status code: ${statusCode}`,
        duration: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      testName: `Lambda Function: ${resource.name}`,
      status: 'fail',
      message: 'Failed to invoke function',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testApiEndpoint(
  resource: DeployedResource,
  startTime: number
): Promise<TestResult> {
  try {
    // Extract URL from resource details or ID
    const url = resource.details?.url || resource.id;

    if (!url || !url.startsWith('http')) {
      return {
        testName: `API Endpoint: ${resource.name}`,
        status: 'skip',
        message: 'No valid URL found for API endpoint',
        duration: Date.now() - startTime,
      };
    }

    // Try GET request to the endpoint
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: (status) => status < 500, // Accept any status < 500 as valid
      });

      if (response.status < 400) {
        return {
          testName: `API Endpoint: ${resource.name}`,
          status: 'pass',
          message: `Endpoint responded with status ${response.status}`,
          duration: Date.now() - startTime,
        };
      } else {
        return {
          testName: `API Endpoint: ${resource.name}`,
          status: 'fail',
          message: `Endpoint returned error status ${response.status}`,
          duration: Date.now() - startTime,
        };
      }
    } catch (axiosError: any) {
      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ETIMEDOUT') {
        return {
          testName: `API Endpoint: ${resource.name}`,
          status: 'fail',
          message: 'Endpoint is not accessible',
          duration: Date.now() - startTime,
          error: axiosError.message,
        };
      }
      throw axiosError;
    }
  } catch (error) {
    return {
      testName: `API Endpoint: ${resource.name}`,
      status: 'fail',
      message: 'Failed to test API endpoint',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testS3Bucket(
  resource: DeployedResource,
  startTime: number
): Promise<TestResult> {
  try {
    // Check if bucket exists and is accessible
    await s3Client.send(new HeadBucketCommand({ Bucket: resource.id }));

    // Try to list objects (just to verify read access)
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: resource.id,
        MaxKeys: 1,
      })
    );

    return {
      testName: `S3 Bucket: ${resource.name}`,
      status: 'pass',
      message: `Bucket is accessible (${listResult.KeyCount || 0} objects found in sample)`,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
      return {
        testName: `S3 Bucket: ${resource.name}`,
        status: 'fail',
        message: 'Bucket does not exist',
        duration: Date.now() - startTime,
        error: error.message,
      };
    } else if (error.name === 'Forbidden' || error.name === 'AccessDenied') {
      return {
        testName: `S3 Bucket: ${resource.name}`,
        status: 'fail',
        message: 'Access denied to bucket',
        duration: Date.now() - startTime,
        error: error.message,
      };
    }

    return {
      testName: `S3 Bucket: ${resource.name}`,
      status: 'fail',
      message: 'Failed to test S3 bucket',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function cleanupTempFiles(repoPath: string): void {
  try {
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('Error cleaning up temp files:', error);
  }
}

async function updateTestStatus(
  sessionId: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  message?: string,
  logs?: string[],
  testResults?: TestResult[],
  error?: string
): Promise<void> {
  const record: TestSession = {
    sessionId,
    timestamp: Date.now(),
    status,
    repository: REPOSITORY,
    branch: BRANCH,
    commit: COMMIT,
    stackName: STACK_NAME,
    functionName: FUNCTION_NAME,
    message,
    logs,
    testResults,
    error,
  };

  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: record,
    })
  );
}

async function addLog(sessionId: string, logMessage: string): Promise<void> {
  console.log(`[${sessionId}] ${logMessage}`);

  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: {
        sessionId,
        timestamp: Date.now(),
        status: 'running',
        repository: REPOSITORY,
        branch: BRANCH,
        commit: COMMIT,
        stackName: STACK_NAME,
        functionName: FUNCTION_NAME,
        logs: [logMessage],
      },
    })
  );
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
