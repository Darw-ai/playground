import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
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
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // GSI for querying by status
    deploymentsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
    });

    // S3 bucket for temporary repository storage and deployment artifacts
    const artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      autoDeleteObjects: true, // Change to false for production
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

    // VPC for ECS Fargate tasks
    const vpc = new ec2.Vpc(this, 'DeployerVpc', {
      maxAzs: 2,
      natGateways: 1, // Use 0 for cost savings with public subnets only
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // ECS Cluster for deployer tasks
    const cluster = new ecs.Cluster(this, 'DeployerCluster', {
      vpc,
      containerInsights: true,
    });

    // IAM role for ECS Task Execution (pulling images, logs)
    const taskExecutionRole = new iam.Role(this, 'DeployerTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // IAM role for ECS Task (application permissions)
    const taskRole = new iam.Role(this, 'DeployerTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role for deployer ECS tasks with CloudFormation and Lambda permissions',
    });

    // Grant permissions for CloudFormation operations
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:DescribeStackResources',
          'cloudformation:GetTemplate',
          'cloudformation:ValidateTemplate',
          'cloudformation:ListStacks',
        ],
        resources: ['*'],
      })
    );

    // Grant permissions for Lambda operations (for deploying user Lambdas)
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:CreateFunction',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:ListFunctions',
          'lambda:PublishVersion',
          'lambda:CreateAlias',
          'lambda:UpdateAlias',
          'lambda:AddPermission',
          'lambda:RemovePermission',
        ],
        resources: ['*'],
      })
    );

    // Grant permissions for IAM role creation (for deployed Lambdas)
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
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

    // Grant S3 permissions
    artifactsBucket.grantReadWrite(taskRole);

    // Grant DynamoDB permissions
    deploymentsTable.grantReadWriteData(taskRole);

    // ECS Task Definition for deployer
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'DeployerTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    // Add container to task definition
    const container = taskDefinition.addContainer('DeployerContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../../deployer-container')),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'deployer',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
        AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
        AWS_REGION: cdk.Stack.of(this).region,
      },
    });

    // ECS Task Definition for test generator
    const testTaskDefinition = new ecs.FargateTaskDefinition(this, 'TestGeneratorTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    // Add container to test task definition
    const testContainer = testTaskDefinition.addContainer('TestGeneratorContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../../test-generator-container')),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'test-generator',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        AWS_REGION: cdk.Stack.of(this).region,
      },
    });

    // Security group for ECS tasks
    const deployerSecurityGroup = new ec2.SecurityGroup(this, 'DeployerSecurityGroup', {
      vpc,
      description: 'Security group for deployer ECS tasks',
      allowAllOutbound: true,
    });

    // API Handler Lambda
    const apiHandlerLambda = new lambda.Function(this, 'ApiHandlerLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/api-handler')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        ECS_CLUSTER_ARN: cluster.clusterArn,
        ECS_TASK_DEFINITION_ARN: taskDefinition.taskDefinitionArn,
        ECS_CONTAINER_NAME: container.containerName,
        TEST_TASK_DEFINITION_ARN: testTaskDefinition.taskDefinitionArn,
        TEST_CONTAINER_NAME: testContainer.containerName,
        ECS_SUBNETS: vpc.privateSubnets.map((subnet) => subnet.subnetId).join(','),
        ECS_SECURITY_GROUP: deployerSecurityGroup.securityGroupId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant API handler permissions
    deploymentsTable.grantReadWriteData(apiHandlerLambda);

    // Grant API handler permission to run ECS tasks
    apiHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecs:RunTask'],
        resources: [taskDefinition.taskDefinitionArn, testTaskDefinition.taskDefinitionArn],
      })
    );

    // Grant API handler permission to pass roles to ECS
    apiHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [taskExecutionRole.roleArn, taskRole.roleArn],
      })
    );

    // API Gateway
    const api = new apigateway.RestApi(this, 'DeployerApi', {
      restApiName: 'GitHub Lambda Deployer API',
      description: 'API for deploying Lambda functions from GitHub repositories',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Lambda integration
    const apiHandlerIntegration = new apigateway.LambdaIntegration(apiHandlerLambda, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    // POST /deploy endpoint
    const deployResource = api.root.addResource('deploy');
    deployResource.addMethod('POST', apiHandlerIntegration, {
      apiKeyRequired: false, // Set to true and add API key for production
    });

    // GET /status/{sessionId} endpoint
    const statusResource = api.root.addResource('status');
    const sessionResource = statusResource.addResource('{sessionId}');
    sessionResource.addMethod('GET', apiHandlerIntegration);

    // GET /deployments endpoint (list all deployments)
    const deploymentsResource = api.root.addResource('deployments');
    deploymentsResource.addMethod('GET', apiHandlerIntegration);

    // POST /test endpoint (initiate test generation)
    const testResource = api.root.addResource('test');
    testResource.addMethod('POST', apiHandlerIntegration, {
      apiKeyRequired: false, // Set to true and add API key for production
    });

    // GET /test-status/{sessionId} endpoint
    const testStatusResource = api.root.addResource('test-status');
    const testSessionResource = testStatusResource.addResource('{sessionId}');
    testSessionResource.addMethod('GET', apiHandlerIntegration);

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
      exportName: 'GitHubLambdaDeployerApiEndpoint',
    });

    new cdk.CfnOutput(this, 'DeploymentsTableName', {
      value: deploymentsTable.tableName,
      description: 'DynamoDB table for deployments',
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: artifactsBucket.bucketName,
      description: 'S3 bucket for artifacts',
    });

    new cdk.CfnOutput(this, 'ECSClusterName', {
      value: cluster.clusterName,
      description: 'ECS Cluster for deployer tasks',
    });

    new cdk.CfnOutput(this, 'TaskDefinitionArn', {
      value: taskDefinition.taskDefinitionArn,
      description: 'ECS Task Definition ARN',
    });

    new cdk.CfnOutput(this, 'TestTaskDefinitionArn', {
      value: testTaskDefinition.taskDefinitionArn,
      description: 'ECS Test Generator Task Definition ARN',
    });
  }
}
