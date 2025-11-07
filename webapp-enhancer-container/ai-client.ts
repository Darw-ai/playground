import Anthropic from '@anthropic-ai/sdk';

interface WebappContext {
  rootPath: string;
  detectedFiles: string[];
  fileTree: string;
  packageJson?: any;
  htmlFiles: string[];
  cssFiles: string[];
  jsFiles: string[];
  configFiles: string[];
  hasFrontend: boolean;
  hasBackend: boolean;
}

interface WebappAnalysis {
  techStack: string[];
  goals: string;
  currentImplementation: string;
  strengths: string[];
  weaknesses: string[];
}

interface EnhancementPlan {
  summary: string;
  enhancements: Array<{
    category: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    impact: string;
  }>;
  filesToModify: string[];
  filesToCreate: string[];
}

export class AIClient {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Analyze the webapp to understand its goals, tech stack, and implementation
   */
  async analyzeWebapp(context: WebappContext): Promise<WebappAnalysis> {
    const prompt = `You are analyzing a web application to understand its purpose, tech stack, and implementation quality.

Repository Information:
- Detected config files: ${context.detectedFiles.join(', ')}
- Has frontend: ${context.hasFrontend}
- Has backend: ${context.hasBackend}
- HTML files: ${context.htmlFiles.length}
- CSS files: ${context.cssFiles.length}
- JS/TS files: ${context.jsFiles.length}

${context.packageJson ? `Package.json dependencies:
${JSON.stringify(context.packageJson.dependencies || {}, null, 2)}

Package.json devDependencies:
${JSON.stringify(context.packageJson.devDependencies || {}, null, 2)}` : ''}

File structure (first 100 files):
${context.fileTree}

Based on this information, please analyze the webapp and provide:

1. **Tech Stack**: List all technologies, frameworks, and libraries being used
2. **Goals**: What is the apparent purpose and goal of this webapp?
3. **Current Implementation**: Brief description of how it's currently implemented
4. **Strengths**: What is done well in this implementation?
5. **Weaknesses**: What could be improved?

Return your analysis as a JSON object with this structure:
{
  "techStack": ["technology1", "technology2", ...],
  "goals": "description of the webapp's goals",
  "currentImplementation": "brief description of current implementation",
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...]
}`;

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Extract JSON from the response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from Claude response');
    }

    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Create an enhancement plan based on the webapp analysis
   */
  async createEnhancementPlan(analysis: WebappAnalysis, context: WebappContext): Promise<EnhancementPlan> {
    const prompt = `You are creating an enhancement plan for a web application to make it more usable, professional, and resilient.

Webapp Analysis:
- Tech Stack: ${analysis.techStack.join(', ')}
- Goals: ${analysis.goals}
- Current Implementation: ${analysis.currentImplementation}
- Strengths: ${analysis.strengths.join(', ')}
- Weaknesses: ${analysis.weaknesses.join(', ')}

Available files in the project:
${context.fileTree}

Your task is to create a comprehensive enhancement plan that:
1. **Improves Usability**: Better UX, accessibility, error handling, user feedback
2. **Increases Professionalism**: Better styling, consistent design, proper structure
3. **Enhances Resilience**: Error boundaries, input validation, loading states, proper error handling

Focus on enhancements that use the SAME tech stack already in the project. Do not introduce new frameworks or major dependencies.

Categories for enhancements:
- UI/UX: Visual improvements, user experience
- Accessibility: ARIA labels, keyboard navigation, screen reader support
- Error Handling: Try-catch blocks, error boundaries, user-friendly error messages
- Performance: Loading states, optimization, caching
- Security: Input validation, XSS prevention, security headers
- Code Quality: Better structure, comments, documentation
- Testing: Test setup (if not present), test examples
- Responsive Design: Mobile-friendly improvements

Return your enhancement plan as a JSON object with this structure:
{
  "summary": "brief summary of the enhancement plan",
  "enhancements": [
    {
      "category": "UI/UX|Accessibility|Error Handling|Performance|Security|Code Quality|Testing|Responsive Design",
      "description": "what will be enhanced",
      "priority": "high|medium|low",
      "impact": "what impact this will have"
    }
  ],
  "filesToModify": ["path/to/file1.js", "path/to/file2.html"],
  "filesToCreate": ["path/to/newfile1.css", "path/to/newfile2.js"]
}

Keep the plan practical and focused on 5-10 high-impact enhancements. List specific files that need to be modified or created.`;

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Extract JSON from the response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from Claude response');
    }

    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Implement the enhancements according to the plan
   */
  async implementEnhancements(
    analysis: WebappAnalysis,
    plan: EnhancementPlan,
    existingFiles: Map<string, string>,
    context: WebappContext
  ): Promise<{ modifiedFiles: Map<string, string>; newFiles: Map<string, string> }> {
    const prompt = `You are implementing enhancements for a web application according to a predefined plan.

Webapp Analysis:
- Tech Stack: ${analysis.techStack.join(', ')}
- Goals: ${analysis.goals}

Enhancement Plan:
${plan.summary}

Enhancements to implement:
${plan.enhancements.map((e, i) => `${i + 1}. [${e.category}] ${e.description} (Priority: ${e.priority})`).join('\n')}

Existing file contents:
${Array.from(existingFiles.entries()).map(([path, content]) => `
=== ${path} ===
${content}
`).join('\n')}

Files to create:
${plan.filesToCreate.join(', ')}

Your task is to implement ALL the enhancements listed above. For each file:
- Modify existing files to implement the enhancements
- Create new files as needed
- Use the SAME tech stack and coding style as the existing code
- Add helpful comments explaining the enhancements
- Ensure the code is production-ready and follows best practices

Return your implementation as a JSON object with this structure:
{
  "modifiedFiles": {
    "path/to/file1.js": "complete new content of the file",
    "path/to/file2.html": "complete new content of the file"
  },
  "newFiles": {
    "path/to/newfile1.css": "complete content of new file",
    "path/to/newfile2.js": "complete content of new file"
  }
}

IMPORTANT: Return the COMPLETE content of each file, not just the changes. Include ALL existing code plus the enhancements.`;

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Extract JSON from the response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from Claude response');
    }

    const result = JSON.parse(jsonMatch[0]);

    // Convert to Map
    const modifiedFiles = new Map<string, string>();
    const newFiles = new Map<string, string>();

    if (result.modifiedFiles) {
      for (const [path, content] of Object.entries(result.modifiedFiles)) {
        modifiedFiles.set(path, content as string);
      }
    }

    if (result.newFiles) {
      for (const [path, content] of Object.entries(result.newFiles)) {
        newFiles.set(path, content as string);
      }
    }

    return { modifiedFiles, newFiles };
  }
}
