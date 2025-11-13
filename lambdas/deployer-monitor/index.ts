import { SQSEvent, SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudFormationClient, DescribeStacksCommand, DescribeStackEventsCommand } from '@aws-sdk/client-cloudformation';
import { LambdaClient, GetFunctionCommand } from '@aws-sdk/client-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cfnClient = new CloudFormationClient({});
const lambdaClient = new LambdaClient({});

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;

interface MonitorJob {
  sessionId: string;
  stackName?: string;
  functionName?: string;
  deploymentType: string;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const job: MonitorJob = JSON.parse(record.body);
    console.log('Processing monitor job:', job);

    try {
      if (job.deploymentType === 'cloudformation') {
        await monitorCloudFormationStack(job.sessionId, job.stackName!);
      } else if (job.deploymentType === 'simple-lambda') {
        await monitorLambdaFunction(job.sessionId, job.functionName!);
      }
    } catch (error) {
      console.error('Error monitoring deployment:', error);
      await updateStatus(
        job.sessionId,
        'failed',
        'Monitoring failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
};

async function monitorCloudFormationStack(sessionId: string, stackName: string): Promise<void> {
  await addLog(sessionId, `Monitoring CloudFormation stack: ${stackName}`);

  const maxAttempts = 60; // 60 attempts * 10 seconds = 10 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    const result = await cfnClient.send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = result.Stacks?.[0];

    if (!stack) {
      throw new Error('Stack not found');
    }

    const status = stack.StackStatus;
    await addLog(sessionId, `Stack status: ${status} (attempt ${attempts}/${maxAttempts})`);

    if (status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE') {
      // Get stack outputs
      const outputs = stack.Outputs?.reduce((acc, output) => {
        acc[output.OutputKey || ''] = output.OutputValue;
        return acc;
      }, {} as Record<string, any>);

      await docClient.send(
        new PutCommand({
          TableName: DEPLOYMENTS_TABLE,
          Item: {
            sessionId,
            timestamp: Date.now(),
            status: 'success',
            message: 'Deployment completed successfully',
            deployedResources: {
              stackName,
              stackId: stack.StackId,
              outputs,
            },
          },
        })
      );

      await addLog(sessionId, 'CloudFormation stack deployment completed successfully');
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

      await updateStatus(sessionId, 'failed', 'Stack creation failed', errorMessages);
      throw new Error(`Stack creation failed: ${errorMessages}`);
    }

    // Wait 10 seconds before next check
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  await updateStatus(sessionId, 'failed', 'Stack creation timeout', 'Stack did not complete within 10 minutes');
  throw new Error('Stack creation timeout');
}

async function monitorLambdaFunction(sessionId: string, functionName: string): Promise<void> {
  await addLog(sessionId, `Verifying Lambda function: ${functionName}`);

  try {
    const result = await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));

    if (result.Configuration?.State === 'Active') {
      await addLog(sessionId, 'Lambda function is active and ready');
      await updateStatus(sessionId, 'success', 'Deployment completed successfully');
    } else {
      await addLog(sessionId, `Lambda function state: ${result.Configuration?.State}`);
      await updateStatus(sessionId, 'success', 'Deployment completed (function may still be initializing)');
    }
  } catch (error) {
    throw new Error(`Failed to verify Lambda function: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
