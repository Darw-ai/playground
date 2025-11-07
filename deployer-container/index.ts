import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  DeleteStackCommand,
  ValidateTemplateCommand,
} from '@aws-sdk/client-cloudformation';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, CreateFunctionCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cfnClient = new CloudFormationClient({});
const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});
const iamClient = new IAMClient({});

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID!;
const AWS_REGION = process.env.AWS_REGION!;

// Container-specific environment variables (passed as overrides)
const SESSION_ID = process.env.SESSION_ID!;
const REPOSITORY = process.env.REPOSITORY!;
const BRANCH = process.env.BRANCH!;

interface DeploymentLog {
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

async function main() {
  console.log(`Starting deployment for session ${SESSION_ID}`);
  console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}`);

  try {
    await updateDeploymentStatus(SESSION_ID, 'deploying', 'Cloning repository...', [
      'Starting deployment process',
      `Cloning ${REPOSITORY} (branch: ${BRANCH})`,
    ]);

    // Clone repository
    const repoPath = await cloneRepository(SESSION_ID, REPOSITORY, BRANCH);

    await addLog(SESSION_ID, 'Repository cloned successfully');

    // Detect IaC type
    const iacType = detectIaCType(repoPath);
    await addLog(SESSION_ID, `Detected IaC type: ${iacType}`);

    // Deploy based on type
    let deployedResources: Record<string, any> = {};

    switch (iacType) {
      case 'cloudformation':
      case 'sam':
        deployedResources = await deployCloudFormation(SESSION_ID, repoPath, iacType);
        break;
      case 'simple-lambda':
        deployedResources = await deploySimpleLambda(SESSION_ID, repoPath);
        break;
      case 'cdk':
        await addLog(SESSION_ID, 'CDK projects are not yet supported. Please use CloudFormation or SAM template.');
        throw new Error('CDK deployment not yet implemented');
      case 'terraform':
        await addLog(SESSION_ID, 'Terraform projects are not yet supported. Please use CloudFormation or SAM template.');
        throw new Error('Terraform deployment not yet implemented');
      default:
        throw new Error(`Unsupported IaC type: ${iacType}`);
    }

    await updateDeploymentStatus(SESSION_ID, 'success', 'Deployment completed successfully', undefined, deployedResources);

    // Cleanup
    cleanupTempFiles(repoPath);

    console.log('Deployment completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Deployment error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateDeploymentStatus(SESSION_ID, 'failed', 'Deployment failed', [errorMessage], undefined, errorMessage);

    process.exit(1);
  }
}

async function cloneRepository(sessionId: string, repository: string, branch: string): Promise<string> {
  const tmpDir = `/tmp/${sessionId}`;

  // Clean up if exists
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const git = simpleGit();
  await git.clone(repository, tmpDir, ['--branch', branch, '--single-branch', '--depth', '1']);

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

  // Check for simple Lambda (index.js/ts, handler.js/ts, package.json)
  if (files.includes('package.json') && (files.includes('index.js') || files.includes('index.ts') || files.includes('handler.js') || files.includes('handler.ts'))) {
    return 'simple-lambda';
  }

  return 'unknown';
}

async function deployCloudFormation(sessionId: string, repoPath: string, iacType: string): Promise<Record<string, any>> {
  await addLog(sessionId, 'Preparing CloudFormation deployment');

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

  // Validate template
  await addLog(sessionId, 'Validating CloudFormation template');
  await cfnClient.send(new ValidateTemplateCommand({ TemplateBody: templateBody }));

  // Create stack
  const stackName = `lambda-deploy-${sessionId.substring(0, 8)}`;
  await addLog(sessionId, `Creating CloudFormation stack: ${stackName}`);

  await cfnClient.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      Tags: [
        { Key: 'DeploymentSessionId', Value: sessionId },
        { Key: 'ManagedBy', Value: 'GitHubLambdaDeployer' },
      ],
    })
  );

  // Wait for stack creation
  await addLog(sessionId, 'Waiting for stack creation to complete...');
  await waitForStackComplete(stackName, sessionId);

  // Get stack outputs
  const stackInfo = await cfnClient.send(new DescribeStacksCommand({ StackName: stackName }));
  const stack = stackInfo.Stacks?.[0];

  const resources: Record<string, any> = {
    stackName,
    stackId: stack?.StackId,
    outputs: stack?.Outputs?.reduce((acc, output) => {
      acc[output.OutputKey || ''] = output.OutputValue;
      return acc;
    }, {} as Record<string, any>),
  };

  await addLog(sessionId, `Stack created successfully: ${stackName}`);

  return resources;
}

async function deploySimpleLambda(sessionId: string, repoPath: string): Promise<Record<string, any>> {
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
  await addLog(sessionId, `Uploading function code to S3: ${s3Key}`);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: s3Key,
      Body: zipBuffer,
    })
  );

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

    // Attach basic execution policy
    await iamClient.send(
      new AttachRolePolicyCommand({
        RoleName: roleName,
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      })
    );

    // Wait for role to be ready
    await addLog(sessionId, 'Waiting for IAM role to propagate...');
    await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
  } catch (error: any) {
    if (error.name === 'EntityAlreadyExistsException') {
      const existingRole = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
      roleArn = existingRole.Role!.Arn!;
    } else {
      throw error;
    }
  }

  // Determine handler
  const files = fs.readdirSync(repoPath);
  let handler = 'index.handler';

  if (files.includes('handler.js') || files.includes('handler.ts')) {
    handler = 'handler.handler';
  } else if (files.includes('index.js') || files.includes('index.ts')) {
    handler = 'index.handler';
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

    return {
      functionName,
      functionArn: functionResult.FunctionArn,
      runtime: 'nodejs20.x',
      handler,
      roleArn,
    };
  } catch (error: any) {
    if (error.name === 'ResourceConflictException') {
      const existing = await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
      await addLog(sessionId, `Lambda function already exists: ${existing.Configuration?.FunctionArn}`);

      return {
        functionName,
        functionArn: existing.Configuration?.FunctionArn,
        runtime: existing.Configuration?.Runtime,
        handler: existing.Configuration?.Handler,
        roleArn,
      };
    }
    throw error;
  }
}

async function waitForStackComplete(stackName: string, sessionId: string, maxWaitTime: number = 3600000): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  while (Date.now() - startTime < maxWaitTime) {
    const result = await cfnClient.send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = result.Stacks?.[0];

    if (!stack) {
      throw new Error('Stack not found');
    }

    const status = stack.StackStatus;
    await addLog(sessionId, `Stack status: ${status}`);

    if (status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE') {
      return;
    }

    if (status?.includes('FAILED') || status?.includes('ROLLBACK')) {
      // Get error details
      const events = await cfnClient.send(
        new DescribeStackEventsCommand({
          StackName: stackName,
        })
      );

      const errorEvents = events.StackEvents?.filter((e) => e.ResourceStatus?.includes('FAILED')).slice(0, 5);

      const errorMessages = errorEvents?.map((e) => `${e.LogicalResourceId}: ${e.ResourceStatusReason}`).join('; ') || 'Unknown error';

      throw new Error(`Stack creation failed: ${errorMessages}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error('Stack creation timeout');
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

async function updateDeploymentStatus(
  sessionId: string,
  status: 'pending' | 'deploying' | 'success' | 'failed',
  message?: string,
  logs?: string[],
  deployedResources?: Record<string, any>,
  error?: string
): Promise<void> {
  const record: DeploymentLog = {
    sessionId,
    timestamp: Date.now(),
    status,
    repository: REPOSITORY,
    branch: BRANCH,
    message,
    logs,
    deployedResources,
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
        status: 'deploying',
        repository: REPOSITORY,
        branch: BRANCH,
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
