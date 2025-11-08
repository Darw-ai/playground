import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { SanityTest, TestStep } from './ai-client';

export interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  steps: StepResult[];
  error?: string;
}

export interface StepResult {
  stepNumber: number;
  action: string;
  passed: boolean;
  duration: number;
  request?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
  };
  response?: {
    status: number;
    data: any;
  };
  error?: string;
}

export class TestExecutor {
  private variables: Map<string, any> = new Map();

  async executeTests(
    tests: SanityTest[],
    baseUrl: string
  ): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const test of tests) {
      console.log(`\nExecuting test: ${test.name}`);
      const result = await this.executeTest(test, baseUrl);
      results.push(result);

      if (!result.passed) {
        console.error(`Test failed: ${test.name}`);
        console.error(`Error: ${result.error}`);
      } else {
        console.log(`Test passed: ${test.name}`);
      }
    }

    return results;
  }

  private async executeTest(
    test: SanityTest,
    baseUrl: string
  ): Promise<TestResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    let testPassed = true;
    let testError: string | undefined;

    try {
      for (let i = 0; i < test.steps.length; i++) {
        const step = test.steps[i];
        console.log(`  Step ${i + 1}: ${step.action}`);

        const stepResult = await this.executeStep(step, baseUrl, i + 1);
        stepResults.push(stepResult);

        if (!stepResult.passed) {
          testPassed = false;
          testError = `Step ${i + 1} failed: ${stepResult.error}`;
          break;
        }
      }
    } catch (error) {
      testPassed = false;
      testError = error instanceof Error ? error.message : String(error);
    }

    const duration = Date.now() - startTime;

    return {
      testName: test.name,
      passed: testPassed,
      duration,
      steps: stepResults,
      error: testError,
    };
  }

  private async executeStep(
    step: TestStep,
    baseUrl: string,
    stepNumber: number
  ): Promise<StepResult> {
    const startTime = Date.now();

    try {
      // Replace variables in endpoint, body, and headers
      const endpoint = this.replaceVariables(step.endpoint);
      const body = step.body ? this.replaceVariables(step.body) : undefined;
      const headers = step.headers
        ? this.replaceVariables(step.headers)
        : undefined;

      // Construct full URL
      const url = this.constructUrl(baseUrl, endpoint);

      // Prepare request config
      const config: AxiosRequestConfig = {
        method: step.method,
        url,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        data: body,
        validateStatus: () => true, // Don't throw on any status
      };

      // Execute request
      const response: AxiosResponse = await axios(config);

      // Check expected status
      const statusMatch = response.status === step.expectedStatus;
      let passed = statusMatch;
      let error: string | undefined;

      if (!statusMatch) {
        error = `Expected status ${step.expectedStatus}, got ${response.status}`;
        passed = false;
      }

      // Validate expected response if provided
      if (passed && step.expectedResponse) {
        const responseMatch = this.validateResponse(
          response.data,
          step.expectedResponse
        );
        if (!responseMatch) {
          error = 'Response data does not match expected response';
          passed = false;
        }
      }

      // Store variables if specified
      if (passed && step.storeVariables) {
        for (const [varName, varPath] of Object.entries(step.storeVariables)) {
          const value = this.extractValue(response.data, varPath);
          this.variables.set(varName, value);
          console.log(`    Stored variable: ${varName} = ${value}`);
        }
      }

      const duration = Date.now() - startTime;

      return {
        stepNumber,
        action: step.action,
        passed,
        duration,
        request: {
          method: step.method,
          url,
          headers,
          body,
        },
        response: {
          status: response.status,
          data: response.data,
        },
        error,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        stepNumber,
        action: step.action,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private constructUrl(baseUrl: string, endpoint: string): string {
    // Remove trailing slash from baseUrl
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    // Ensure endpoint starts with /
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return cleanBaseUrl + cleanEndpoint;
  }

  private replaceVariables(value: any): any {
    if (typeof value === 'string') {
      // Replace ${variableName} with actual value
      return value.replace(/\$\{(\w+)\}/g, (match, varName) => {
        const varValue = this.variables.get(varName);
        return varValue !== undefined ? String(varValue) : match;
      });
    } else if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map((item) => this.replaceVariables(item));
      } else {
        const result: any = {};
        for (const [key, val] of Object.entries(value)) {
          result[key] = this.replaceVariables(val);
        }
        return result;
      }
    }
    return value;
  }

  private extractValue(obj: any, path: string): any {
    // Extract value from object using dot notation (e.g., "response.data.id")
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private validateResponse(actual: any, expected: any): boolean {
    // Simple validation - can be enhanced for more complex scenarios
    if (typeof expected !== 'object' || expected === null) {
      return actual === expected;
    }

    for (const [key, value] of Object.entries(expected)) {
      if (!(key in actual)) {
        return false;
      }
      if (typeof value === 'object' && value !== null) {
        if (!this.validateResponse(actual[key], value)) {
          return false;
        }
      } else if (actual[key] !== value) {
        return false;
      }
    }

    return true;
  }
}
