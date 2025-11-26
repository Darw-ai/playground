/**
 * Problem Summarizer
 *
 * Uses Gemini AI to analyze clusters of pain points and generate
 * a structured problem statement.
 */

import { PainPointCluster, ProblemStatement } from '../types';
import { config } from '../config';

export class ProblemSummarizer {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
  }

  /**
   * Summarize a cluster into a problem statement
   */
  async summarize(cluster: PainPointCluster): Promise<ProblemStatement> {
    console.log(`Summarizing cluster ${cluster.clusterId} (${cluster.clusterSize} points)...`);

    // Get top pain points from cluster
    const topPoints = cluster.relatedPoints
      .sort((a, b) => b.painPointScore - a.painPointScore)
      .slice(0, 30);

    // Build prompt for Gemini
    const prompt = this.buildSummarizationPrompt(topPoints, cluster);

    // Call Gemini API
    const summary = await this.callGemini(prompt);

    // Parse the response
    const problemStatement = this.parseSummary(summary, cluster);

    console.log(`✓ Problem statement generated for cluster ${cluster.clusterId}`);

    return problemStatement;
  }

  /**
   * Build the prompt for problem summarization
   */
  private buildSummarizationPrompt(topPoints: any[], cluster: PainPointCluster): string {
    const painPoints = topPoints.map((dp, i) => `${i + 1}. "${dp.cleanedText}"`).join('\n');

    return `You are a senior product manager analyzing user feedback and complaints.

Below are ${topPoints.length} related user complaints and pain points:

${painPoints}

Your task is to analyze these complaints and identify:
1. The CORE PROBLEM that users are experiencing
2. The TARGET AUDIENCE experiencing this problem
3. Any COMPETITORS or existing solutions mentioned
4. Any MISSING FEATURES that users are requesting

Please provide your analysis in the following format:

PROBLEM STATEMENT:
[A clear, concise 2-3 sentence statement of the core problem]

TARGET AUDIENCE:
[Detailed description of who experiences this problem]

COMPETITORS:
[Comma-separated list of competitors or existing solutions mentioned, or "None" if not mentioned]

MISSING FEATURES:
[Comma-separated list of features users want but don't have, or "None" if not clear]

Be specific and actionable. Focus on recurring themes across multiple complaints.`;
  }

  /**
   * Call Gemini API
   */
  private async callGemini(prompt: string): Promise<string> {
    if (!this.apiKey) {
      console.warn('Gemini API key not configured. Using mock response.');
      return this.mockResponse();
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1000,
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      return this.mockResponse();
    }
  }

  /**
   * Parse the Gemini response into a ProblemStatement
   */
  private parseSummary(summary: string, cluster: PainPointCluster): ProblemStatement {
    const lines = summary.split('\n');

    let problemStatement = '';
    let targetAudience = '';
    let competitors: string[] = [];
    let missingFeatures: string[] = [];

    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('PROBLEM STATEMENT:')) {
        currentSection = 'problem';
        continue;
      } else if (trimmed.startsWith('TARGET AUDIENCE:')) {
        currentSection = 'audience';
        continue;
      } else if (trimmed.startsWith('COMPETITORS:')) {
        currentSection = 'competitors';
        continue;
      } else if (trimmed.startsWith('MISSING FEATURES:')) {
        currentSection = 'features';
        continue;
      }

      if (trimmed.length === 0) continue;

      switch (currentSection) {
        case 'problem':
          problemStatement += (problemStatement ? ' ' : '') + trimmed;
          break;
        case 'audience':
          targetAudience += (targetAudience ? ' ' : '') + trimmed;
          break;
        case 'competitors':
          if (trimmed.toLowerCase() !== 'none') {
            competitors = trimmed.split(',').map((c) => c.trim());
          }
          break;
        case 'features':
          if (trimmed.toLowerCase() !== 'none') {
            missingFeatures = trimmed.split(',').map((f) => f.trim());
          }
          break;
      }
    }

    return {
      clusterId: cluster.clusterId,
      statement: problemStatement || 'Problem statement could not be generated',
      targetAudience: targetAudience || 'Target audience not identified',
      competitors: competitors.length > 0 ? competitors : cluster.commonEntities.competitors || [],
      missingFeatures: missingFeatures.length > 0 ? missingFeatures : cluster.commonEntities.features,
      evidenceCount: cluster.clusterSize,
      generatedAt: new Date(),
    };
  }

  /**
   * Mock response for development
   */
  private mockResponse(): string {
    return `PROBLEM STATEMENT:
Users need a simpler way to manage invoices and payments for freelance work without the complexity of enterprise accounting software.

TARGET AUDIENCE:
Freelancers, contractors, and small business owners who need basic invoicing capabilities but find existing solutions too complex or expensive.

COMPETITORS:
QuickBooks, FreshBooks, Wave

MISSING FEATURES:
One-click invoice generation, automated payment reminders, simple expense tracking, PDF export`;
  }

  /**
   * Summarize multiple clusters in batch
   */
  async summarizeBatch(clusters: PainPointCluster[]): Promise<ProblemStatement[]> {
    console.log(`\n=== Summarizing ${clusters.length} clusters ===`);

    const statements: ProblemStatement[] = [];

    for (const cluster of clusters) {
      try {
        const statement = await this.summarize(cluster);
        statements.push(statement);

        // Rate limiting
        await this.sleep(2000);
      } catch (error) {
        console.error(`Error summarizing cluster ${cluster.clusterId}:`, error);
      }
    }

    console.log(`\n=== Generated ${statements.length} problem statements ===\n`);

    return statements;
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
