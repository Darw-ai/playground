import { SQSEvent, SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const NEXT_QUEUE_URL = process.env.NEXT_QUEUE_URL!;

interface DeployJob {
  sessionId: string;
  repository: string;
  branch: string;
  projectRoot?: string;
}

interface DeployResult {
  sessionId: string;
  repository: string;
  branch: string;
  projectRoot?: string;
  iacType: string;
  repoS3Key: string;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const job: DeployJob = JSON.parse(record.body);
    console.log('Processing deploy job:', job);

    try {
      await updateStatus(job.sessionId, 'deploying', 'Cloning repository...');

      // Clone repository
      const repoPath = await cloneRepository(job.sessionId, job.repository, job.branch, job.projectRoot);
      await addLog(job.sessionId, `Repository cloned successfully${job.projectRoot ? ` (project root: ${job.projectRoot})` : ''}`);

      // Detect IaC type
      const iacType = detectIaCType(repoPath);
      await addLog(job.sessionId, `Detected IaC type: ${iacType}`);

      // Package repository and upload to S3
      await addLog(job.sessionId, 'Packaging repository...');
      const repoS3Key = await packageAndUploadRepo(job.sessionId, repoPath);
      await addLog(job.sessionId, `Repository uploaded to S3: ${repoS3Key}`);

      // Cleanup local files
      cleanupTempFiles(repoPath);

      // Send to next queue based on IaC type
      const result: DeployResult = {
        sessionId: job.sessionId,
        repository: job.repository,
        branch: job.branch,
        projectRoot: job.projectRoot,
        iacType,
        repoS3Key,
      };

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: NEXT_QUEUE_URL,
          MessageBody: JSON.stringify(result),
        })
      );

      await addLog(job.sessionId, 'Forwarded to build/package stage');
    } catch (error) {
      console.error('Error processing job:', error);
      await updateStatus(
        job.sessionId,
        'failed',
        'Clone/detect failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
};

async function cloneRepository(
  sessionId: string,
  repository: string,
  branch: string,
  projectRoot?: string
): Promise<string> {
  const tmpDir = `/tmp/${sessionId}`;

  // Clean up if exists
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const git = simpleGit();
  await git.clone(repository, tmpDir, ['--branch', branch, '--single-branch', '--depth', '1']);

  // If projectRoot is specified, adjust the path
  if (projectRoot) {
    const projectPath = path.join(tmpDir, projectRoot);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project root directory not found: ${projectRoot}`);
    }

    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) {
      throw new Error(`Project root is not a directory: ${projectRoot}`);
    }

    return projectPath;
  }

  return tmpDir;
}

function detectIaCType(repoPath: string): string {
  const files = fs.readdirSync(repoPath);

  // Check for SAM template
  if (files.includes('template.yaml') || files.includes('template.yml')) {
    const templatePath = files.includes('template.yaml')
      ? path.join(repoPath, 'template.yaml')
      : path.join(repoPath, 'template.yml');
    const content = fs.readFileSync(templatePath, 'utf-8');
    if (content.includes('Transform: AWS::Serverless') || content.includes('AWS::Serverless::Function')) {
      return 'sam';
    }
    return 'cloudformation';
  }

  // Check for CloudFormation
  if (files.includes('cloudformation.yaml') || files.includes('cloudformation.yml') || files.includes('stack.yaml')) {
    return 'cloudformation';
  }

  // Check for CDK
  if (files.includes('cdk.json')) {
    return 'cdk';
  }

  // Check for Terraform
  if (files.some((f) => f.endsWith('.tf'))) {
    return 'terraform';
  }

  // Check for Serverless Framework
  if (files.includes('serverless.yml') || files.includes('serverless.yaml')) {
    return 'serverless';
  }

  // Check for simple Lambda
  if (
    files.includes('package.json') &&
    (files.includes('index.js') || files.includes('index.ts') || files.includes('handler.js') || files.includes('handler.ts'))
  ) {
    return 'simple-lambda';
  }

  return 'unknown';
}

async function packageAndUploadRepo(sessionId: string, repoPath: string): Promise<string> {
  const tarPath = `/tmp/${sessionId}.tar.gz`;
  const s3Key = `deployments/${sessionId}/repo.tar.gz`;

  // Create tarball
  await tar.create(
    {
      gzip: true,
      file: tarPath,
      cwd: repoPath,
    },
    ['.']
  );

  // Upload to S3
  const fileContent = fs.readFileSync(tarPath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: s3Key,
      Body: fileContent,
    })
  );

  // Cleanup tar file
  fs.rmSync(tarPath, { force: true });

  return s3Key;
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
        status: 'deploying',
        logs: [logMessage],
      },
    })
  );
}
