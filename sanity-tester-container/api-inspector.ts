import * as fs from 'fs';
import * as path from 'path';

export interface InspectionResult {
  files: Map<string, string>;
  summary: string;
}

export class APIInspector {
  private readonly relevantExtensions = [
    '.ts',
    '.js',
    '.tsx',
    '.jsx',
    '.json',
    '.yaml',
    '.yml',
  ];

  private readonly apiKeywords = [
    'router',
    'route',
    'app.get',
    'app.post',
    'app.put',
    'app.delete',
    'app.patch',
    'express',
    'fastify',
    'handler',
    'lambda',
    'apigateway',
    'swagger',
    'openapi',
    'graphql',
  ];

  private readonly excludeDirs = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
  ];

  async inspectCodebase(rootPath: string): Promise<InspectionResult> {
    const files = new Map<string, string>();
    const relevantFiles: string[] = [];

    // Recursively scan directory
    this.scanDirectory(rootPath, rootPath, relevantFiles);

    console.log(`Found ${relevantFiles.length} potentially relevant files`);

    // Read file contents
    for (const filePath of relevantFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const relativePath = path.relative(rootPath, filePath);
        files.set(relativePath, content);
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
      }
    }

    // Create summary
    const summary = this.createSummary(files, rootPath);

    return { files, summary };
  }

  private scanDirectory(
    currentPath: string,
    rootPath: string,
    relevantFiles: string[]
  ): void {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          // Skip excluded directories
          if (!this.excludeDirs.includes(entry.name)) {
            this.scanDirectory(fullPath, rootPath, relevantFiles);
          }
        } else if (entry.isFile()) {
          // Check if file is relevant
          if (this.isRelevantFile(fullPath)) {
            relevantFiles.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${currentPath}:`, error);
    }
  }

  private isRelevantFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath).toLowerCase();

    // Check extension
    if (!this.relevantExtensions.includes(ext)) {
      return false;
    }

    // Priority files
    const priorityFiles = [
      'package.json',
      'openapi.json',
      'swagger.json',
      'openapi.yaml',
      'swagger.yaml',
      'routes.ts',
      'routes.js',
      'api.ts',
      'api.js',
      'index.ts',
      'index.js',
      'app.ts',
      'app.js',
      'server.ts',
      'server.js',
    ];

    if (priorityFiles.includes(fileName)) {
      return true;
    }

    // Check if file contains API-related keywords
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lowerContent = content.toLowerCase();

      return this.apiKeywords.some((keyword) =>
        lowerContent.includes(keyword)
      );
    } catch (error) {
      return false;
    }
  }

  private createSummary(files: Map<string, string>, rootPath: string): string {
    const filesList = Array.from(files.keys());
    const packageJsonPath = filesList.find((f) => f.endsWith('package.json'));

    let summary = `Repository Analysis Summary\n`;
    summary += `Root Path: ${rootPath}\n`;
    summary += `Total API-related files found: ${files.size}\n\n`;

    // Add package.json info if available
    if (packageJsonPath) {
      try {
        const packageJson = JSON.parse(files.get(packageJsonPath) || '{}');
        summary += `Project: ${packageJson.name || 'Unknown'}\n`;
        summary += `Dependencies: ${Object.keys(packageJson.dependencies || {}).join(', ')}\n\n`;
      } catch (error) {
        console.error('Error parsing package.json:', error);
      }
    }

    // List all files
    summary += `Files:\n`;
    filesList.forEach((file) => {
      summary += `  - ${file}\n`;
    });

    return summary;
  }

  createRepositoryContext(inspectionResult: InspectionResult): string {
    let context = inspectionResult.summary + '\n\n';
    context += '--- File Contents ---\n\n';

    for (const [filePath, content] of inspectionResult.files.entries()) {
      // Limit content size for very large files
      const truncatedContent =
        content.length > 10000
          ? content.substring(0, 10000) + '\n... (truncated)'
          : content;

      context += `File: ${filePath}\n`;
      context += '```\n';
      context += truncatedContent;
      context += '\n```\n\n';
    }

    return context;
  }
}
