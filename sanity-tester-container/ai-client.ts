import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

export interface APIEndpoint {
  method: string;
  path: string;
  description: string;
  requestSchema?: any;
  responseSchema?: any;
  authentication?: string;
}

export interface APIMap {
  endpoints: APIEndpoint[];
  baseUrl?: string;
  authentication?: {
    type: string;
    details: string;
  };
}

export interface SanityTest {
  name: string;
  description: string;
  steps: TestStep[];
}

export interface TestStep {
  action: string;
  endpoint: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
  expectedStatus: number;
  expectedResponse?: any;
  storeVariables?: Record<string, string>; // e.g., { "userId": "response.id" }
}

export class AIClient {
  private client: BedrockRuntimeClient;
  private modelId: string = 'amazon.nova-pro-v1:0';

  constructor() {
    this.client = new BedrockRuntimeClient({});
  }

  async discoverAPIs(
    repositoryContext: string,
    rootFolder: string
  ): Promise<APIMap> {
    const systemPrompt = `You are an API discovery assistant. Your task is to analyze a codebase and identify all API endpoints, their methods, paths, and schemas.

Look for:
- Express.js, Fastify, Koa routes
- AWS Lambda/API Gateway handlers
- REST API definitions
- GraphQL schemas
- OpenAPI/Swagger specifications

Return your response in JSON format with the following structure:
{
  "endpoints": [
    {
      "method": "GET|POST|PUT|DELETE|PATCH",
      "path": "/api/endpoint/path",
      "description": "What this endpoint does",
      "requestSchema": { ... } (optional),
      "responseSchema": { ... } (optional),
      "authentication": "none|bearer|apiKey|..." (optional)
    }
  ],
  "baseUrl": "https://example.com" (optional),
  "authentication": {
    "type": "bearer|apiKey|basic|...",
    "details": "description of auth mechanism"
  } (optional)
}`;

    const userPrompt = `Please analyze the following codebase and discover all API endpoints.

Root folder: ${rootFolder}

Repository Context:
${repositoryContext}

Identify all API endpoints with their methods, paths, request/response schemas, and authentication requirements.`;

    const command = new ConverseCommand({
      modelId: this.modelId,
      messages: [
        {
          role: 'user',
          content: [{ text: userPrompt }],
        },
      ],
      system: [{ text: systemPrompt }],
      inferenceConfig: {
        maxTokens: 8192,
        temperature: 0.7,
      },
    });

    const response = await this.client.send(command);

    // Extract the text content from the response
    const textContent = response.output?.message?.content?.[0];
    if (!textContent || !('text' in textContent) || !textContent.text) {
      throw new Error('No text content in AI response');
    }

    // Parse the JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from AI response');
    }

    const apiMap: APIMap = JSON.parse(jsonMatch[0]);
    return apiMap;
  }

  async generateSanityTests(
    apiMap: APIMap,
    stackInfo: Record<string, any>
  ): Promise<SanityTest[]> {
    const systemPrompt = `You are a test generation assistant. Your task is to create comprehensive happy-flow sanity tests based on discovered API endpoints.

Create realistic test scenarios that:
1. Test the most critical user journeys (happy paths)
2. Follow logical sequences (e.g., create before update, login before accessing protected resources)
3. Use realistic test data
4. Validate expected responses
5. Store variables from responses for use in subsequent requests (e.g., IDs, tokens)

Return your response in JSON format:
{
  "tests": [
    {
      "name": "Test name",
      "description": "What this test validates",
      "steps": [
        {
          "action": "Description of step",
          "endpoint": "/api/path",
          "method": "GET|POST|PUT|DELETE|PATCH",
          "body": { ... } (optional),
          "headers": { "key": "value" } (optional),
          "expectedStatus": 200,
          "expectedResponse": { ... } (optional),
          "storeVariables": { "variableName": "response.path.to.value" } (optional)
        }
      ]
    }
  ]
}`;

    const userPrompt = `Please generate comprehensive happy-flow sanity tests for the following API.

API Map:
${JSON.stringify(apiMap, null, 2)}

Deployed Stack Information:
${JSON.stringify(stackInfo, null, 2)}

Generate realistic sanity tests that cover the main user journeys. Ensure tests are ordered logically and use stored variables where needed.`;

    const command = new ConverseCommand({
      modelId: this.modelId,
      messages: [
        {
          role: 'user',
          content: [{ text: userPrompt }],
        },
      ],
      system: [{ text: systemPrompt }],
      inferenceConfig: {
        maxTokens: 8192,
        temperature: 0.7,
      },
    });

    const response = await this.client.send(command);

    // Extract the text content from the response
    const textContent = response.output?.message?.content?.[0];
    if (!textContent || !('text' in textContent) || !textContent.text) {
      throw new Error('No text content in AI response');
    }

    // Parse the JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from AI response');
    }

    const result = JSON.parse(jsonMatch[0]);
    return result.tests || [];
  }
}
