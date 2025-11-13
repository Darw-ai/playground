/**
 * Sentiment Analyzer
 *
 * Analyzes the emotional tone of text to categorize user sentiment.
 * Helps identify frustrated users vs. hopeful feature requests.
 */

import { Sentiment } from '../types';

export class SentimentAnalyzer {
  /**
   * Analyze sentiment of text
   */
  analyze(text: string): Sentiment {
    const lowerText = text.toLowerCase();

    // Calculate sentiment scores
    const frustratedScore = this.scoreFrustrated(lowerText);
    const angryScore = this.scoreAngry(lowerText);
    const hopefulScore = this.scoreHopeful(lowerText);
    const positiveScore = this.scorePositive(lowerText);

    // Determine dominant sentiment
    const scores = {
      frustrated: frustratedScore,
      angry: angryScore,
      hopeful: hopefulScore,
      positive: positiveScore,
      neutral: 0.3, // Base neutral score
    };

    // Return sentiment with highest score
    const dominant = Object.entries(scores).reduce((a, b) => (b[1] > a[1] ? b : a));

    return dominant[0] as Sentiment;
  }

  /**
   * Score frustrated sentiment
   */
  private scoreFrustrated(text: string): number {
    const patterns = [
      'frustrated',
      'annoying',
      'irritating',
      'disappointing',
      'difficult',
      'struggling',
      'hard to',
      'impossible to',
      'waste of time',
      'painful',
    ];

    return this.calculatePatternScore(text, patterns);
  }

  /**
   * Score angry sentiment
   */
  private scoreAngry(text: string): number {
    const patterns = [
      'angry',
      'hate',
      'terrible',
      'awful',
      'worst',
      'ridiculous',
      'unacceptable',
      'useless',
      'garbage',
      'broken',
    ];

    return this.calculatePatternScore(text, patterns);
  }

  /**
   * Score hopeful sentiment
   */
  private scoreHopeful(text: string): number {
    const patterns = [
      'i wish',
      'hoping for',
      'would love',
      'looking forward',
      'excited',
      'hopefully',
      'can\'t wait',
      'dream',
      'imagine if',
      'potential',
    ];

    return this.calculatePatternScore(text, patterns);
  }

  /**
   * Score positive sentiment
   */
  private scorePositive(text: string): number {
    const patterns = [
      'love',
      'great',
      'excellent',
      'amazing',
      'fantastic',
      'perfect',
      'wonderful',
      'awesome',
      'brilliant',
      'outstanding',
    ];

    return this.calculatePatternScore(text, patterns);
  }

  /**
   * Calculate score based on pattern matches
   */
  private calculatePatternScore(text: string, patterns: string[]): number {
    let score = 0;

    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        score += 0.2;
      }
    }

    // Check for intensifiers
    if (/(very|extremely|really|so|too)\s+/.test(text)) {
      score *= 1.2;
    }

    // Check for negations (reduces score)
    if (/(not|never|no|neither)\s+/.test(text)) {
      score *= 0.5;
    }

    return Math.min(1.0, score);
  }

  /**
   * Analyze sentiment in batch
   */
  analyzeBatch(texts: string[]): Sentiment[] {
    return texts.map((text) => this.analyze(text));
  }

  /**
   * Get sentiment distribution for multiple texts
   */
  getDistribution(texts: string[]): Record<Sentiment, number> {
    const sentiments = this.analyzeBatch(texts);
    const distribution: Record<Sentiment, number> = {
      frustrated: 0,
      angry: 0,
      hopeful: 0,
      neutral: 0,
      positive: 0,
    };

    sentiments.forEach((sentiment) => {
      distribution[sentiment]++;
    });

    // Convert to percentages
    const total = sentiments.length;
    Object.keys(distribution).forEach((key) => {
      distribution[key as Sentiment] = (distribution[key as Sentiment] / total) * 100;
    });

    return distribution;
  }
}
