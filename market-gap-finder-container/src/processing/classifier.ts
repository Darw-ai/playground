/**
 * Pain Point Classifier
 *
 * Scores text from 0.0 to 1.0 based on how likely it is to be an actionable app idea.
 * Uses rule-based heuristics and pattern matching.
 */

export class PainPointClassifier {
  /**
   * Score a piece of text for pain point quality
   * Returns a score from 0.0 to 1.0
   */
  classify(text: string): number {
    let score = 0.0;
    const lowerText = text.toLowerCase();

    // 1. Check for explicit problem statements (high value)
    score += this.scoreProblemIndicators(lowerText) * 0.3;

    // 2. Check for tool/feature requests (high value)
    score += this.scoreToolRequests(lowerText) * 0.25;

    // 3. Check for comparison/alternative seeking (medium value)
    score += this.scoreComparisons(lowerText) * 0.2;

    // 4. Check for specificity (more specific = better)
    score += this.scoreSpecificity(text) * 0.15;

    // 5. Check for actionability (can this be built?)
    score += this.scoreActionability(lowerText) * 0.1;

    // Clamp to 0.0 - 1.0
    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * Score based on problem indicators
   */
  private scoreProblemIndicators(text: string): number {
    const patterns = [
      { pattern: /i wish there was/i, weight: 1.0 },
      { pattern: /looking for (a |an )?tool/i, weight: 0.9 },
      { pattern: /my biggest problem/i, weight: 0.9 },
      { pattern: /frustrated with/i, weight: 0.8 },
      { pattern: /struggling with/i, weight: 0.8 },
      { pattern: /difficult to/i, weight: 0.7 },
      { pattern: /is there (a |an )?way to/i, weight: 0.7 },
      { pattern: /how (do|can) (i|you)/i, weight: 0.6 },
      { pattern: /pain point/i, weight: 0.8 },
      { pattern: /issue with/i, weight: 0.6 },
    ];

    let score = 0.0;
    for (const { pattern, weight } of patterns) {
      if (pattern.test(text)) {
        score = Math.max(score, weight);
      }
    }

    return score;
  }

  /**
   * Score based on tool/feature requests
   */
  private scoreToolRequests(text: string): number {
    const patterns = [
      { pattern: /does anyone know (a |an )?tool/i, weight: 1.0 },
      { pattern: /recommend (a |an )?(tool|app|software)/i, weight: 0.9 },
      { pattern: /need (a |an )?(tool|app|software) (for|to|that)/i, weight: 0.9 },
      { pattern: /the only thing missing is/i, weight: 0.8 },
      { pattern: /if only it had/i, weight: 0.8 },
      { pattern: /would be great if/i, weight: 0.7 },
      { pattern: /feature request/i, weight: 0.8 },
      { pattern: /missing feature/i, weight: 0.8 },
    ];

    let score = 0.0;
    for (const { pattern, weight } of patterns) {
      if (pattern.test(text)) {
        score = Math.max(score, weight);
      }
    }

    return score;
  }

  /**
   * Score based on comparisons and alternatives
   */
  private scoreComparisons(text: string): number {
    const patterns = [
      { pattern: /alternative to/i, weight: 0.9 },
      { pattern: /better than/i, weight: 0.7 },
      { pattern: /switched (from|to)/i, weight: 0.8 },
      { pattern: /instead of/i, weight: 0.6 },
      { pattern: /compared to/i, weight: 0.5 },
      { pattern: /i love it, but/i, weight: 0.8 },
    ];

    let score = 0.0;
    for (const { pattern, weight } of patterns) {
      if (pattern.test(text)) {
        score = Math.max(score, weight);
      }
    }

    return score;
  }

  /**
   * Score based on specificity
   * More specific = better idea
   */
  private scoreSpecificity(text: string): number {
    let score = 0.0;

    // Check length (too short or too long is bad)
    const wordCount = text.split(/\s+/).length;
    if (wordCount >= 20 && wordCount <= 200) {
      score += 0.5;
    } else if (wordCount >= 10 && wordCount <= 500) {
      score += 0.3;
    }

    // Check for specific technologies/tools mentioned
    if (/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/.test(text)) {
      // CamelCase names (e.g., QuickBooks, Salesforce)
      score += 0.3;
    }

    // Check for specific use cases
    const useCasePatterns = [
      /\bfor (freelancer|small business|developer|designer|writer|marketer)/i,
      /\bas a (freelancer|small business|developer|designer|writer|marketer)/i,
      /\bwhen (i|you|we) (need|want|try) to/i,
    ];

    for (const pattern of useCasePatterns) {
      if (pattern.test(text)) {
        score += 0.2;
        break;
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Score based on actionability
   * Can this be turned into a software product?
   */
  private scoreActionability(text: string): number {
    let score = 0.5; // Default moderate actionability

    // Boost for software-related terms
    const softwareTerms = /\b(app|software|tool|platform|service|website|api|integration|automation|dashboard)\b/i;
    if (softwareTerms.test(text)) {
      score += 0.3;
    }

    // Reduce for vague/abstract requests
    const vagueTerms = /\b(better|easier|faster|simpler)\b/i;
    const vagueCount = (text.match(vagueTerms) || []).length;
    score -= vagueCount * 0.1;

    // Boost for concrete features
    const concreteFeatures = /\b(export|import|sync|notification|report|chart|filter|search|integration|template)\b/i;
    if (concreteFeatures.test(text)) {
      score += 0.3;
    }

    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * Classify in batch
   */
  classifyBatch(texts: string[]): number[] {
    return texts.map((text) => this.classify(text));
  }
}
