import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { AIClient, APIMap, SanityTest } from './ai-client';
import { APIInspector } from './api-inspector';
import { TestExecutor, TestResult } from './test-executor';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

// Container-specific environment variables (passed as overrides)
const SESSION_ID = process.env.SESSION_ID!;
const REPOSITORY = process.env.REPOSITORY!;
const BRANCH = process.env.BRANCH!;
const CUSTOM_ROOT_FOLDER = process.env.CUSTOM_ROOT_FOLDER || '';
const STACK_DETAILS = process.env.STACK_DETAILS || '';

interface SanityTesterLog {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'inspecting' | 'generating' | 'testing' | 'success' | 'failed';
  repository: string;
  branch: string;
  customRootFolder?: string;
  stackDetails?: Record<string, any>;
  message?: string;
  logs?: string[];
  apiMap?: APIMap;
  sanityTests?: SanityTest[];
  testResults?: TestResult[];
  error?: string;
}

async function main() {
  console.log(`Starting sanity tester for session ${SESSION_ID}`);
  console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}${CUSTOM_ROOT_FOLDER ? `, Custom Root: ${CUSTOM_ROOT_FOLDER}` : ''}`);

  try {
    await updateStatus(SESSION_ID, 'inspecting', 'Cloning repository...', [
      'Starting sanity test process',
      `Cloning ${REPOSITORY} (branch: ${BRANCH})${CUSTOM_ROOT_FOLDER ? ` with custom root: ${CUSTOM_ROOT_FOLDER}` : ''}`,
    ]);

    // Clone repository
    const repoPath = await cloneRepository(SESSION_ID, REPOSITORY, BRANCH, CUSTOM_ROOT_FOLDER);
    await addLog(SESSION_ID, `Repository cloned successfully${CUSTOM_ROOT_FOLDER ? ` (using custom root: ${CUSTOM_ROOT_FOLDER})` : ''}`);

    // Parse stack details
    let stackDetails: Record<string, any> = {};
    if (STACK_DETAILS) {
      try {
        stackDetails = JSON.parse(STACK_DETAILS);
        await addLog(SESSION_ID, 'Stack details parsed successfully');
      } catch (error) {
        const errorMsg = 'Failed to parse stack details - continuing without them';
        console.warn(errorMsg);
        await addLog(SESSION_ID, errorMsg);
      }
    }

    // Extract base URL from stack details
    const baseUrl = extractBaseUrl(stackDetails);
    if (!baseUrl) {
      throw new Error('Could not extract base URL from stack details. Please provide a valid stack with API endpoint information.');
    }
    await addLog(SESSION_ID, `Detected base URL: ${baseUrl}`);

    // Inspect codebase
    await addLog(SESSION_ID, 'Inspecting codebase for API definitions...');
    const inspector = new APIInspector();
    const inspectionResult = await inspector.inspectCodebase(repoPath);
    await addLog(SESSION_ID, `Found ${inspectionResult.files.size} API-related files`);

    // Discover APIs using AI
    await addLog(SESSION_ID, 'Discovering APIs with AI...');
    const aiClient = new AIClient(ANTHROPIC_API_KEY);
    const repositoryContext = inspector.createRepositoryContext(inspectionResult);
    const apiMap = await aiClient.discoverAPIs(repositoryContext, CUSTOM_ROOT_FOLDER || '/');

    await addLog(SESSION_ID, `Discovered ${apiMap.endpoints.length} API endpoints`);
    await updateStatus(SESSION_ID, 'generating', 'Generating sanity tests...', undefined, apiMap);

    // Generate sanity tests
    await addLog(SESSION_ID, 'Generating sanity tests with AI...');
    const sanityTests = await aiClient.generateSanityTests(apiMap, stackDetails);
    await addLog(SESSION_ID, `Generated ${sanityTests.length} sanity tests`);
    await updateStatus(SESSION_ID, 'testing', 'Executing sanity tests...', undefined, apiMap, sanityTests);

    // Execute tests
    await addLog(SESSION_ID, 'Executing sanity tests against deployed stack...');
    const testExecutor = new TestExecutor();
    const testResults = await testExecutor.executeTests(sanityTests, baseUrl);

    // Analyze results
    const passedTests = testResults.filter(r => r.passed).length;
    const failedTests = testResults.filter(r => !r.passed).length;

    await addLog(SESSION_ID, `Tests completed: ${passedTests} passed, ${failedTests} failed`);

    // Determine overall status
    const overallSuccess = failedTests === 0;
    const finalStatus = overallSuccess ? 'success' : 'failed';
    const finalMessage = overallSuccess
      ? `All ${passedTests} sanity tests passed successfully`
      : `${failedTests} out of ${testResults.length} tests failed`;

    await updateStatus(
      SESSION_ID,
      finalStatus,
      finalMessage,
      undefined,
      apiMap,
      sanityTests,
      testResults,
      overallSuccess ? undefined : finalMessage
    );

    // Cleanup
    cleanupTempFiles(repoPath);

    console.log('Sanity testing completed');
    console.log(`Results: ${passedTests} passed, ${failedTests} failed`);

    if (overallSuccess) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (error) {
    console.error('Sanity tester error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateStatus(
      SESSION_ID,
      'failed',
      'Sanity testing failed',
      [errorMessage],
      undefined,
      undefined,
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
  customRootFolder?: string
): Promise<string> {
  const tmpDir = `/tmp/${sessionId}`;

  // Clean up if exists
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const git = simpleGit();
  await git.clone(repository, tmpDir, ['--branch', branch, '--single-branch', '--depth', '1']);

  // If customRootFolder is specified, adjust the path
  if (customRootFolder) {
    const projectPath = path.join(tmpDir, customRootFolder);

    // Verify the project directory exists
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Custom root folder not found: ${customRootFolder}`);
    }

    // Verify it's a directory
    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) {
      throw new Error(`Custom root folder is not a directory: ${customRootFolder}`);
    }

    return projectPath;
  }

  return tmpDir;
}

function extractBaseUrl(stackDetails: Record<string, any>): string | null {
  // Try common patterns for finding the API endpoint
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
    'apiGatewayUrl',
  ];

  // Check direct keys
  for (const key of commonKeys) {
    if (stackDetails[key] && typeof stackDetails[key] === 'string') {
      return stackDetails[key];
    }
  }

  // Check nested outputs (CloudFormation pattern)
  if (stackDetails.outputs) {
    for (const key of commonKeys) {
      if (stackDetails.outputs[key]) {
        return stackDetails.outputs[key];
      }
    }
  }

  // Check if there's a Outputs array (CDK pattern)
  if (Array.isArray(stackDetails.Outputs)) {
    for (const output of stackDetails.Outputs) {
      if (output.OutputKey && commonKeys.includes(output.OutputKey)) {
        return output.OutputValue;
      }
    }
  }

  return null;
}

async function updateStatus(
  sessionId: string,
  status: 'pending' | 'inspecting' | 'generating' | 'testing' | 'success' | 'failed',
  message?: string,
  logs?: string[],
  apiMap?: APIMap,
  sanityTests?: SanityTest[],
  testResults?: TestResult[],
  error?: string
): Promise<void> {
  // Get existing record to preserve logs
  let existingLogs: string[] = [];
  try {
    const getResult = await docClient.send(
      new GetCommand({
        TableName: DEPLOYMENTS_TABLE,
        Key: { sessionId, timestamp: 0 },
      })
    );
    if (getResult.Item && getResult.Item.logs) {
      existingLogs = getResult.Item.logs;
    }
  } catch (error) {
    console.warn('Could not fetch existing logs:', error);
  }

  const record: SanityTesterLog = {
    sessionId,
    timestamp: Date.now(),
    status,
    repository: REPOSITORY,
    branch: BRANCH,
    customRootFolder: CUSTOM_ROOT_FOLDER || undefined,
    stackDetails: STACK_DETAILS ? JSON.parse(STACK_DETAILS) : undefined,
    message,
    logs: logs || existingLogs,
    apiMap,
    sanityTests,
    testResults,
    error,
  };

  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: record,
    })
  );

  console.log(`Status updated: ${status}${message ? ` - ${message}` : ''}`);
}

async function addLog(sessionId: string, logMessage: string): Promise<void> {
  console.log(logMessage);

  // Get existing record
  const getResult = await docClient.send(
    new GetCommand({
      TableName: DEPLOYMENTS_TABLE,
      Key: { sessionId, timestamp: 0 },
    })
  );

  const existingRecord = getResult.Item as SanityTesterLog | undefined;
  if (!existingRecord) {
    console.warn('Could not find existing record to add log');
    return;
  }

  const logs = existingRecord.logs || [];
  logs.push(logMessage);

  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: {
        ...existingRecord,
        logs,
        timestamp: Date.now(),
      },
    })
  );
}

function cleanupTempFiles(repoPath: string): void {
  try {
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
      console.log('Temporary files cleaned up');
    }
  } catch (error) {
    console.error('Failed to cleanup temp files:', error);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
