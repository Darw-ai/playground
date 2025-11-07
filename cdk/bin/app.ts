#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GitHubLambdaDeployerStack } from '../lib/deployer-stack';

const app = new cdk.App();

new GitHubLambdaDeployerStack(app, 'GitHubLambdaDeployerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'API to deploy Lambda functions from GitHub repositories',
});

app.synth();
