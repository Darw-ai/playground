import { SQSEvent, SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand } from '@aws-sdk/client-lambda';
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import * as yaml from 'js-yaml';
import AdmZip from 'adm-zip';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const cfnClient = new CloudFormationClient({});
const lambdaClient = new LambdaClient({});
const iamClient = new IAMClient({});

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const MONITOR_QUEUE_URL = process.env.MONITOR_QUEUE_URL!;
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID!;
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION!;

interface DeployJob {
  sessionId: string;
  repository: string;
  branch: string;
  projectRoot?: string;
  iacType: string;
  repoS3Key: string;
}

interface MonitorJob {
  sessionId: string;
  stackName?: string;
  functionName?: string;
  deploymentType: string;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const job: DeployJob = JSON.parse(record.body);
    console.log('Processing deploy job:', job);

    try {
      await addLog(job.sessionId, `Starting deployment for IaC type: ${job.iacType}`);

      // Download and extract repository
      const repoPath = await downloadAndExtractRepo(job.sessionId, job.repoS3Key);

      let monitorJob: MonitorJob;

      // Deploy based on IaC type
      switch (job.iacType) {
        case 'simple-lambda':
          monitorJob = await deploySimpleLambda(job.sessionId, repoPath);
          break;
        case 'cloudformation':
        case 'sam':
          monitorJob = await deployCloudFormation(job.sessionId, repoPath, job.iacType);
          break;
        case 'cdk':
        case 'terraform':
        case 'serverless':
          // These require external CLI tools - log message for now
          await addLog(
            job.sessionId,
            `NOTE: ${job.iacType} deployments require external CLI tools. Consider using Lambda layers or AWS CodeBuild for complex builds.`
          );
          throw new Error(`${job.iacType} deployment not yet fully implemented in Lambda. Use simpler IaC types or Lambda layers.`);
        default:
          throw new Error(`Unsupported IaC type: ${job.iacType}`);
      }

      // Cleanup
      cleanupTempFiles(repoPath);

      // Send to monitor queue
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: MONITOR_QUEUE_URL,
          MessageBody: JSON.stringify(monitorJob),
        })
      );

      await addLog(job.sessionId, 'Deployment initiated, forwarded to monitor');
    } catch (error) {
      console.error('Error processing deploy job:', error);
      await updateStatus(
        job.sessionId,
        'failed',
        'Deployment failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
};

async function downloadAndExtractRepo(sessionId: string, s3Key: string): Promise<string> {
  const tmpDir = `/tmp/${sessionId}`;
  const tarPath = `/tmp/${sessionId}.tar.gz`;

  // Download from S3
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: s3Key,
    })
  );

  // Write to file
  const fileContent = await response.Body!.transformToByteArray();
  fs.writeFileSync(tarPath, fileContent);

  // Extract
  fs.mkdirSync(tmpDir, { recursive: true });
  await tar.extract({
    file: tarPath,
    cwd: tmpDir,
  });

  // Cleanup tar file
  fs.rmSync(tarPath, { force: true });

  return tmpDir;
}

async function deploySimpleLambda(sessionId: string, repoPath: string): Promise<MonitorJob> {
  await addLog(sessionId, 'Deploying simple Lambda function');

  // Create ZIP file
  const zip = new AdmZip();
  const files = fs.readdirSync(repoPath);

  for (const file of files) {
    const filePath = path.join(repoPath, file);
    const stat = fs.statSync(filePath);

    if (stat.isFile() && file !== '.git') {
      zip.addLocalFile(filePath);
    } else if (stat.isDirectory() && file !== '.git' && file !== 'node_modules') {
      zip.addLocalFolder(filePath, file);
    }
  }

  const zipBuffer = zip.toBuffer();

  // Upload to S3
  const s3Key = `deployments/${sessionId}/function.zip`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: s3Key,
      Body: zipBuffer,
    })
  );

  await addLog(sessionId, `Function code uploaded to S3: ${s3Key}`);

  // Create Lambda execution role
  const roleName = `lambda-role-${sessionId.substring(0, 8)}`;
  await addLog(sessionId, `Creating IAM role: ${roleName}`);

  let roleArn: string;

  try {
    const roleResult = await iamClient.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
        Tags: [
          { Key: 'DeploymentSessionId', Value: sessionId },
          { Key: 'ManagedBy', Value: 'GitHubLambdaDeployer' },
        ],
      })
    );
    roleArn = roleResult.Role!.Arn!;

    await iamClient.send(
      new AttachRolePolicyCommand({
        RoleName: roleName,
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      })
    );

    await addLog(sessionId, 'Waiting for IAM role to propagate...');
    await new Promise((resolve) => setTimeout(resolve, 10000));
  } catch (error: any) {
    if (error.name === 'EntityAlreadyExistsException') {
      const existingRole = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
      roleArn = existingRole.Role!.Arn!;
    } else {
      throw error;
    }
  }

  // Determine handler
  const projectFiles = fs.readdirSync(repoPath);
  let handler = 'index.handler';

  if (projectFiles.includes('handler.js') || projectFiles.includes('handler.ts')) {
    handler = 'handler.handler';
  }

  // Create Lambda function
  const functionName = `deployed-lambda-${sessionId.substring(0, 8)}`;
  await addLog(sessionId, `Creating Lambda function: ${functionName}`);

  try {
    const functionResult = await lambdaClient.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Runtime: 'nodejs20.x',
        Role: roleArn,
        Handler: handler,
        Code: {
          S3Bucket: ARTIFACTS_BUCKET,
          S3Key: s3Key,
        },
        Timeout: 30,
        MemorySize: 256,
        Tags: {
          DeploymentSessionId: sessionId,
          ManagedBy: 'GitHubLambdaDeployer',
        },
      })
    );

    await addLog(sessionId, `Lambda function created: ${functionResult.FunctionArn}`);

    // Store deployed resources
    await updateStatus(sessionId, 'success', 'Deployment completed successfully');
    await docClient.send(
      new PutCommand({
        TableName: DEPLOYMENTS_TABLE,
        Item: {
          sessionId,
          timestamp: Date.now(),
          deployedResources: {
            functionName,
            functionArn: functionResult.FunctionArn,
            runtime: 'nodejs20.x',
            handler,
            roleArn,
          },
        },
      })
    );
  } catch (error: any) {
    if (error.name === 'ResourceConflictException') {
      await addLog(sessionId, `Function ${functionName} already exists, updating code...`);
      await lambdaClient.send(
        new UpdateFunctionCodeCommand({
          FunctionName: functionName,
          S3Bucket: ARTIFACTS_BUCKET,
          S3Key: s3Key,
        })
      );
      await addLog(sessionId, 'Function code updated successfully');
      await updateStatus(sessionId, 'success', 'Deployment completed successfully (updated)');
    } else {
      throw error;
    }
  }

  return {
    sessionId,
    functionName,
    deploymentType: 'simple-lambda',
  };
}

async function deployCloudFormation(sessionId: string, repoPath: string, iacType: string): Promise<MonitorJob> {
  await addLog(sessionId, 'Deploying CloudFormation stack');

  // Find template file
  const templateFiles = ['template.yaml', 'template.yml', 'cloudformation.yaml', 'cloudformation.yml', 'stack.yaml'];
  let templatePath = '';

  for (const file of templateFiles) {
    const fullPath = path.join(repoPath, file);
    if (fs.existsSync(fullPath)) {
      templatePath = fullPath;
      break;
    }
  }

  if (!templatePath) {
    throw new Error('No CloudFormation template found');
  }

  const templateBody = fs.readFileSync(templatePath, 'utf-8');

  // For SAM templates, we need to package functions first
  if (iacType === 'sam') {
    await addLog(sessionId, 'Detected SAM template - packaging functions...');
    const { template, functions } = await parseSamTemplate(templatePath);

    // Package and upload each function
    const s3UriMap: Record<string, string> = {};

    for (const func of functions) {
      const codeDir = path.join(repoPath, func.codeUri);
      await addLog(sessionId, `Packaging ${func.logicalId}...`);

      const zipBuffer = zipDirectory(codeDir);
      const s3Uri = await uploadFunctionToS3(sessionId, zipBuffer, func.logicalId);

      s3UriMap[func.logicalId] = s3Uri;
      await addLog(sessionId, `Uploaded ${func.logicalId} to ${s3Uri}`);
    }

    // Transform template
    const transformedTemplate = transformSamTemplate(template, s3UriMap);
    fs.writeFileSync(templatePath, transformedTemplate);
  }

  // Create stack
  const stackName = `lambda-deploy-${sessionId.substring(0, 8)}`;
  await addLog(sessionId, `Creating CloudFormation stack: ${stackName}`);

  await cfnClient.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: fs.readFileSync(templatePath, 'utf-8'),
      Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      Tags: [
        { Key: 'DeploymentSessionId', Value: sessionId },
        { Key: 'ManagedBy', Value: 'GitHubLambdaDeployer' },
      ],
    })
  );

  await addLog(sessionId, 'CloudFormation stack creation initiated');

  return {
    sessionId,
    stackName,
    deploymentType: 'cloudformation',
  };
}

async function parseSamTemplate(
  templatePath: string
): Promise<{ template: any; functions: Array<{ logicalId: string; codeUri: string }> }> {
  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  const template = yaml.load(templateContent) as any;

  const functions: Array<{ logicalId: string; codeUri: string }> = [];

  if (template.Resources) {
    for (const [logicalId, resource] of Object.entries(template.Resources)) {
      const res = resource as any;
      if (res.Type === 'AWS::Serverless::Function' && res.Properties?.CodeUri) {
        const codeUri = res.Properties.CodeUri;
        if (typeof codeUri === 'string' && !codeUri.startsWith('s3://')) {
          functions.push({ logicalId, codeUri });
        }
      }
    }
  }

  return { template, functions };
}

function zipDirectory(sourceDir: string): Buffer {
  const zip = new AdmZip();

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const files = fs.readdirSync(sourceDir);

  for (const file of files) {
    const filePath = path.join(sourceDir, file);
    const stat = fs.statSync(filePath);

    if (file === '.git' || file === '__pycache__' || file === '.pytest_cache') {
      continue;
    }

    if (stat.isFile()) {
      zip.addLocalFile(filePath);
    } else if (stat.isDirectory()) {
      zip.addLocalFolder(filePath, file);
    }
  }

  return zip.toBuffer();
}

async function uploadFunctionToS3(sessionId: string, zipBuffer: Buffer, functionLogicalId: string): Promise<string> {
  const s3Key = `deployments/${sessionId}/functions/${functionLogicalId}.zip`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: s3Key,
      Body: zipBuffer,
    })
  );

  return `s3://${ARTIFACTS_BUCKET}/${s3Key}`;
}

function transformSamTemplate(template: any, s3UriMap: Record<string, string>): string {
  const transformedTemplate = JSON.parse(JSON.stringify(template));

  if (transformedTemplate.Resources) {
    for (const [logicalId, resource] of Object.entries(transformedTemplate.Resources)) {
      const res = resource as any;
      if (res.Type === 'AWS::Serverless::Function' && s3UriMap[logicalId]) {
        res.Properties.CodeUri = s3UriMap[logicalId];
      }
    }
  }

  return yaml.dump(transformedTemplate);
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
