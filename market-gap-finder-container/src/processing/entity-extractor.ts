/**
 * Entity Extractor
 *
 * Extracts named entities from text:
 * - Products (e.g., "Notion", "Salesforce")
 * - Features (e.g., "Gantt charts", "AI summary")
 * - Audiences (e.g., "small business owners", "freelance writers")
 * - Competitors
 */

import { ExtractedEntities } from '../types';

export class EntityExtractor {
  private productPatterns: RegExp[];
  private featurePatterns: RegExp[];
  private audiencePatterns: RegExp[];

  constructor() {
    // Common product name patterns (usually CamelCase or proper nouns)
    this.productPatterns = [
      /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g, // CamelCase: QuickBooks, Salesforce
      /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g, // Proper nouns: Google Docs, Microsoft Office
    ];

    // Feature-related patterns
    this.featurePatterns = [
      /\b[\w\s]+(chart|graph|report|dashboard|integration|export|import|sync|notification|template|automation)\b/gi,
      /\b(ai|ml|automation|analytics|reporting|collaboration|sharing|versioning)\s+[\w\s]+/gi,
    ];

    // Audience patterns
    this.audiencePatterns = [
      /\b(freelance|freelancer|contractor)s?\b/gi,
      /\b(small business|startup|enterprise|company|organization)s?\b/gi,
      /\b(developer|designer|writer|marketer|analyst|manager|creator|entrepreneur)s?\b/gi,
      /\bas a\s+([\w\s]+)\b/gi, // "as a freelance writer"
      /\bfor\s+([\w\s]+?)\s+(like|who|that)/gi, // "for developers who"
    ];
  }

  /**
   * Extract all entities from text
   */
  extract(text: string): ExtractedEntities {
    return {
      products: this.extractProducts(text),
      features: this.extractFeatures(text),
      audiences: this.extractAudiences(text),
      competitors: this.extractCompetitors(text),
    };
  }

  /**
   * Extract product names
   */
  private extractProducts(text: string): string[] {
    const products = new Set<string>();

    // Use patterns to find potential product names
    for (const pattern of this.productPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const product = match[0].trim();
        // Filter out common non-product proper nouns
        if (this.isLikelyProduct(product)) {
          products.add(product);
        }
      }
    }

    // Also look for explicit product mentions
    const explicitPatterns = [
      /\b(using|use|used|with|in)\s+([A-Z][\w]+(?:\s+[A-Z][\w]+)?)\b/g,
      /\b(tool|app|software|platform|service)\s+(called|named)\s+([\w\s]+)\b/gi,
    ];

    for (const pattern of explicitPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const product = match[match.length - 1]?.trim();
        if (product && this.isLikelyProduct(product)) {
          products.add(product);
        }
      }
    }

    return Array.from(products);
  }

  /**
   * Extract feature mentions
   */
  private extractFeatures(text: string): string[] {
    const features = new Set<string>();

    for (const pattern of this.featurePatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const feature = match[0].trim().toLowerCase();
        if (feature.length > 3 && feature.length < 50) {
          features.add(feature);
        }
      }
    }

    // Look for "need/want X" patterns
    const needWantPattern = /\b(need|want|require|looking for|wish there was)\s+(a |an )?([\w\s]+?)\s+(for|to|that)\b/gi;
    const matches = text.matchAll(needWantPattern);
    for (const match of matches) {
      const feature = match[3]?.trim().toLowerCase();
      if (feature && feature.length > 3 && feature.length < 50) {
        features.add(feature);
      }
    }

    return Array.from(features);
  }

  /**
   * Extract audience mentions
   */
  private extractAudiences(text: string): string[] {
    const audiences = new Set<string>();

    for (const pattern of this.audiencePatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        // Get the last capture group or the full match
        const audience = (match[1] || match[0]).trim().toLowerCase();
        if (audience && audience.length > 2 && audience.length < 50) {
          audiences.add(audience);
        }
      }
    }

    return Array.from(audiences);
  }

  /**
   * Extract competitor mentions
   * These are products mentioned in comparison contexts
   */
  private extractCompetitors(text: string): string[] {
    const competitors = new Set<string>();

    const competitorPatterns = [
      /\balternative to\s+([\w\s]+?)(?:\s+(?:but|because|and|or|\.|\,))/gi,
      /\binstead of\s+([\w\s]+?)(?:\s+(?:but|because|and|or|\.|\,))/gi,
      /\bswitched from\s+([\w\s]+?)(?:\s+(?:to|because|and|or|\.|\,))/gi,
      /\bbetter than\s+([\w\s]+?)(?:\s+(?:but|because|and|or|\.|\,))/gi,
      /\bcompared to\s+([\w\s]+?)(?:\s+(?:but|because|and|or|\.|\,))/gi,
    ];

    for (const pattern of competitorPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const competitor = match[1]?.trim();
        if (competitor && this.isLikelyProduct(competitor)) {
          competitors.add(competitor);
        }
      }
    }

    return Array.from(competitors);
  }

  /**
   * Heuristic to determine if a string is likely a product name
   */
  private isLikelyProduct(text: string): boolean {
    // Filter out common words that aren't products
    const commonWords = [
      'The',
      'This',
      'That',
      'There',
      'These',
      'Those',
      'When',
      'Where',
      'What',
      'Which',
      'Who',
      'How',
      'Why',
      'And',
      'But',
      'Or',
    ];

    if (commonWords.includes(text)) {
      return false;
    }

    // Must be between 2 and 30 characters
    if (text.length < 2 || text.length > 30) {
      return false;
    }

    // Must start with uppercase
    if (!/^[A-Z]/.test(text)) {
      return false;
    }

    return true;
  }

  /**
   * Extract entities in batch
   */
  extractBatch(texts: string[]): ExtractedEntities[] {
    return texts.map((text) => this.extract(text));
  }
}
