import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

export interface FixPlan {
  summary: string;
  steps: string[];
  filesToModify: string[];
}

export class AIClient {
  private client: BedrockRuntimeClient;
  private modelId: string = 'amazon.nova-pro-v1:0';

  constructor() {
    this.client = new BedrockRuntimeClient({});
  }

  async createFixPlan(
    fixInstructions: string,
    repositoryContext: string,
    stackDetails?: Record<string, any>
  ): Promise<FixPlan> {
    const systemPrompt = `You are a code fixing assistant. Your task is to analyze the fix instructions and repository context, then create a detailed fix plan.

Return your response in JSON format with the following structure:
{
  "summary": "Brief summary of what needs to be fixed",
  "steps": ["Step 1", "Step 2", ...],
  "filesToModify": ["path/to/file1.ts", "path/to/file2.ts", ...]
}`;

    const userPrompt = `Fix Instructions: ${fixInstructions}

Repository Context:
${repositoryContext}

${stackDetails ? `Stack Details:\n${JSON.stringify(stackDetails, null, 2)}` : ''}

Please create a detailed fix plan.`;

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
        maxTokens: 4096,
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

    const fixPlan: FixPlan = JSON.parse(jsonMatch[0]);
    return fixPlan;
  }

  async implementFix(
    fixInstructions: string,
    fixPlan: FixPlan,
    fileContents: Map<string, string>,
    stackDetails?: Record<string, any>
  ): Promise<Map<string, string>> {
    const systemPrompt = `You are a code fixing assistant. Your task is to implement the fix according to the plan and instructions provided.

For each file that needs to be modified, provide the complete new content. Return your response in JSON format:
{
  "files": {
    "path/to/file1.ts": "complete new file content",
    "path/to/file2.ts": "complete new file content"
  }
}`;

    const filesContext = Array.from(fileContents.entries())
      .map(([path, content]) => `File: ${path}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');

    const userPrompt = `Fix Instructions: ${fixInstructions}

Fix Plan:
Summary: ${fixPlan.summary}
Steps:
${fixPlan.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

Current File Contents:
${filesContext}

${stackDetails ? `Stack Details:\n${JSON.stringify(stackDetails, null, 2)}` : ''}

Please implement the fix by providing the complete new content for each file that needs to be modified.`;

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
    const modifiedFiles = new Map<string, string>();

    for (const [filePath, content] of Object.entries(result.files)) {
      modifiedFiles.set(filePath, content as string);
    }

    return modifiedFiles;
  }
}
