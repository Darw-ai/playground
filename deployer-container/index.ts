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
import * as yaml from 'js-yaml';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
const PROJECT_ROOT = process.env.PROJECT_ROOT || '';

interface DeploymentLog {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  repository: string;
  branch: string;
  projectRoot?: string;
  message?: string;
  logs?: string[];
  deployedResources?: Record<string, any>;
  error?: string;
}

async function main() {
  console.log(`Starting deployment for session ${SESSION_ID}`);
  console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}${PROJECT_ROOT ? `, Project Root: ${PROJECT_ROOT}` : ''}`);

  try {
    await updateDeploymentStatus(SESSION_ID, 'deploying', 'Cloning repository...', [
      'Starting deployment process',
      `Cloning ${REPOSITORY} (branch: ${BRANCH})${PROJECT_ROOT ? ` with project root: ${PROJECT_ROOT}` : ''}`,
    ]);

    // Clone repository
    const repoPath = await cloneRepository(SESSION_ID, REPOSITORY, BRANCH, PROJECT_ROOT);

    await addLog(SESSION_ID, `Repository cloned successfully${PROJECT_ROOT ? ` (using project root: ${PROJECT_ROOT})` : ''}`);

    // Detect IaC type
    const iacType = detectIaCType(repoPath);
    await addLog(SESSION_ID, `Detected IaC type: ${iacType}`);

    // Deploy based on type
    let deployedResources: Record<string, any> = {};

    switch (iacType) {
      case 'serverless':
        deployedResources = await deployServerless(SESSION_ID, repoPath);
        break;
      case 'sam':
        deployedResources = await deploySamCli(SESSION_ID, repoPath);
        break;
      case 'cdk':
        deployedResources = await deployCdk(SESSION_ID, repoPath);
        break;
      case 'terraform':
        deployedResources = await deployTerraform(SESSION_ID, repoPath);
        break;
      case 'cloudformation':
        deployedResources = await deployCloudFormation(SESSION_ID, repoPath, iacType);
        break;
      case 'simple-lambda':
        deployedResources = await deploySimpleLambda(SESSION_ID, repoPath);
        break;
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

async function cloneRepository(sessionId: string, repository: string, branch: string, projectRoot?: string): Promise<string> {
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

    // Verify the project directory exists
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project root directory not found: ${projectRoot}`);
    }

    // Verify it's a directory
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

  // Check for simple Lambda (index.js/ts, handler.js/ts, package.json)
  if (files.includes('package.json') && (files.includes('index.js') || files.includes('index.ts') || files.includes('handler.js') || files.includes('handler.ts'))) {
    return 'simple-lambda';
  }

  return 'unknown';
}

// Deploy using Serverless Framework
async function deployServerless(sessionId: string, repoPath: string): Promise<Record<string, any>> {
  await addLog(sessionId, 'Deploying with Serverless Framework');

  // Install dependencies if package.json exists
  if (fs.existsSync(path.join(repoPath, 'package.json'))) {
    await executeCommand('npm install', { cwd: repoPath }, sessionId, 'Installing Node.js dependencies');
  }

  // Deploy using Serverless CLI
  const stage = 'dev';
  await executeCommand(
    `serverless deploy --stage ${stage} --region ${AWS_REGION} --verbose`,
    { cwd: repoPath },
    sessionId,
    'Deploying Serverless application'
  );

  // Get service info
  const { stdout } = await executeCommand(
    `serverless info --stage ${stage} --region ${AWS_REGION}`,
    { cwd: repoPath },
    sessionId,
    'Getting service information'
  );

  // Parse outputs (basic extraction from serverless info output)
  const serviceNameMatch = stdout.match(/service:\s+(\S+)/);
  const stackNameMatch = stdout.match(/stack:\s+(\S+)/);
  const endpointMatches = stdout.matchAll(/(?:GET|POST|PUT|DELETE|PATCH)\s+-\s+(https?:\/\/[^\s]+)/g);
  const functionMatches = stdout.matchAll(/(\w+):\s+[\w-]+-${stage}-(\w+)/g);

  const endpoints = Array.from(endpointMatches).map((m) => m[1]);
  const functions = Array.from(functionMatches).map((m) => m[1]);

  return {
    service: serviceNameMatch ? serviceNameMatch[1] : 'unknown',
    stack: stackNameMatch ? stackNameMatch[1] : 'unknown',
    stage,
    region: AWS_REGION,
    endpoints,
    functions,
  };
}

// Deploy using SAM CLI
async function deploySamCli(sessionId: string, repoPath: string): Promise<Record<string, any>> {
  await addLog(sessionId, 'Deploying with AWS SAM CLI');

  // Build SAM application
  await executeCommand('sam build', { cwd: repoPath }, sessionId, 'Building SAM application');

  // Deploy SAM application
  const stackName = `sam-deploy-${sessionId.substring(0, 8)}`;
  await executeCommand(
    `sam deploy --stack-name ${stackName} --s3-bucket ${ARTIFACTS_BUCKET} --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM --no-confirm-changeset --no-fail-on-empty-changeset --region ${AWS_REGION}`,
    { cwd: repoPath },
    sessionId,
    'Deploying SAM stack'
  );

  // Get stack outputs using AWS CLI
  const { stdout } = await executeCommand(
    `aws cloudformation describe-stacks --stack-name ${stackName} --region ${AWS_REGION} --query 'Stacks[0].Outputs' --output json`,
    { cwd: repoPath },
    sessionId,
    'Getting stack outputs'
  );

  const outputs = JSON.parse(stdout || '[]');
  const outputsMap = outputs.reduce((acc: Record<string, any>, o: any) => {
    acc[o.OutputKey] = o.OutputValue;
    return acc;
  }, {});

  return {
    stackName,
    outputs: outputsMap,
  };
}

// Deploy using AWS CDK
async function deployCdk(sessionId: string, repoPath: string): Promise<Record<string, any>> {
  await addLog(sessionId, 'Deploying with AWS CDK');

  // Install dependencies based on project type
  if (fs.existsSync(path.join(repoPath, 'package.json'))) {
    await executeCommand('npm install', { cwd: repoPath }, sessionId, 'Installing Node.js dependencies');
  } else if (fs.existsSync(path.join(repoPath, 'requirements.txt'))) {
    await executeCommand('pip3 install -r requirements.txt', { cwd: repoPath }, sessionId, 'Installing Python dependencies');
  }

  // Bootstrap CDK (idempotent operation)
  await executeCommand(
    `cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION}`,
    { cwd: repoPath },
    sessionId,
    'Bootstrapping CDK'
  );

  // Deploy all stacks
  await executeCommand(
    `cdk deploy --all --require-approval never --outputs-file cdk-outputs.json`,
    { cwd: repoPath },
    sessionId,
    'Deploying CDK stacks'
  );

  // Read outputs file
  const outputsPath = path.join(repoPath, 'cdk-outputs.json');
  let outputs = {};
  if (fs.existsSync(outputsPath)) {
    outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf-8'));
  }

  return {
    stacks: Object.keys(outputs),
    outputs,
  };
}

// Deploy using Terraform
async function deployTerraform(sessionId: string, repoPath: string): Promise<Record<string, any>> {
  await addLog(sessionId, 'Deploying with Terraform');

  // Create backend configuration for S3 state storage
  const backendConfig = `
terraform {
  backend "s3" {
    bucket = "${ARTIFACTS_BUCKET}"
    key    = "terraform-state/${sessionId}.tfstate"
    region = "${AWS_REGION}"
  }
}
`;
  fs.writeFileSync(path.join(repoPath, 'backend.tf'), backendConfig);
  await addLog(sessionId, 'Created Terraform S3 backend configuration');

  // Initialize Terraform
  await executeCommand('terraform init', { cwd: repoPath }, sessionId, 'Initializing Terraform');

  // Validate configuration
  await executeCommand('terraform validate', { cwd: repoPath }, sessionId, 'Validating Terraform configuration');

  // Plan deployment
  await executeCommand('terraform plan -out=tfplan', { cwd: repoPath }, sessionId, 'Planning Terraform deployment');

  // Apply deployment
  await executeCommand('terraform apply tfplan', { cwd: repoPath }, sessionId, 'Applying Terraform changes');

  // Get outputs
  const { stdout } = await executeCommand('terraform output -json', { cwd: repoPath }, sessionId, 'Getting Terraform outputs');

  const outputs = JSON.parse(stdout || '{}');
  const outputsMap = Object.entries(outputs).reduce((acc: Record<string, any>, [key, val]: [string, any]) => {
    acc[key] = val.value;
    return acc;
  }, {});

  return {
    outputs: outputsMap,
    stateFile: `s3://${ARTIFACTS_BUCKET}/terraform-state/${sessionId}.tfstate`,
  };
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

  let templateBody: string;

  // Handle SAM templates with packaging
  if (iacType === 'sam') {
    await addLog(sessionId, 'Detected SAM template - packaging Lambda functions...');

    // Parse template and extract functions
    const { template, functions } = await parseSamTemplate(templatePath);
    await addLog(sessionId, `Found ${functions.length} Lambda function(s) to package`);

    // Package and upload each function
    const s3UriMap: Record<string, string> = {};

    for (const func of functions) {
      const codeDir = path.join(repoPath, func.codeUri);
      await addLog(sessionId, `Packaging ${func.logicalId} from ${func.codeUri}...`);

      try {
        const zipBuffer = zipDirectory(codeDir, func.logicalId);
        const s3Uri = await uploadFunctionToS3(sessionId, zipBuffer, func.logicalId);

        s3UriMap[func.logicalId] = s3Uri;
        await addLog(sessionId, `Uploaded ${func.logicalId} to ${s3Uri}`);
      } catch (error: any) {
        throw new Error(`Failed to package ${func.logicalId}: ${error.message}`);
      }
    }

    // Transform template with S3 URIs
    templateBody = transformSamTemplate(template, s3UriMap);
    await addLog(sessionId, 'Template transformed with S3 URIs');
  } else {
    // Regular CloudFormation - use template as-is
    templateBody = fs.readFileSync(templatePath, 'utf-8');
  }

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

// Helper function to parse SAM template and extract function information
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
        // Only process local paths (not S3 URIs)
        if (typeof codeUri === 'string' && !codeUri.startsWith('s3://')) {
          functions.push({ logicalId, codeUri });
        }
      }
    }
  }

  return { template, functions };
}

// Helper function to zip a directory
function zipDirectory(sourceDir: string, functionName: string): Buffer {
  const zip = new AdmZip();

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const files = fs.readdirSync(sourceDir);

  for (const file of files) {
    const filePath = path.join(sourceDir, file);
    const stat = fs.statSync(filePath);

    // Skip .git and common non-essential directories
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

// Helper function to upload zip to S3
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

// Helper function to transform SAM template with S3 URIs
function transformSamTemplate(template: any, s3UriMap: Record<string, string>): string {
  // Deep clone to avoid modifying original
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
  const projectFiles = fs.readdirSync(repoPath);
  let handler = 'index.handler';

  if (projectFiles.includes('handler.js') || projectFiles.includes('handler.ts')) {
    handler = 'handler.handler';
  } else if (projectFiles.includes('index.js') || projectFiles.includes('index.ts')) {
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
    projectRoot: PROJECT_ROOT || undefined,
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
        projectRoot: PROJECT_ROOT || undefined,
        logs: [logMessage],
      },
    })
  );
}

// Helper function to execute shell commands with logging
async function executeCommand(
  command: string,
  options: { cwd: string },
  sessionId: string,
  description: string
): Promise<{ stdout: string; stderr: string }> {
  await addLog(sessionId, `Executing: ${description}`);

  try {
    const result = await execAsync(command, {
      ...options,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      env: {
        ...process.env,
        AWS_REGION,
        AWS_DEFAULT_REGION: AWS_REGION,
        HOME: '/tmp', // Some tools need a home directory
      },
    });

    // Log stdout (limit lines to avoid overwhelming logs)
    if (result.stdout) {
      const lines = result.stdout.split('\n').slice(0, 100);
      for (const line of lines) {
        if (line.trim()) {
          await addLog(sessionId, line.trim());
        }
      }
    }

    return result;
  } catch (error: any) {
    await addLog(sessionId, `Command failed: ${error.message}`);
    if (error.stderr) {
      const errorLines = error.stderr.split('\n').slice(0, 50);
      for (const line of errorLines) {
        if (line.trim()) {
          await addLog(sessionId, `ERROR: ${line.trim()}`);
        }
      }
    }
    throw error;
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
