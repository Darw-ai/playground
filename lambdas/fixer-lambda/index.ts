import { SQSEvent, SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import Anthropic from '@anthropic-ai/sdk';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

interface FixJob {
  sessionId: string;
  repository: string;
  branch: string;
  customRootFolder?: string;
  fixInstructions: string;
  stackDetails?: Record<string, any>;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const job: FixJob = JSON.parse(record.body);
    console.log('Processing fix job:', job);

    try {
      await updateStatus(job.sessionId, 'planning', 'Analyzing code and creating fix plan...');

      // Clone repository
      const repoPath = await cloneRepository(job.sessionId, job.repository, job.branch, job.customRootFolder);
      await addLog(job.sessionId, 'Repository cloned successfully');

      // Get repository context
      const repoContext = getRepositoryContext(repoPath);

      // Create fix plan using AI
      await addLog(job.sessionId, 'Creating fix plan with AI...');
      const fixPlan = await createFixPlan(job.fixInstructions, repoContext, job.stackDetails);
      await addLog(job.sessionId, `Fix plan created: ${fixPlan.summary}`);

      // Implement fixes
      await updateStatus(job.sessionId, 'fixing', 'Implementing fixes...');
      const modifiedFiles = await implementFixes(job.fixInstructions, fixPlan, repoPath);
      await addLog(job.sessionId, `Modified ${modifiedFiles.length} files`);

      // Write modified files
      for (const { filePath, content } of modifiedFiles) {
        const fullPath = path.join(repoPath, filePath);
        const dirPath = path.dirname(fullPath);

        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        fs.writeFileSync(fullPath, content, 'utf-8');
        await addLog(job.sessionId, `Modified: ${filePath}`);
      }

      // Create fix branch and push
      const fixBranchName = `fix/${job.sessionId}`;
      await addLog(job.sessionId, `Creating fix branch: ${fixBranchName}`);

      const git = simpleGit(repoPath);
      await git.addConfig('user.name', 'Fixer Bot');
      await git.addConfig('user.email', 'fixer@automated-fix.com');
      await git.checkoutBranch(fixBranchName, job.branch);
      await git.add('.');

      const commitMessage = `Automated fix: ${fixPlan.summary}\n\nSession: ${job.sessionId}\nInstructions: ${job.fixInstructions}`;
      await git.commit(commitMessage);

      await addLog(job.sessionId, 'Pushing to remote...');
      await git.push('origin', fixBranchName, ['--set-upstream']);

      // Create deployment job
      const deploymentJob = {
        repository: job.repository,
        branch: fixBranchName,
        customRootFolder: job.customRootFolder,
        stackDetails: job.stackDetails,
      };

      await docClient.send(
        new PutCommand({
          TableName: DEPLOYMENTS_TABLE,
          Item: {
            sessionId: job.sessionId,
            timestamp: Date.now(),
            status: 'success',
            message: 'Fix completed successfully',
            fixPlan,
            deploymentJob,
          },
        })
      );

      // Cleanup
      cleanupTempFiles(repoPath);

      await addLog(job.sessionId, 'Fix completed successfully');
    } catch (error) {
      console.error('Error processing fix job:', error);
      await updateStatus(
        job.sessionId,
        'failed',
        'Fix failed',
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
  const fileList = files.map((f) => path.relative(repoPath, f)).join('\n');
  return `Repository structure:\n${fileList}\n\nTotal files: ${files.length}`;
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

async function createFixPlan(
  fixInstructions: string,
  repoContext: string,
  stackDetails?: Record<string, any>
): Promise<any> {
  const prompt = `You are an expert code fixer. Analyze the following issue and create a detailed fix plan.

Fix Instructions: ${fixInstructions}

Repository Context:
${repoContext}

${stackDetails ? `Stack Details: ${JSON.stringify(stackDetails, null, 2)}` : ''}

Create a fix plan with:
1. Summary of the issue
2. List of files to modify
3. Step-by-step fix approach

Return ONLY valid JSON in this format:
{
  "summary": "Brief description of the fix",
  "filesToModify": ["file1.ts", "file2.js"],
  "steps": ["Step 1", "Step 2", "Step 3"]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from AI');
  }

  return JSON.parse(content.text);
}

async function implementFixes(
  fixInstructions: string,
  fixPlan: any,
  repoPath: string
): Promise<Array<{ filePath: string; content: string }>> {
  const modifiedFiles: Array<{ filePath: string; content: string }> = [];

  for (const filePath of fixPlan.filesToModify) {
    const fullPath = path.join(repoPath, filePath);
    const originalContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';

    const prompt = `You are an expert code fixer. Implement the following fix:

Fix Instructions: ${fixInstructions}

Fix Plan Summary: ${fixPlan.summary}

File to modify: ${filePath}

Original content:
\`\`\`
${originalContent}
\`\`\`

Return ONLY the complete modified file content, no explanations or markdown formatting.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from AI');
    }

    modifiedFiles.push({
      filePath,
      content: content.text,
    });
  }

  return modifiedFiles;
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
        status: 'fixing',
        logs: [logMessage],
      },
    })
  );
}
