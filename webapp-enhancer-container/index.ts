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

interface EnhancerLog {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'analyzing' | 'planning' | 'enhancing' | 'success' | 'failed';
  repository: string;
  branch: string;
  customRootFolder?: string;
  message?: string;
  logs?: string[];
  analysis?: {
    techStack: string[];
    goals: string;
    currentImplementation: string;
    strengths: string[];
    weaknesses: string[];
  };
  enhancementPlan?: {
    summary: string;
    enhancements: Array<{
      category: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
      impact: string;
    }>;
    filesToModify: string[];
    filesToCreate: string[];
  };
  deploymentJob?: {
    repository: string;
    branch: string;
    customRootFolder?: string;
  };
  error?: string;
}

async function main() {
  console.log(`Starting webapp enhancer for session ${SESSION_ID}`);
  console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}${CUSTOM_ROOT_FOLDER ? `, Custom Root: ${CUSTOM_ROOT_FOLDER}` : ''}`);

  try {
    await updateEnhancerStatus(SESSION_ID, 'analyzing', 'Cloning repository...', [
      'Starting webapp enhancement process',
      `Cloning ${REPOSITORY} (branch: ${BRANCH})${CUSTOM_ROOT_FOLDER ? ` with custom root: ${CUSTOM_ROOT_FOLDER}` : ''}`,
    ]);

    // Clone repository
    const repoPath = await cloneRepository(SESSION_ID, REPOSITORY, BRANCH, CUSTOM_ROOT_FOLDER);
    await addLog(SESSION_ID, `Repository cloned successfully${CUSTOM_ROOT_FOLDER ? ` (using custom root: ${CUSTOM_ROOT_FOLDER})` : ''}`);

    // Analyze webapp structure
    await addLog(SESSION_ID, 'Analyzing webapp structure and tech stack...');
    const webappContext = await analyzeWebappStructure(repoPath);
    await addLog(SESSION_ID, `Detected tech stack: ${webappContext.detectedFiles.join(', ')}`);

    // Create AI client
    const aiClient = new AIClient(ANTHROPIC_API_KEY);

    // Analyze webapp with AI
    await addLog(SESSION_ID, 'Understanding webapp goals and implementation...');
    const analysis = await aiClient.analyzeWebapp(webappContext);
    await addLog(SESSION_ID, `Webapp analysis complete: ${analysis.goals}`);
    await addLog(SESSION_ID, `Tech stack: ${analysis.techStack.join(', ')}`);

    // Update status with analysis
    await updateEnhancerStatus(SESSION_ID, 'planning', 'Creating enhancement plan...', undefined, analysis);

    // Create enhancement plan
    await addLog(SESSION_ID, 'Creating enhancement plan...');
    const enhancementPlan = await aiClient.createEnhancementPlan(analysis, webappContext);
    await addLog(SESSION_ID, `Enhancement plan created: ${enhancementPlan.summary}`);
    await addLog(SESSION_ID, `Enhancements planned: ${enhancementPlan.enhancements.length} items`);

    // Update status with enhancement plan
    await updateEnhancerStatus(SESSION_ID, 'enhancing', 'Implementing enhancements...', undefined, analysis, enhancementPlan);

    // Read files that need to be modified
    const fileContents = new Map<string, string>();
    for (const filePath of enhancementPlan.filesToModify) {
      const fullPath = path.join(repoPath, filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        fileContents.set(filePath, content);
      } else {
        console.warn(`File not found: ${filePath}, will be skipped`);
      }
    }

    // Implement enhancements using AI
    await addLog(SESSION_ID, 'Implementing enhancements with AI...');
    const { modifiedFiles, newFiles } = await aiClient.implementEnhancements(
      analysis,
      enhancementPlan,
      fileContents,
      webappContext
    );

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

    // Write new files
    for (const [filePath, content] of newFiles.entries()) {
      const fullPath = path.join(repoPath, filePath);
      const dirPath = path.dirname(fullPath);

      // Create directory if it doesn't exist
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf-8');
      await addLog(SESSION_ID, `Created: ${filePath}`);
    }

    // Create new enhancement branch and push
    const enhancementBranchName = `enhancement/${SESSION_ID}`;
    await addLog(SESSION_ID, `Creating enhancement branch: ${enhancementBranchName}`);

    const git = simpleGit(repoPath);

    // Configure git
    await git.addConfig('user.name', 'Webapp Enhancer Bot');
    await git.addConfig('user.email', 'enhancer@automated-enhancement.com');

    // Create new branch from current branch
    await git.checkoutBranch(enhancementBranchName, BRANCH);

    // Stage all changes
    await git.add('.');

    // Commit changes
    const commitMessage = `Webapp enhancements: ${enhancementPlan.summary}\n\nSession: ${SESSION_ID}\n\nEnhancements:\n${enhancementPlan.enhancements.map((e, i) => `${i + 1}. [${e.category}] ${e.description}`).join('\n')}`;
    await git.commit(commitMessage);

    // Push to remote
    await addLog(SESSION_ID, `Pushing to remote branch: ${enhancementBranchName}`);
    await git.push('origin', enhancementBranchName, ['--set-upstream']);

    await addLog(SESSION_ID, `Enhancement branch pushed successfully: ${enhancementBranchName}`);

    // Create deployment job
    const deploymentJob = {
      repository: REPOSITORY,
      branch: enhancementBranchName,
      customRootFolder: CUSTOM_ROOT_FOLDER || undefined,
    };

    await updateEnhancerStatus(SESSION_ID, 'success', 'Enhancements completed successfully', undefined, analysis, enhancementPlan, deploymentJob);
    await addLog(SESSION_ID, 'Deployment job created');

    // Cleanup
    cleanupTempFiles(repoPath);

    console.log('Webapp enhancement completed successfully');
    console.log('Deployment Job:', JSON.stringify(deploymentJob, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Webapp enhancer error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateEnhancerStatus(SESSION_ID, 'failed', 'Enhancement failed', [errorMessage], undefined, undefined, undefined, errorMessage);

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

interface WebappContext {
  rootPath: string;
  detectedFiles: string[];
  fileTree: string;
  packageJson?: any;
  htmlFiles: string[];
  cssFiles: string[];
  jsFiles: string[];
  configFiles: string[];
  hasFrontend: boolean;
  hasBackend: boolean;
}

async function analyzeWebappStructure(repoPath: string): Promise<WebappContext> {
  const files = getAllFiles(repoPath);
  const relativeFiles = files.map((f) => path.relative(repoPath, f));

  const detectedFiles: string[] = [];
  const htmlFiles: string[] = [];
  const cssFiles: string[] = [];
  const jsFiles: string[] = [];
  const configFiles: string[] = [];

  // Detect tech stack files
  relativeFiles.forEach((file) => {
    const fileName = path.basename(file);
    const ext = path.extname(file);

    // Config files
    if (['package.json', 'package-lock.json', 'yarn.lock', 'tsconfig.json', 'webpack.config.js', 'vite.config.js', 'next.config.js', 'tailwind.config.js', '.env', '.env.example'].includes(fileName)) {
      detectedFiles.push(fileName);
      configFiles.push(file);
    }

    // HTML files
    if (ext === '.html') {
      htmlFiles.push(file);
    }

    // CSS files
    if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
      cssFiles.push(file);
    }

    // JS/TS files
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs'].includes(ext)) {
      jsFiles.push(file);
    }
  });

  // Read package.json if exists
  let packageJson: any = undefined;
  const packageJsonPath = path.join(repoPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    } catch (error) {
      console.warn('Failed to parse package.json');
    }
  }

  // Determine if it's a frontend or backend app
  const hasFrontend = htmlFiles.length > 0 || cssFiles.length > 0 ||
    (packageJson?.dependencies && (
      packageJson.dependencies.react ||
      packageJson.dependencies.vue ||
      packageJson.dependencies.angular ||
      packageJson.dependencies.svelte ||
      packageJson.dependencies.next
    ));

  const hasBackend = packageJson?.dependencies && (
    packageJson.dependencies.express ||
    packageJson.dependencies.koa ||
    packageJson.dependencies.fastify ||
    packageJson.dependencies['@nestjs/core']
  );

  return {
    rootPath: repoPath,
    detectedFiles,
    fileTree: relativeFiles.slice(0, 100).join('\n'), // Limit to first 100 files
    packageJson,
    htmlFiles,
    cssFiles,
    jsFiles,
    configFiles,
    hasFrontend,
    hasBackend,
  };
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);

    // Skip .git directory, node_modules, and common build directories
    if (['.git', 'node_modules', 'dist', 'build', '.next', 'out'].includes(file)) {
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

async function updateEnhancerStatus(
  sessionId: string,
  status: 'pending' | 'analyzing' | 'planning' | 'enhancing' | 'success' | 'failed',
  message?: string,
  logs?: string[],
  analysis?: {
    techStack: string[];
    goals: string;
    currentImplementation: string;
    strengths: string[];
    weaknesses: string[];
  },
  enhancementPlan?: {
    summary: string;
    enhancements: Array<{
      category: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
      impact: string;
    }>;
    filesToModify: string[];
    filesToCreate: string[];
  },
  deploymentJob?: {
    repository: string;
    branch: string;
    customRootFolder?: string;
  },
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

  const record: EnhancerLog = {
    sessionId,
    timestamp: Date.now(),
    status,
    repository: REPOSITORY,
    branch: BRANCH,
    customRootFolder: CUSTOM_ROOT_FOLDER || undefined,
    message,
    logs: logs || existingLogs,
    analysis,
    enhancementPlan,
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

  const existingRecord = getResult.Item as EnhancerLog | undefined;
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
