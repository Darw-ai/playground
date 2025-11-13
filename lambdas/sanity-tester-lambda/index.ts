import { SQSEvent, SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

interface SanityTestJob {
  sessionId: string;
  repository: string;
  branch: string;
  customRootFolder?: string;
  stackDetails: Record<string, any>;
}

interface TestResult {
  endpoint: string;
  method: string;
  passed: boolean;
  error?: string;
  response?: any;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const job: SanityTestJob = JSON.parse(record.body);
    console.log('Processing sanity test job:', job);

    try {
      await updateStatus(job.sessionId, 'inspecting', 'Analyzing codebase for APIs...');

      // Clone repository
      const repoPath = await cloneRepository(job.sessionId, job.repository, job.branch, job.customRootFolder);
      await addLog(job.sessionId, 'Repository cloned successfully');

      // Extract base URL
      const baseUrl = extractBaseUrl(job.stackDetails);
      if (!baseUrl) {
        throw new Error('Could not extract base URL from stack details');
      }
      await addLog(job.sessionId, `Detected base URL: ${baseUrl}`);

      // Get repository context
      const repoContext = getRepositoryContext(repoPath);

      // Discover APIs using AI
      await addLog(job.sessionId, 'Discovering APIs with AI...');
      const apiMap = await discoverAPIs(repoContext);
      await addLog(job.sessionId, `Discovered ${apiMap.endpoints.length} API endpoints`);

      // Generate sanity tests
      await updateStatus(job.sessionId, 'generating', 'Generating sanity tests...');
      const sanityTests = await generateSanityTests(apiMap, job.stackDetails);
      await addLog(job.sessionId, `Generated ${sanityTests.length} sanity tests`);

      // Execute tests
      await updateStatus(job.sessionId, 'testing', 'Executing sanity tests...');
      const testResults: TestResult[] = [];

      for (const test of sanityTests) {
        try {
          const url = `${baseUrl}${test.endpoint}`;
          const response = await axios({
            method: test.method.toLowerCase(),
            url,
            data: test.body,
            headers: test.headers || {},
            timeout: 10000,
          });

          testResults.push({
            endpoint: test.endpoint,
            method: test.method,
            passed: true,
            response: response.data,
          });

          await addLog(job.sessionId, `✓ ${test.method} ${test.endpoint} - PASSED`);
        } catch (error: any) {
          testResults.push({
            endpoint: test.endpoint,
            method: test.method,
            passed: false,
            error: error.message,
          });

          await addLog(job.sessionId, `✗ ${test.method} ${test.endpoint} - FAILED: ${error.message}`);
        }
      }

      // Analyze results
      const passedTests = testResults.filter((r) => r.passed).length;
      const failedTests = testResults.filter((r) => !r.passed).length;

      const finalStatus = failedTests === 0 ? 'success' : 'failed';
      const finalMessage =
        failedTests === 0
          ? `All ${passedTests} sanity tests passed successfully`
          : `${failedTests} out of ${testResults.length} tests failed`;

      await docClient.send(
        new PutCommand({
          TableName: DEPLOYMENTS_TABLE,
          Item: {
            sessionId: job.sessionId,
            timestamp: Date.now(),
            status: finalStatus,
            message: finalMessage,
            testResults,
            apiMap,
            sanityTests,
          },
        })
      );

      // Cleanup
      cleanupTempFiles(repoPath);

      await addLog(job.sessionId, `Sanity testing completed: ${passedTests} passed, ${failedTests} failed`);
    } catch (error) {
      console.error('Error processing sanity test job:', error);
      await updateStatus(
        job.sessionId,
        'failed',
        'Sanity testing failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
};

async function cloneRepository(
  sessionId: string,
  repository: string,
  branch: string,
  customRootFolder?: string
): Promise<string> {
  const tmpDir = `/tmp/${sessionId}`;

  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const git = simpleGit();
  await git.clone(repository, tmpDir, ['--branch', branch, '--single-branch', '--depth', '1']);

  if (customRootFolder) {
    const projectPath = path.join(tmpDir, customRootFolder);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Custom root folder not found: ${customRootFolder}`);
    }

    return projectPath;
  }

  return tmpDir;
}

function getRepositoryContext(repoPath: string): string {
  const files = getAllFiles(repoPath);
  const relevantFiles = files.filter(
    (f) =>
      f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
  );

  const fileList = relevantFiles.map((f) => path.relative(repoPath, f)).join('\n');
  return `Repository structure:\n${fileList}\n\nTotal files: ${relevantFiles.length}`;
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);

    if (file === '.git' || file === 'node_modules') {
      return;
    }

    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
    } else {
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
}

function extractBaseUrl(stackDetails: Record<string, any>): string | null {
  const commonKeys = [
    'apiUrl',
    'ApiUrl',
    'baseUrl',
    'BaseUrl',
    'endpoint',
    'Endpoint',
    'apiEndpoint',
    'ApiEndpoint',
    'url',
    'Url',
    'ApiGatewayUrl',
  ];

  for (const key of commonKeys) {
    if (stackDetails[key] && typeof stackDetails[key] === 'string') {
      return stackDetails[key];
    }
  }

  if (stackDetails.outputs) {
    for (const key of commonKeys) {
      if (stackDetails.outputs[key]) {
        return stackDetails.outputs[key];
      }
    }
  }

  return null;
}

async function discoverAPIs(repoContext: string): Promise<any> {
  const prompt = `Analyze the following repository and discover all API endpoints.

${repoContext}

Return ONLY valid JSON in this format:
{
  "endpoints": [
    {
      "path": "/api/users",
      "method": "GET",
      "description": "Get all users"
    }
  ]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from AI');
  }

  return JSON.parse(content.text);
}

async function generateSanityTests(apiMap: any, stackDetails: Record<string, any>): Promise<any[]> {
  const prompt = `Generate comprehensive sanity tests for the following API endpoints:

${JSON.stringify(apiMap, null, 2)}

Stack Details:
${JSON.stringify(stackDetails, null, 2)}

Return ONLY valid JSON array in this format:
[
  {
    "endpoint": "/api/users",
    "method": "GET",
    "description": "Test getting all users",
    "headers": {},
    "body": null
  }
]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from AI');
  }

  return JSON.parse(content.text);
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

async function updateStatus(sessionId: string, status: string, message: string, error?: string): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: {
        sessionId,
        timestamp: Date.now(),
        status,
        message,
        error,
      },
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
        status: 'testing',
        logs: [logMessage],
      },
    })
  );
}
