import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { AIClient } from './ai-client';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

// Container-specific environment variables (passed as overrides)
const SESSION_ID = process.env.SESSION_ID!;
const REPOSITORY = process.env.REPOSITORY!;
const BRANCH = process.env.BRANCH!;
const CUSTOM_ROOT_FOLDER = process.env.CUSTOM_ROOT_FOLDER || '';
const FIX_INSTRUCTIONS = process.env.FIX_INSTRUCTIONS!;
const STACK_DETAILS = process.env.STACK_DETAILS || '';

interface FixerLog {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'planning' | 'fixing' | 'success' | 'failed';
  repository: string;
  branch: string;
  customRootFolder?: string;
  fixInstructions: string;
  stackDetails?: Record<string, any>;
  message?: string;
  logs?: string[];
  fixPlan?: {
    summary: string;
    steps: string[];
    filesToModify: string[];
  };
  deploymentJob?: {
    repository: string;
    branch: string;
    customRootFolder?: string;
    stackDetails?: Record<string, any>;
  };
  error?: string;
}

async function main() {
  console.log(`Starting fixer for session ${SESSION_ID}`);
  console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}${CUSTOM_ROOT_FOLDER ? `, Custom Root: ${CUSTOM_ROOT_FOLDER}` : ''}`);
  console.log(`Fix Instructions: ${FIX_INSTRUCTIONS}`);

  try {
    await updateFixerStatus(SESSION_ID, 'planning', 'Cloning repository...', [
      'Starting fix process',
      `Cloning ${REPOSITORY} (branch: ${BRANCH})${CUSTOM_ROOT_FOLDER ? ` with custom root: ${CUSTOM_ROOT_FOLDER}` : ''}`,
    ]);

    // Clone repository
    const repoPath = await cloneRepository(SESSION_ID, REPOSITORY, BRANCH, CUSTOM_ROOT_FOLDER);
    await addLog(SESSION_ID, `Repository cloned successfully${CUSTOM_ROOT_FOLDER ? ` (using custom root: ${CUSTOM_ROOT_FOLDER})` : ''}`);

    // Parse stack details if provided
    let stackDetails: Record<string, any> | undefined;
    if (STACK_DETAILS) {
      try {
        stackDetails = JSON.parse(STACK_DETAILS);
      } catch (error) {
        console.warn('Failed to parse stack details, continuing without them');
      }
    }

    // Get repository context (list files)
    const repoContext = getRepositoryContext(repoPath);
    await addLog(SESSION_ID, 'Analyzing repository structure...');

    // Create fix plan using AI
    const aiClient = new AIClient(ANTHROPIC_API_KEY);
    await addLog(SESSION_ID, 'Creating fix plan with AI...');

    const fixPlan = await aiClient.createFixPlan(FIX_INSTRUCTIONS, repoContext, stackDetails);
    await addLog(SESSION_ID, `Fix plan created: ${fixPlan.summary}`);
    await addLog(SESSION_ID, `Files to modify: ${fixPlan.filesToModify.join(', ')}`);

    // Update status with fix plan
    await updateFixerStatus(SESSION_ID, 'fixing', 'Implementing fix...', undefined, fixPlan);

    // Read files that need to be modified
    const fileContents = new Map<string, string>();
    for (const filePath of fixPlan.filesToModify) {
      const fullPath = path.join(repoPath, filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        fileContents.set(filePath, content);
      } else {
        console.warn(`File not found: ${filePath}, will be created`);
        fileContents.set(filePath, '');
      }
    }

    // Implement fix using AI
    await addLog(SESSION_ID, 'Implementing fix with AI...');
    const modifiedFiles = await aiClient.implementFix(FIX_INSTRUCTIONS, fixPlan, fileContents, stackDetails);

    // Write modified files
    for (const [filePath, content] of modifiedFiles.entries()) {
      const fullPath = path.join(repoPath, filePath);
      const dirPath = path.dirname(fullPath);

      // Create directory if it doesn't exist
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf-8');
      await addLog(SESSION_ID, `Modified: ${filePath}`);
    }

    // Create new fix branch and push
    const fixBranchName = `fix/${SESSION_ID}`;
    await addLog(SESSION_ID, `Creating fix branch: ${fixBranchName}`);

    const git = simpleGit(repoPath);

    // Configure git
    await git.addConfig('user.name', 'Fixer Bot');
    await git.addConfig('user.email', 'fixer@automated-fix.com');

    // Create new branch from current branch
    await git.checkoutBranch(fixBranchName, BRANCH);

    // Stage all changes
    await git.add('.');

    // Commit changes
    const commitMessage = `Automated fix: ${fixPlan.summary}\n\nSession: ${SESSION_ID}\nInstructions: ${FIX_INSTRUCTIONS}`;
    await git.commit(commitMessage);

    // Push to remote
    await addLog(SESSION_ID, `Pushing to remote branch: ${fixBranchName}`);
    await git.push('origin', fixBranchName, ['--set-upstream']);

    await addLog(SESSION_ID, `Fix branch pushed successfully: ${fixBranchName}`);

    // Create deployment job
    const deploymentJob = {
      repository: REPOSITORY,
      branch: fixBranchName,
      customRootFolder: CUSTOM_ROOT_FOLDER || undefined,
      stackDetails: stackDetails,
    };

    await updateFixerStatus(SESSION_ID, 'success', 'Fix completed successfully', undefined, fixPlan, deploymentJob);
    await addLog(SESSION_ID, 'Deployment job created');

    // Cleanup
    cleanupTempFiles(repoPath);

    console.log('Fix completed successfully');
    console.log('Deployment Job:', JSON.stringify(deploymentJob, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Fixer error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateFixerStatus(SESSION_ID, 'failed', 'Fix failed', [errorMessage], undefined, undefined, errorMessage);

    process.exit(1);
  }
}

async function cloneRepository(sessionId: string, repository: string, branch: string, customRootFolder?: string): Promise<string> {
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

function getRepositoryContext(repoPath: string): string {
  const files = getAllFiles(repoPath);
  const fileList = files.map((f) => path.relative(repoPath, f)).join('\n');

  return `Repository structure:\n${fileList}\n\nTotal files: ${files.length}`;
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);

    // Skip .git directory and node_modules
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

async function updateFixerStatus(
  sessionId: string,
  status: 'pending' | 'planning' | 'fixing' | 'success' | 'failed',
  message?: string,
  logs?: string[],
  fixPlan?: { summary: string; steps: string[]; filesToModify: string[] },
  deploymentJob?: { repository: string; branch: string; customRootFolder?: string; stackDetails?: Record<string, any> },
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

  const record: FixerLog = {
    sessionId,
    timestamp: Date.now(),
    status,
    repository: REPOSITORY,
    branch: BRANCH,
    customRootFolder: CUSTOM_ROOT_FOLDER || undefined,
    fixInstructions: FIX_INSTRUCTIONS,
    stackDetails: STACK_DETAILS ? JSON.parse(STACK_DETAILS) : undefined,
    message,
    logs: logs || existingLogs,
    fixPlan,
    deploymentJob,
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

  const existingRecord = getResult.Item as FixerLog | undefined;
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
