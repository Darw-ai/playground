/**
 * Text Cleaner
 *
 * Cleans and normalizes raw text data.
 * Removes HTML, CSS, boilerplate text, and normalizes whitespace.
 */

export class TextCleaner {
  /**
   * Clean raw text
   */
  clean(rawText: string): string {
    let cleaned = rawText;

    // Remove HTML tags
    cleaned = this.removeHtml(cleaned);

    // Remove URLs (but keep the domain for context)
    cleaned = this.normalizeUrls(cleaned);

    // Remove excessive whitespace
    cleaned = this.normalizeWhitespace(cleaned);

    // Remove markdown formatting
    cleaned = this.removeMarkdown(cleaned);

    // Remove special characters that add noise
    cleaned = this.removeNoiseCharacters(cleaned);

    // Trim and normalize line breaks
    cleaned = cleaned.trim();

    return cleaned;
  }

  /**
   * Remove HTML tags
   */
  private removeHtml(text: string): string {
    // Remove script and style elements
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    return text;
  }

  /**
   * Decode HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
    };

    return text.replace(/&[a-z0-9]+;/gi, (entity) => entities[entity] || entity);
  }

  /**
   * Normalize URLs - keep domain but remove full URLs
   */
  private normalizeUrls(text: string): string {
    // Replace full URLs with [URL: domain.com]
    return text.replace(/https?:\/\/(www\.)?([^\/\s]+)[^\s]*/g, (match, www, domain) => {
      return `[URL: ${domain}]`;
    });
  }

  /**
   * Normalize whitespace
   */
  private normalizeWhitespace(text: string): string {
    // Replace multiple spaces with single space
    text = text.replace(/[ \t]+/g, ' ');

    // Replace multiple newlines with double newline
    text = text.replace(/\n\n+/g, '\n\n');

    // Remove spaces at start/end of lines
    text = text.replace(/^ +| +$/gm, '');

    return text;
  }

  /**
   * Remove markdown formatting
   */
  private removeMarkdown(text: string): string {
    // Remove markdown links [text](url)
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    // Remove markdown images ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

    // Remove markdown headers
    text = text.replace(/^#+\s+/gm, '');

    // Remove markdown bold/italic
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');

    // Remove markdown code blocks
    text = text.replace(/```[^```]*```/g, '[CODE]');
    text = text.replace(/`([^`]+)`/g, '$1');

    return text;
  }

  /**
   * Remove noise characters
   */
  private removeNoiseCharacters(text: string): string {
    // Remove excessive punctuation
    text = text.replace(/([!?.]){3,}/g, '$1$1');

    // Remove emojis and special Unicode characters (keep basic punctuation)
    text = text.replace(/[^\x00-\x7F\u0080-\u00FF\u0100-\u017F\u0180-\u024F]/g, '');

    return text;
  }

  /**
   * Extract key sentences (useful for summarization)
   */
  extractKeySentences(text: string, maxSentences: number = 3): string[] {
    // Split into sentences
    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20); // Filter out very short sentences

    // Simple heuristic: prioritize sentences with question words or pain point indicators
    const scoredSentences = sentences.map((sentence) => {
      let score = 0;

      // Boost sentences with question words
      if (/\b(how|what|why|where|when|who|which)\b/i.test(sentence)) {
        score += 2;
      }

      // Boost sentences with pain point indicators
      if (/\b(problem|issue|frustrat|difficult|hard|wish|need|want|missing|lack)\b/i.test(sentence)) {
        score += 3;
      }

      // Boost sentences with tool/product mentions
      if (/\b(tool|app|software|product|service|platform)\b/i.test(sentence)) {
        score += 1;
      }

      return { sentence, score };
    });

    // Sort by score and return top N
    return scoredSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .map((s) => s.sentence);
  }
}
