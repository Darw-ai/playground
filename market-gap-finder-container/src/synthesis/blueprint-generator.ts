/**
 * Blueprint Generator
 *
 * The final step: generates a complete App Blueprint from a problem statement.
 * Uses Gemini AI to act as an "App Architect" and fill out the structured schema.
 */

import { ProblemStatement, AppBlueprint, Evidence, PainPointCluster } from '../types';
import { config } from '../config';

export class BlueprintGenerator {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
  }

  /**
   * Generate an App Blueprint from a problem statement
   */
  async generate(problemStatement: ProblemStatement, cluster: PainPointCluster): Promise<AppBlueprint> {
    console.log(`Generating blueprint for problem: "${problemStatement.statement.substring(0, 100)}..."`);

    // Build prompt for Gemini
    const prompt = this.buildBlueprintPrompt(problemStatement, cluster);

    // Call Gemini API
    const response = await this.callGemini(prompt);

    // Parse the JSON response
    const blueprint = this.parseBlueprint(response, problemStatement, cluster);

    console.log(`✓ Blueprint generated: "${blueprint.appName}"`);

    return blueprint;
  }

  /**
   * Build the prompt for blueprint generation
   */
  private buildBlueprintPrompt(problemStatement: ProblemStatement, cluster: PainPointCluster): string {
    // Get evidence snippets
    const evidenceSnippets = cluster.relatedPoints
      .slice(0, 10)
      .map((dp) => `- "${dp.cleanedText.substring(0, 200)}..." (Source: ${dp.source})`)
      .join('\n');

    return `You are an expert App Architect. Your job is to design a new application based on user research.

PROBLEM STATEMENT:
${problemStatement.statement}

TARGET AUDIENCE:
${problemStatement.targetAudience}

COMPETITORS:
${problemStatement.competitors.join(', ') || 'None identified'}

MISSING FEATURES:
${problemStatement.missingFeatures.join(', ') || 'None identified'}

EVIDENCE (Sample user complaints):
${evidenceSnippets}

Your task is to design a new application that solves this problem. Provide your design as a JSON object following this EXACT schema:

{
  "appName": "A catchy, memorable name for the app (2-3 words)",
  "productType": "One of: SaaS, Mobile App (iOS/Android), Web Tool, Game, Browser Extension, Developer Tool",
  "elevatorPitch": "One sentence description of what the app does and why it's valuable",
  "problemStatement": "The problem statement from above",
  "targetAudience": "The target audience from above",
  "userStories": [
    "As a [user type], I want to [action] so that [benefit]",
    "As a [user type], I want to [action] so that [benefit]",
    "As a [user type], I want to [action] so that [benefit]"
  ],
  "coreFeatures": [
    {
      "featureName": "Feature name",
      "description": "What this feature does"
    },
    {
      "featureName": "Feature name",
      "description": "What this feature does"
    }
  ],
  "keyDifferentiators": [
    "How this is better than competitors",
    "Another differentiator",
    "Another differentiator"
  ],
  "monetizationStrategy": "One of: Freemium, One-time Purchase, Monthly Subscription (SaaS), Usage-Based (API), Ad-Supported"
}

Respond ONLY with valid JSON. Do not include any text before or after the JSON.`;
  }

  /**
   * Call Gemini API
   */
  private async callGemini(prompt: string): Promise<string> {
    if (!this.apiKey) {
      console.warn('Gemini API key not configured. Using mock blueprint.');
      return this.mockBlueprint();
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
              temperature: 0.8,
              maxOutputTokens: 2048,
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
      return this.mockBlueprint();
    }
  }

  /**
   * Parse the Gemini response into an AppBlueprint
   */
  private parseBlueprint(response: string, problemStatement: ProblemStatement, cluster: PainPointCluster): AppBlueprint {
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Build evidence array
      const evidence: Evidence[] = cluster.relatedPoints.slice(0, 10).map((dp) => ({
        snippet: dp.cleanedText.substring(0, 200) + (dp.cleanedText.length > 200 ? '...' : ''),
        source: `${dp.sourceIdentifier}`,
        url: dp.sourceUrl,
      }));

      // Ensure all required fields are present
      const blueprint: AppBlueprint = {
        appName: parsed.appName || 'Unnamed App',
        productType: parsed.productType || 'Web Tool',
        elevatorPitch: parsed.elevatorPitch || '',
        problemStatement: problemStatement.statement,
        targetAudience: problemStatement.targetAudience,
        userStories: parsed.userStories || [],
        coreFeatures: parsed.coreFeatures || [],
        keyDifferentiators: parsed.keyDifferentiators || [],
        monetizationStrategy: parsed.monetizationStrategy || 'Freemium',
        evidence,
      };

      return blueprint;
    } catch (error) {
      console.error('Error parsing blueprint:', error);
      // Return a fallback blueprint
      return this.fallbackBlueprint(problemStatement, cluster);
    }
  }

  /**
   * Fallback blueprint if parsing fails
   */
  private fallbackBlueprint(problemStatement: ProblemStatement, cluster: PainPointCluster): AppBlueprint {
    const evidence: Evidence[] = cluster.relatedPoints.slice(0, 10).map((dp) => ({
      snippet: dp.cleanedText.substring(0, 200) + (dp.cleanedText.length > 200 ? '...' : ''),
      source: `${dp.sourceIdentifier}`,
      url: dp.sourceUrl,
    }));

    return {
      appName: 'Unnamed Solution',
      productType: 'Web Tool',
      elevatorPitch: problemStatement.statement,
      problemStatement: problemStatement.statement,
      targetAudience: problemStatement.targetAudience,
      userStories: [],
      coreFeatures: problemStatement.missingFeatures.map((feature) => ({
        featureName: feature,
        description: `Implement ${feature} functionality`,
      })),
      keyDifferentiators: ['Addresses user pain points identified in research'],
      monetizationStrategy: 'Freemium',
      evidence,
    };
  }

  /**
   * Mock blueprint for development
   */
  private mockBlueprint(): string {
    return JSON.stringify({
      appName: 'InvoiceFlow',
      productType: 'Web Tool',
      elevatorPitch: 'Simple, beautiful invoicing for freelancers who hate accounting software.',
      userStories: [
        'As a freelancer, I want to create an invoice in under 60 seconds so that I can focus on my work',
        'As a contractor, I want automatic payment reminders so that I get paid on time',
        'As a small business owner, I want to track expenses in one place so that tax time is easier',
      ],
      coreFeatures: [
        {
          featureName: 'One-Click Invoicing',
          description: 'Create professional invoices with a single click from predefined templates',
        },
        {
          featureName: 'Automated Reminders',
          description: 'Automatic email reminders for overdue invoices',
        },
        {
          featureName: 'Expense Tracking',
          description: 'Simple expense categorization and receipt uploads',
        },
        {
          featureName: 'PDF Export',
          description: 'Download invoices as professional PDFs',
        },
      ],
      keyDifferentiators: [
        'Simpler than QuickBooks with 90% fewer features (and 90% of the value)',
        'Beautiful, modern design vs. dated enterprise UI',
        'Free tier with unlimited invoices (competitors charge per invoice)',
        'Mobile-first design for on-the-go freelancers',
      ],
      monetizationStrategy: 'Freemium',
    });
  }

  /**
   * Generate blueprints for multiple problem statements
   */
  async generateBatch(
    problemStatements: ProblemStatement[],
    clusterMap: Map<string, PainPointCluster>
  ): Promise<AppBlueprint[]> {
    console.log(`\n=== Generating ${problemStatements.length} app blueprints ===`);

    const blueprints: AppBlueprint[] = [];

    for (const statement of problemStatements) {
      try {
        const cluster = clusterMap.get(statement.clusterId);
        if (!cluster) {
          console.error(`Cluster ${statement.clusterId} not found`);
          continue;
        }

        const blueprint = await this.generate(statement, cluster);
        blueprints.push(blueprint);

        // Rate limiting
        await this.sleep(3000);
      } catch (error) {
        console.error(`Error generating blueprint for cluster ${statement.clusterId}:`, error);
      }
    }

    console.log(`\n=== Generated ${blueprints.length} app blueprints ===\n`);

    return blueprints;
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
