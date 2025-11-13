import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});
const sfnClient = new SFNClient({});

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const CLONE_DETECT_QUEUE_URL = process.env.CLONE_DETECT_QUEUE_URL!;
const FIXER_QUEUE_URL = process.env.FIXER_QUEUE_URL!;
const SANITY_TESTER_QUEUE_URL = process.env.SANITY_TESTER_QUEUE_URL!;
const SDLC_STATE_MACHINE_ARN = process.env.SDLC_STATE_MACHINE_ARN!;
const API_BASE_URL = process.env.API_BASE_URL!;

interface DeployRequest {
  repository: string;
  branch: string;
  projectRoot?: string;
}

interface FixRequest {
  repository: string;
  branch: string;
  customRootFolder?: string;
  stackDetails?: Record<string, any>;
  fixInstructions: string;
}

interface SDLCDeployRequest {
  repository: string;
  branch: string;
  customRootFolder?: string;
}

interface SanityTestRequest {
  repository: string;
  branch: string;
  customRootFolder?: string;
  stackDetails: Record<string, any>;
}

interface DeploymentRecord {
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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const path = event.path;
    const method = event.httpMethod;

    // POST /deploy - initiate deployment
    if (path === '/deploy' && method === 'POST') {
      return await handleDeploy(event);
    }

    // POST /fix - initiate fix
    if (path === '/fix' && method === 'POST') {
      return await handleFix(event);
    }

    // POST /sdlc-deploy - initiate SDLC deployment workflow
    if (path === '/sdlc-deploy' && method === 'POST') {
      return await handleSDLCDeploy(event);
    }

    // POST /sanity-test - initiate sanity testing
    if (path === '/sanity-test' && method === 'POST') {
      return await handleSanityTest(event);
    }

    // GET /status/{sessionId} - get deployment status
    if (path.startsWith('/status/') && method === 'GET') {
      const sessionId = event.pathParameters?.sessionId;
      if (!sessionId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Session ID is required' }),
        };
      }
      return await handleGetStatus(sessionId);
    }

    // GET /deployments - list all deployments
    if (path === '/deployments' && method === 'GET') {
      return await handleListDeployments(event);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function handleDeploy(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (!event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Request body is required' }),
    };
  }

  const request: DeployRequest = JSON.parse(event.body);

  // Validate request
  if (!request.repository || !request.branch) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Repository and branch are required',
        example: {
          repository: 'https://github.com/username/repo',
          branch: 'main',
        },
      }),
    };
  }

  // Validate repository URL format
  const githubUrlPattern = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w-]+/;
  if (!githubUrlPattern.test(request.repository)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid GitHub repository URL',
        example: 'https://github.com/username/repo',
      }),
    };
  }

  // Validate projectRoot if provided
  if (request.projectRoot) {
    request.projectRoot = request.projectRoot.replace(/^\/+|\/+$/g, '');

    if (request.projectRoot.includes('..') || path.isAbsolute(request.projectRoot)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid projectRoot: must be a relative path without ".."',
          example: 'functions/my-lambda',
        }),
      };
    }

    const pathPattern = /^[a-zA-Z0-9_\-\/]+$/;
    if (!pathPattern.test(request.projectRoot)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid projectRoot: only alphanumeric, dash, underscore, and slash allowed',
          example: 'functions/my-lambda',
        }),
      };
    }
  }

  // Generate session ID
  const sessionId = uuidv4();
  const timestamp = Date.now();

  // Create deployment record
  const deploymentRecord: DeploymentRecord = {
    sessionId,
    timestamp,
    status: 'pending',
    repository: request.repository,
    branch: request.branch,
    projectRoot: request.projectRoot,
    message: 'Deployment queued',
    logs: ['Deployment initiated'],
  };

  // Save to DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: deploymentRecord,
    })
  );

  // Send message to SQS queue
  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: CLONE_DETECT_QUEUE_URL,
        MessageBody: JSON.stringify({
          sessionId,
          repository: request.repository,
          branch: request.branch,
          projectRoot: request.projectRoot,
        }),
      })
    );

    console.log(`Deploy job queued for session: ${sessionId}`);
  } catch (error) {
    console.error('Error sending message to SQS:', error);

    await docClient.send(
      new PutCommand({
        TableName: DEPLOYMENTS_TABLE,
        Item: {
          ...deploymentRecord,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        },
      })
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        sessionId,
        status: 'failed',
        error: 'Failed to queue deployment',
      }),
    };
  }

  return {
    statusCode: 202,
    headers,
    body: JSON.stringify({
      sessionId,
      status: 'pending',
      message: 'Deployment queued successfully',
      repository: request.repository,
      branch: request.branch,
      projectRoot: request.projectRoot,
    }),
  };
}

async function handleFix(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (!event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Request body is required' }),
    };
  }

  const request: FixRequest = JSON.parse(event.body);

  // Validate request
  if (!request.repository || !request.branch || !request.fixInstructions) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Repository, branch, and fixInstructions are required',
        example: {
          repository: 'https://github.com/username/repo',
          branch: 'main',
          fixInstructions: 'Fix the authentication bug in user login',
          customRootFolder: 'optional/path',
          stackDetails: { optional: 'stack info' },
        },
      }),
    };
  }

  // Validate repository URL format
  const githubUrlPattern = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w-]+/;
  if (!githubUrlPattern.test(request.repository)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid GitHub repository URL',
        example: 'https://github.com/username/repo',
      }),
    };
  }

  // Generate session ID with fixer prefix
  const sessionId = `fixer-${uuidv4()}`;
  const timestamp = Date.now();

  // Create fixer record
  const fixerRecord = {
    sessionId,
    timestamp,
    status: 'pending',
    repository: request.repository,
    branch: request.branch,
    customRootFolder: request.customRootFolder,
    fixInstructions: request.fixInstructions,
    stackDetails: request.stackDetails,
    message: 'Fix queued',
    logs: ['Fix process initiated'],
  };

  // Save to DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: fixerRecord,
    })
  );

  // Send message to SQS queue
  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: FIXER_QUEUE_URL,
        MessageBody: JSON.stringify({
          sessionId,
          repository: request.repository,
          branch: request.branch,
          customRootFolder: request.customRootFolder,
          fixInstructions: request.fixInstructions,
          stackDetails: request.stackDetails,
        }),
      })
    );

    console.log(`Fix job queued for session: ${sessionId}`);
  } catch (error) {
    console.error('Error sending message to SQS:', error);

    await docClient.send(
      new PutCommand({
        TableName: DEPLOYMENTS_TABLE,
        Item: {
          ...fixerRecord,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        },
      })
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        sessionId,
        status: 'failed',
        error: 'Failed to queue fix process',
      }),
    };
  }

  return {
    statusCode: 202,
    headers,
    body: JSON.stringify({
      sessionId,
      status: 'pending',
      message: 'Fix queued successfully',
      repository: request.repository,
      branch: request.branch,
      customRootFolder: request.customRootFolder,
      fixInstructions: request.fixInstructions,
    }),
  };
}

async function handleSDLCDeploy(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (!event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Request body is required' }),
    };
  }

  const request: SDLCDeployRequest = JSON.parse(event.body);

  // Validate request
  if (!request.repository || !request.branch) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Repository and branch are required',
        example: {
          repository: 'https://github.com/username/repo',
          branch: 'main',
          customRootFolder: 'optional/path',
        },
      }),
    };
  }

  // Generate session ID with sdlc prefix
  const sessionId = `sdlc-${uuidv4()}`;
  const timestamp = Date.now();

  // Create SDLC manager record
  const sdlcRecord = {
    sessionId,
    timestamp,
    status: 'pending',
    repository: request.repository,
    branch: request.branch,
    customRootFolder: request.customRootFolder,
    message: 'SDLC deployment queued',
    logs: ['SDLC deployment workflow initiated'],
  };

  // Save to DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: sdlcRecord,
    })
  );

  // Start Step Functions execution
  try {
    const executionInput = {
      deployJob: {
        sessionId: `deploy-${uuidv4()}`,
        repository: request.repository,
        branch: request.branch,
        projectRoot: request.customRootFolder,
      },
      sanityTestJob: {
        sessionId: `sanity-${uuidv4()}`,
        repository: request.repository,
        branch: request.branch,
        customRootFolder: request.customRootFolder,
        stackDetails: {},
      },
      fixJob: {
        sessionId: `fixer-${uuidv4()}`,
        repository: request.repository,
        branch: request.branch,
        customRootFolder: request.customRootFolder,
        fixInstructions: 'Fix deployment or test failures',
      },
    };

    await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: SDLC_STATE_MACHINE_ARN,
        input: JSON.stringify(executionInput),
        name: sessionId,
      })
    );

    console.log(`SDLC workflow started for session: ${sessionId}`);
  } catch (error) {
    console.error('Error starting Step Functions execution:', error);

    await docClient.send(
      new PutCommand({
        TableName: DEPLOYMENTS_TABLE,
        Item: {
          ...sdlcRecord,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        },
      })
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        sessionId,
        status: 'failed',
        error: 'Failed to start SDLC workflow',
      }),
    };
  }

  return {
    statusCode: 202,
    headers,
    body: JSON.stringify({
      sessionId,
      status: 'pending',
      message: 'SDLC deployment workflow initiated successfully',
      repository: request.repository,
      branch: request.branch,
      customRootFolder: request.customRootFolder,
    }),
  };
}

async function handleSanityTest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (!event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Request body is required' }),
    };
  }

  const request: SanityTestRequest = JSON.parse(event.body);

  // Validate request
  if (!request.repository || !request.branch || !request.stackDetails) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Repository, branch, and stackDetails are required',
        example: {
          repository: 'https://github.com/username/repo',
          branch: 'main',
          customRootFolder: 'optional/path',
          stackDetails: { apiUrl: 'https://api.example.com' },
        },
      }),
    };
  }

  // Generate session ID with sanity-test prefix
  const sessionId = `sanity-${uuidv4()}`;
  const timestamp = Date.now();

  // Create sanity test record
  const sanityTestRecord = {
    sessionId,
    timestamp,
    status: 'pending',
    repository: request.repository,
    branch: request.branch,
    customRootFolder: request.customRootFolder,
    stackDetails: request.stackDetails,
    message: 'Sanity test queued',
    logs: ['Sanity test process initiated'],
  };

  // Save to DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: sanityTestRecord,
    })
  );

  // Send message to SQS queue
  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: SANITY_TESTER_QUEUE_URL,
        MessageBody: JSON.stringify({
          sessionId,
          repository: request.repository,
          branch: request.branch,
          customRootFolder: request.customRootFolder,
          stackDetails: request.stackDetails,
        }),
      })
    );

    console.log(`Sanity test job queued for session: ${sessionId}`);
  } catch (error) {
    console.error('Error sending message to SQS:', error);

    await docClient.send(
      new PutCommand({
        TableName: DEPLOYMENTS_TABLE,
        Item: {
          ...sanityTestRecord,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        },
      })
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        sessionId,
        status: 'failed',
        error: 'Failed to queue sanity test process',
      }),
    };
  }

  return {
    statusCode: 202,
    headers,
    body: JSON.stringify({
      sessionId,
      status: 'pending',
      message: 'Sanity test queued successfully',
      repository: request.repository,
      branch: request.branch,
      customRootFolder: request.customRootFolder,
    }),
  };
}

async function handleGetStatus(sessionId: string): Promise<APIGatewayProxyResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  // Query DynamoDB for all records with this sessionId
  const result = await docClient.send(
    new QueryCommand({
      TableName: DEPLOYMENTS_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
      },
      ScanIndexForward: false, // Get latest first
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Deployment not found' }),
    };
  }

  // Get the latest record
  const latestRecord = result.Items[0] as DeploymentRecord;

  // Collect all logs from all records
  const allLogs = result.Items.flatMap((item) => (item as DeploymentRecord).logs || []);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      sessionId: latestRecord.sessionId,
      status: latestRecord.status,
      repository: latestRecord.repository,
      branch: latestRecord.branch,
      projectRoot: latestRecord.projectRoot,
      message: latestRecord.message,
      logs: allLogs,
      deployedResources: latestRecord.deployedResources,
      error: latestRecord.error,
      lastUpdated: new Date(latestRecord.timestamp).toISOString(),
    }),
  };
}

async function handleListDeployments(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : 20;
  const status = event.queryStringParameters?.status as 'pending' | 'deploying' | 'success' | 'failed' | undefined;

  let result;

  if (status) {
    // Query by status using GSI
    result = await docClient.send(
      new QueryCommand({
        TableName: DEPLOYMENTS_TABLE,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    );
  } else {
    // Scan all
    result = await docClient.send(
      new ScanCommand({
        TableName: DEPLOYMENTS_TABLE,
        Limit: limit,
      })
    );
  }

  const deployments = result.Items || [];

  // Group by sessionId and get latest for each
  const sessionMap = new Map<string, DeploymentRecord>();
  deployments.forEach((item) => {
    const record = item as DeploymentRecord;
    const existing = sessionMap.get(record.sessionId);
    if (!existing || record.timestamp > existing.timestamp) {
      sessionMap.set(record.sessionId, record);
    }
  });

  const latestDeployments = Array.from(sessionMap.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      deployments: latestDeployments.map((d) => ({
        sessionId: d.sessionId,
        status: d.status,
        repository: d.repository,
        branch: d.branch,
        message: d.message,
        lastUpdated: new Date(d.timestamp).toISOString(),
      })),
      count: latestDeployments.length,
    }),
  };
}
