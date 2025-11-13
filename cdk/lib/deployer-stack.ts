import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';

export class GitHubLambdaDeployerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table for deployment sessions
    const deploymentsTable = new dynamodb.Table(this, 'DeploymentsTable', {
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // GSI for querying by status
    deploymentsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
    });

    // S3 bucket for artifacts
    const artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
          id: 'DeleteOldArtifacts',
        },
      ],
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
    });

    // ========== SQS Queues for Queue-Based Processing ==========

    // Dead Letter Queue
    const dlq = new sqs.Queue(this, 'DeploymentDLQ', {
      queueName: 'deployment-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Deployer queues
    const cloneDetectQueue = new sqs.Queue(this, 'CloneDetectQueue', {
      queueName: 'deployer-clone-detect-queue',
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    const deployQueue = new sqs.Queue(this, 'DeployQueue', {
      queueName: 'deployer-deploy-queue',
      visibilityTimeout: cdk.Duration.minutes(10),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    const monitorQueue = new sqs.Queue(this, 'MonitorQueue', {
      queueName: 'deployer-monitor-queue',
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Fixer queue
    const fixerQueue = new sqs.Queue(this, 'FixerQueue', {
      queueName: 'fixer-queue',
      visibilityTimeout: cdk.Duration.minutes(10),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Sanity tester queue
    const sanityTesterQueue = new sqs.Queue(this, 'SanityTesterQueue', {
      queueName: 'sanity-tester-queue',
      visibilityTimeout: cdk.Duration.minutes(10),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // ========== Lambda Functions ==========

    // Deployer: Clone & Detect Lambda
    const cloneDetectLambda = new lambda.Function(this, 'CloneDetectLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/deployer-clone-detect')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
        NEXT_QUEUE_URL: deployQueue.queueUrl,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: 'Clones repository and detects IaC type',
    });

    // Deployer: Deploy Lambda
    const deployLambda = new lambda.Function(this, 'DeployLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/deployer-deploy')),
      timeout: cdk.Duration.minutes(10),
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(2048),
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
        MONITOR_QUEUE_URL: monitorQueue.queueUrl,
        AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
        AWS_REGION: cdk.Stack.of(this).region,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: 'Deploys infrastructure based on IaC type',
    });

    // Deployer: Monitor Lambda
    const monitorLambda = new lambda.Function(this, 'MonitorLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/deployer-monitor')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: 'Monitors deployment progress',
    });

    // Fixer Lambda
    const fixerLambda = new lambda.Function(this, 'FixerLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/fixer-lambda')),
      timeout: cdk.Duration.minutes(10),
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(2048),
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
        // ANTHROPIC_API_KEY should be set via environment variable or Secrets Manager
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: 'AI-powered code fixer',
    });

    // Sanity Tester Lambda
    const sanityTesterLambda = new lambda.Function(this, 'SanityTesterLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/sanity-tester-lambda')),
      timeout: cdk.Duration.minutes(10),
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(2048),
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        // ANTHROPIC_API_KEY should be set via environment variable or Secrets Manager
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: 'AI-powered API sanity tester',
    });

    // Status Analyzer Lambda (already exists)
    const statusAnalyzerLambda = new lambda.Function(this, 'StatusAnalyzerLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/status-analyzer')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: 'Analyzes deployment outputs and generates fix instructions',
    });

    // ========== IAM Permissions ==========

    // Grant DynamoDB permissions
    deploymentsTable.grantReadWriteData(cloneDetectLambda);
    deploymentsTable.grantReadWriteData(deployLambda);
    deploymentsTable.grantReadWriteData(monitorLambda);
    deploymentsTable.grantReadWriteData(fixerLambda);
    deploymentsTable.grantReadWriteData(sanityTesterLambda);
    deploymentsTable.grantReadData(statusAnalyzerLambda);

    // Grant S3 permissions
    artifactsBucket.grantReadWrite(cloneDetectLambda);
    artifactsBucket.grantReadWrite(deployLambda);
    artifactsBucket.grantReadWrite(fixerLambda);

    // Grant SQS permissions
    deployQueue.grantSendMessages(cloneDetectLambda);
    monitorQueue.grantSendMessages(deployLambda);

    // Grant deploy Lambda permissions for CloudFormation and Lambda operations
    deployLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:*',
          'lambda:*',
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:GetRole',
          'iam:PassRole',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:GetRolePolicy',
          'iam:TagRole',
        ],
        resources: ['*'],
      })
    );

    // Grant monitor Lambda permissions for CloudFormation and Lambda
    monitorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents', 'lambda:GetFunction'],
        resources: ['*'],
      })
    );

    // ========== Lambda Event Sources (SQS Triggers) ==========

    cloneDetectLambda.addEventSource(
      new SqsEventSource(cloneDetectQueue, {
        batchSize: 1,
      })
    );

    deployLambda.addEventSource(
      new SqsEventSource(deployQueue, {
        batchSize: 1,
      })
    );

    monitorLambda.addEventSource(
      new SqsEventSource(monitorQueue, {
        batchSize: 1,
      })
    );

    fixerLambda.addEventSource(
      new SqsEventSource(fixerQueue, {
        batchSize: 1,
      })
    );

    sanityTesterLambda.addEventSource(
      new SqsEventSource(sanityTesterQueue, {
        batchSize: 1,
      })
    );

    // ========== Step Functions State Machine for SDLC Manager ==========

    const sdlcStateMachine = new sfn.StateMachine(this, 'SDLCStateMachine', {
      stateMachineName: 'sdlc-deployment-workflow',
      definitionBody: sfn.DefinitionBody.fromString(`{
  "Comment": "SDLC Deployment Workflow with deploy, test, and fix loop",
  "StartAt": "InitiateDeployment",
  "States": {
    "InitiateDeployment": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage",
      "Parameters": {
        "QueueUrl": "${cloneDetectQueue.queueUrl}",
        "MessageBody.$": "$.deployJob"
      },
      "Next": "WaitForDeployment"
    },
    "WaitForDeployment": {
      "Type": "Wait",
      "Seconds": 60,
      "Next": "CheckDeploymentStatus"
    },
    "CheckDeploymentStatus": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${statusAnalyzerLambda.functionArn}",
        "Payload": {
          "sessionId.$": "$.deployJob.sessionId"
        }
      },
      "ResultPath": "$.deploymentStatus",
      "Next": "EvaluateDeploymentStatus"
    },
    "EvaluateDeploymentStatus": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.deploymentStatus.Payload.status",
          "StringEquals": "success",
          "Next": "InitiateSanityTests"
        },
        {
          "Variable": "$.deploymentStatus.Payload.status",
          "StringEquals": "failed",
          "Next": "InitiateFix"
        }
      ],
      "Default": "WaitForDeployment"
    },
    "InitiateSanityTests": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage",
      "Parameters": {
        "QueueUrl": "${sanityTesterQueue.queueUrl}",
        "MessageBody.$": "$.sanityTestJob"
      },
      "Next": "WaitForSanityTests"
    },
    "WaitForSanityTests": {
      "Type": "Wait",
      "Seconds": 60,
      "Next": "CheckSanityTestStatus"
    },
    "CheckSanityTestStatus": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:getItem",
      "Parameters": {
        "TableName": "${deploymentsTable.tableName}",
        "Key": {
          "sessionId": {
            "S.$": "$.sanityTestJob.sessionId"
          },
          "timestamp": {
            "N": "0"
          }
        }
      },
      "ResultPath": "$.sanityTestStatus",
      "Next": "EvaluateSanityTestStatus"
    },
    "EvaluateSanityTestStatus": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.sanityTestStatus.Item.status.S",
          "StringEquals": "success",
          "Next": "Success"
        },
        {
          "Variable": "$.sanityTestStatus.Item.status.S",
          "StringEquals": "failed",
          "Next": "InitiateFix"
        }
      ],
      "Default": "WaitForSanityTests"
    },
    "InitiateFix": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage",
      "Parameters": {
        "QueueUrl": "${fixerQueue.queueUrl}",
        "MessageBody.$": "$.fixJob"
      },
      "Next": "WaitForFix"
    },
    "WaitForFix": {
      "Type": "Wait",
      "Seconds": 60,
      "Next": "CheckFixStatus"
    },
    "CheckFixStatus": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:getItem",
      "Parameters": {
        "TableName": "${deploymentsTable.tableName}",
        "Key": {
          "sessionId": {
            "S.$": "$.fixJob.sessionId"
          },
          "timestamp": {
            "N": "0"
          }
        }
      },
      "ResultPath": "$.fixStatus",
      "Next": "EvaluateFixStatus"
    },
    "EvaluateFixStatus": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.fixStatus.Item.status.S",
          "StringEquals": "success",
          "Next": "InitiateDeployment"
        },
        {
          "Variable": "$.fixStatus.Item.status.S",
          "StringEquals": "failed",
          "Next": "Failed"
        }
      ],
      "Default": "WaitForFix"
    },
    "Success": {
      "Type": "Succeed"
    },
    "Failed": {
      "Type": "Fail",
      "Error": "SDLCWorkflowFailed",
      "Cause": "Deployment or fix failed"
    }
  }
}`),
      timeout: cdk.Duration.minutes(30),
      logs: {
        destination: new logs.LogGroup(this, 'SDLCStateMachineLogs', {
          logGroupName: '/aws/vendedlogs/states/sdlc-workflow',
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    // Grant Step Functions permissions
    cloneDetectQueue.grantSendMessages(sdlcStateMachine);
    fixerQueue.grantSendMessages(sdlcStateMachine);
    sanityTesterQueue.grantSendMessages(sdlcStateMachine);
    deploymentsTable.grantReadData(sdlcStateMachine);
    statusAnalyzerLambda.grantInvoke(sdlcStateMachine);

    // ========== API Handler Lambda ==========

    const apiHandlerLambda = new lambda.Function(this, 'ApiHandlerLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/api-handler')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        CLONE_DETECT_QUEUE_URL: cloneDetectQueue.queueUrl,
        FIXER_QUEUE_URL: fixerQueue.queueUrl,
        SANITY_TESTER_QUEUE_URL: sanityTesterQueue.queueUrl,
        SDLC_STATE_MACHINE_ARN: sdlcStateMachine.stateMachineArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant API handler permissions
    deploymentsTable.grantReadWriteData(apiHandlerLambda);
    cloneDetectQueue.grantSendMessages(apiHandlerLambda);
    fixerQueue.grantSendMessages(apiHandlerLambda);
    sanityTesterQueue.grantSendMessages(apiHandlerLambda);
    sdlcStateMachine.grantStartExecution(apiHandlerLambda);

    // ========== API Gateway ==========

    const api = new apigateway.RestApi(this, 'DeployerApi', {
      restApiName: 'GitHub Lambda Deployer API',
      description: 'API for deploying Lambda functions from GitHub repositories',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.OFF,
        dataTraceEnabled: false,
        metricsEnabled: false,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const apiHandlerIntegration = new apigateway.LambdaIntegration(apiHandlerLambda);

    // API Endpoints
    const deployResource = api.root.addResource('deploy');
    deployResource.addMethod('POST', apiHandlerIntegration);

    const fixResource = api.root.addResource('fix');
    fixResource.addMethod('POST', apiHandlerIntegration);

    const sdlcDeployResource = api.root.addResource('sdlc-deploy');
    sdlcDeployResource.addMethod('POST', apiHandlerIntegration);

    const sanityTestResource = api.root.addResource('sanity-test');
    sanityTestResource.addMethod('POST', apiHandlerIntegration);

    const statusResource = api.root.addResource('status');
    const sessionResource = statusResource.addResource('{sessionId}');
    sessionResource.addMethod('GET', apiHandlerIntegration);

    const deploymentsResource = api.root.addResource('deployments');
    deploymentsResource.addMethod('GET', apiHandlerIntegration);

    const analyzerIntegration = new apigateway.LambdaIntegration(statusAnalyzerLambda);
    const analyzeResource = api.root.addResource('analyze');
    analyzeResource.addMethod('POST', analyzerIntegration);

    const analyzeSessionResource = analyzeResource.addResource('{sessionId}');
    analyzeSessionResource.addMethod('GET', analyzerIntegration);

    // Update API Handler with API_BASE_URL
    apiHandlerLambda.addEnvironment('API_BASE_URL', api.url);

    // ========== Outputs ==========

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'DeploymentsTableName', {
      value: deploymentsTable.tableName,
      description: 'DynamoDB table for deployments',
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: artifactsBucket.bucketName,
      description: 'S3 bucket for artifacts',
    });

    new cdk.CfnOutput(this, 'SDLCStateMachineArn', {
      value: sdlcStateMachine.stateMachineArn,
      description: 'Step Functions state machine for SDLC workflow',
    });

    new cdk.CfnOutput(this, 'CloneDetectQueueUrl', {
      value: cloneDetectQueue.queueUrl,
      description: 'SQS queue for clone/detect jobs',
    });
  }
}
