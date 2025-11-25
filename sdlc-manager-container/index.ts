import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import axios from 'axios';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE!;
const API_BASE_URL = process.env.API_BASE_URL!;

// Container-specific environment variables
const SESSION_ID = process.env.SESSION_ID!;
const REPOSITORY = process.env.REPOSITORY!;
const BRANCH = process.env.BRANCH!;
const CUSTOM_ROOT_FOLDER = process.env.CUSTOM_ROOT_FOLDER || '';

const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const POLL_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_POLL_ATTEMPTS = 5;

interface SDLCLog {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'deploying' | 'testing' | 'fixing' | 'success' | 'failed' | 'timeout';
  repository: string;
  branch: string;
  customRootFolder?: string;
  message?: string;
  logs?: string[];
  deploymentSessionId?: string;
  sanityResult?: Record<string, any>;
  fixerSessionId?: string;
  error?: string;
  attemptNumber?: number;
}

async function main() {
  const initialDeploymentTime = Date.now();
  console.log(`Starting SDLC Manager for session ${SESSION_ID}`);
  console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}${CUSTOM_ROOT_FOLDER ? `, Custom Root: ${CUSTOM_ROOT_FOLDER}` : ''}`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000} seconds`);

  try {
    await updateSDLCStatus(SESSION_ID, 'deploying', 'Starting SDLC deployment cycle...', [
      'SDLC Manager initialized',
      `Repository: ${REPOSITORY}`,
      `Branch: ${BRANCH}${CUSTOM_ROOT_FOLDER ? `, Custom Root: ${CUSTOM_ROOT_FOLDER}` : ''}`,
      `Timeout: ${TIMEOUT_MS / 1000} seconds`,
    ]);

    let attemptNumber = 0;
    let currentBranch = BRANCH;
    let success = false;

    while (!success) {
      attemptNumber++;

      // Check timeout
      if (Date.now() - initialDeploymentTime > TIMEOUT_MS) {
        await addLog(SESSION_ID, `Timeout reached after ${(Date.now() - initialDeploymentTime) / 1000} seconds`);
        await updateSDLCStatus(
          SESSION_ID,
          'timeout',
          'SDLC deployment timed out after 15 minutes',
          undefined,
          undefined,
          undefined,
          undefined,
          'Timeout: deployment did not complete within 15 minutes',
          attemptNumber
        );
        console.log('SDLC deployment timed out');
        process.exit(1);
      }

      await addLog(SESSION_ID, `\n=== Attempt ${attemptNumber} ===`);
      await addLog(SESSION_ID, `Current branch: ${currentBranch}`);
      await addLog(SESSION_ID, `Time elapsed: ${((Date.now() - initialDeploymentTime) / 1000).toFixed(1)}s`);

      // Step 1: Deploy via IaC Deployer
      await addLog(SESSION_ID, 'Step 1: Initiating deployment via IaC Deployer...');
      const deploymentSessionId = await triggerDeployment(currentBranch);
      await addLog(SESSION_ID, `Deployment initiated with session ID: ${deploymentSessionId}`);
      await updateSDLCStatus(SESSION_ID, 'deploying', 'Deployment in progress...', undefined, deploymentSessionId, undefined, undefined, undefined, attemptNumber);

      // Step 2: Poll Status Analyzer
      await addLog(SESSION_ID, 'Step 2: Polling Status Analyzer...');
      const deploymentStatus = await pollStatusAnalyzer(deploymentSessionId);
      await addLog(SESSION_ID, `Deployment status: ${deploymentStatus.status}`);

      if (deploymentStatus.status !== 'success') {
        // Deployment failed - trigger fixer
        await addLog(SESSION_ID, 'Deployment failed. Triggering Fixer module...');
        await updateSDLCStatus(SESSION_ID, 'fixing', 'Deployment failed, initiating fix...', undefined, deploymentSessionId);

        const fixInstructions = deploymentStatus.rootCause || deploymentStatus.summary || 'Fix deployment errors';
        const fixerSessionId = await triggerFixer(currentBranch, fixInstructions, deploymentStatus.stackDetails);
        await addLog(SESSION_ID, `Fixer initiated with session ID: ${fixerSessionId}`);

        // Wait for fixer to complete
        const fixerResult = await waitForFixer(fixerSessionId);
        await addLog(SESSION_ID, `Fixer completed with status: ${fixerResult.status}`);

        if (fixerResult.status === 'success' && fixerResult.deploymentJob) {
          // Use the new branch created by fixer
          currentBranch = fixerResult.deploymentJob.branch;
          await addLog(SESSION_ID, `Fixer created new branch: ${currentBranch}`);
          await updateSDLCStatus(SESSION_ID, 'deploying', 'Retrying deployment with fixes...', undefined, undefined, undefined, fixerSessionId);

          // Continue loop to retry deployment
          continue;
        } else {
          // Fixer failed
          await addLog(SESSION_ID, 'Fixer failed to create a fix');
          await updateSDLCStatus(
            SESSION_ID,
            'failed',
            'SDLC deployment failed: Fixer could not resolve issues',
            undefined,
            deploymentSessionId,
            undefined,
            fixerSessionId,
            'Fixer failed to create a fix',
            attemptNumber
          );
          console.log('SDLC deployment failed: Fixer could not resolve issues');
          process.exit(1);
        }
      }

      // Step 3: Deployment succeeded - run sanity tests
      await addLog(SESSION_ID, 'Step 3: Deployment successful. Running sanity tests...');
      await updateSDLCStatus(SESSION_ID, 'testing', 'Running sanity tests...', undefined, deploymentSessionId);

      const sanityResult = await runSanityTests(deploymentSessionId, deploymentStatus.deployedResources);
      await addLog(SESSION_ID, `Sanity test result: ${sanityResult.status}`);

      if (sanityResult.status === 'success') {
        // Success!
        await addLog(SESSION_ID, '✓ SDLC deployment completed successfully!');
        await updateSDLCStatus(
          SESSION_ID,
          'success',
          'SDLC deployment completed successfully',
          undefined,
          deploymentSessionId,
          sanityResult,
          undefined,
          undefined,
          attemptNumber
        );
        success = true;
        console.log('SDLC deployment completed successfully');
        process.exit(0);
      } else {
        // Sanity tests failed - trigger fixer
        await addLog(SESSION_ID, 'Sanity tests failed. Triggering Fixer module...');
        await updateSDLCStatus(SESSION_ID, 'fixing', 'Sanity tests failed, initiating fix...', undefined, deploymentSessionId, sanityResult);

        const fixInstructions = sanityResult.error || sanityResult.message || 'Fix sanity test failures';
        const fixerSessionId = await triggerFixer(currentBranch, fixInstructions, deploymentStatus.deployedResources);
        await addLog(SESSION_ID, `Fixer initiated with session ID: ${fixerSessionId}`);

        // Wait for fixer to complete
        const fixerResult = await waitForFixer(fixerSessionId);
        await addLog(SESSION_ID, `Fixer completed with status: ${fixerResult.status}`);

        if (fixerResult.status === 'success' && fixerResult.deploymentJob) {
          // Use the new branch created by fixer
          currentBranch = fixerResult.deploymentJob.branch;
          await addLog(SESSION_ID, `Fixer created new branch: ${currentBranch}`);
          await updateSDLCStatus(SESSION_ID, 'deploying', 'Retrying deployment with fixes...', undefined, undefined, sanityResult, fixerSessionId);

          // Continue loop to retry deployment
          continue;
        } else {
          // Fixer failed
          await addLog(SESSION_ID, 'Fixer failed to create a fix');
          await updateSDLCStatus(
            SESSION_ID,
            'failed',
            'SDLC deployment failed: Fixer could not resolve sanity test issues',
            undefined,
            deploymentSessionId,
            sanityResult,
            fixerSessionId,
            'Fixer failed to create a fix',
            attemptNumber
          );
          console.log('SDLC deployment failed: Fixer could not resolve sanity test issues');
          process.exit(1);
        }
      }
    }
  } catch (error) {
    console.error('SDLC Manager error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateSDLCStatus(SESSION_ID, 'failed', 'SDLC deployment failed', [errorMessage], undefined, undefined, undefined, errorMessage);

    process.exit(1);
  }
}

async function triggerDeployment(branch: string): Promise<string> {
  try {
    const response = await axios.post(`${API_BASE_URL}/deploy`, {
      repository: REPOSITORY,
      branch: branch,
      projectRoot: CUSTOM_ROOT_FOLDER || undefined,
    });

    return response.data.sessionId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to trigger deployment: ${errorMessage}`);
  }
}

async function pollStatusAnalyzer(deploymentSessionId: string): Promise<any> {
  let attempts = 0;

  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++;
    await addLog(SESSION_ID, `Polling attempt ${attempts}/${MAX_POLL_ATTEMPTS}...`);

    try {
      const response = await axios.get(`${API_BASE_URL}/analyze/${deploymentSessionId}`);
      const analysis = response.data;

      await addLog(SESSION_ID, `Status: ${analysis.status}`);

      // Check if deployment is complete (success or failed)
      if (analysis.status === 'success' || analysis.status === 'failed') {
        return {
          status: analysis.status,
          summary: analysis.summary,
          rootCause: analysis.rootCause,
          errors: analysis.errors,
          deployedResources: analysis.deployedResources,
          stackDetails: analysis.stackDetails,
        };
      }

      // Still deploying - wait before next poll
      if (attempts < MAX_POLL_ATTEMPTS) {
        await addLog(SESSION_ID, `Deployment still in progress. Waiting ${POLL_INTERVAL_MS / 1000} seconds...`);
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await addLog(SESSION_ID, `Error polling status: ${errorMessage}`);

      // If this was the last attempt, throw error
      if (attempts >= MAX_POLL_ATTEMPTS) {
        throw new Error(`Failed to get deployment status after ${MAX_POLL_ATTEMPTS} attempts`);
      }

      // Otherwise, wait and retry
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // If we get here, deployment didn't complete within polling window
  return {
    status: 'failed',
    summary: `Deployment did not complete after ${MAX_POLL_ATTEMPTS} polling attempts`,
    rootCause: 'Timeout waiting for deployment to complete',
  };
}

async function runSanityTests(deploymentSessionId: string, deployedResources?: Record<string, any>): Promise<any> {
  try {
    // Call sanity tester module
    const response = await axios.post(`${API_BASE_URL}/sanity-test`, {
      deploymentSessionId,
      deployedResources,
      repository: REPOSITORY,
      branch: BRANCH,
    });

    return {
      status: response.data.status || 'success',
      message: response.data.message,
      tests: response.data.tests,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      status: 'failed',
      error: errorMessage,
      message: `Sanity tests failed: ${errorMessage}`,
    };
  }
}

async function triggerFixer(branch: string, fixInstructions: string, stackDetails?: Record<string, any>): Promise<string> {
  try {
    const response = await axios.post(`${API_BASE_URL}/fix`, {
      repository: REPOSITORY,
      branch: branch,
      customRootFolder: CUSTOM_ROOT_FOLDER || undefined,
      fixInstructions,
      stackDetails,
    });

    return response.data.sessionId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to trigger fixer: ${errorMessage}`);
  }
}

async function waitForFixer(fixerSessionId: string): Promise<any> {
  const maxWaitTime = 10 * 60 * 1000; // 10 minutes for fixer
  const pollInterval = 30 * 1000; // 30 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await axios.get(`${API_BASE_URL}/status/${fixerSessionId}`);
      const status = response.data;

      await addLog(SESSION_ID, `Fixer status: ${status.status}`);

      if (status.status === 'success') {
        return {
          status: 'success',
          deploymentJob: status.deploymentJob,
        };
      }

      if (status.status === 'failed') {
        return {
          status: 'failed',
          error: status.error,
        };
      }

      // Still working - wait before next poll
      await addLog(SESSION_ID, `Fixer still working. Waiting ${pollInterval / 1000} seconds...`);
      await sleep(pollInterval);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await addLog(SESSION_ID, `Error polling fixer status: ${errorMessage}`);
      await sleep(pollInterval);
    }
  }

  // Timeout waiting for fixer
  return {
    status: 'failed',
    error: 'Timeout waiting for fixer to complete',
  };
}

async function updateSDLCStatus(
  sessionId: string,
  status: 'pending' | 'deploying' | 'testing' | 'fixing' | 'success' | 'failed' | 'timeout',
  message?: string,
  logs?: string[],
  deploymentSessionId?: string,
  sanityResult?: Record<string, any>,
  fixerSessionId?: string,
  error?: string,
  attemptNumber?: number
): Promise<void> {
  const record: SDLCLog = {
    sessionId,
    timestamp: Date.now(),
    status,
    repository: REPOSITORY,
    branch: BRANCH,
    customRootFolder: CUSTOM_ROOT_FOLDER || undefined,
    message,
    logs,
    deploymentSessionId,
    sanityResult,
    fixerSessionId,
    error,
    attemptNumber,
  };

  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: record,
    })
  );

  console.log(`Status updated: ${status}${message ? ` - ${message}` : ''}`);
}

async function addLog(sessionId: string, logMessage: string): Promise<void> {
  console.log(logMessage);

  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: {
        sessionId,
        timestamp: Date.now(),
        status: 'deploying',
        repository: REPOSITORY,
        branch: BRANCH,
        customRootFolder: CUSTOM_ROOT_FOLDER || undefined,
        logs: [logMessage],
      },
    })
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
