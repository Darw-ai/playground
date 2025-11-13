/**
 * Vectorizer
 *
 * Converts text into vector embeddings using the Gemini API.
 * These embeddings are stored in the vector database for semantic search.
 */

import { config } from '../config';

export class Vectorizer {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.embeddingModel;
  }

  /**
   * Generate embedding vector for text
   */
  async vectorize(text: string): Promise<number[]> {
    if (!this.apiKey) {
      console.warn('Gemini API key not configured. Using mock embedding.');
      return this.mockEmbedding(text);
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: {
              parts: [
                {
                  text: text,
                },
              ],
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.embedding.values;
    } catch (error) {
      console.error('Error generating embedding:', error);
      return this.mockEmbedding(text);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async vectorizeBatch(texts: string[], batchSize: number = 10): Promise<number[][]> {
    const embeddings: number[][] = [];

    // Process in batches to avoid rate limits
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await Promise.all(batch.map((text) => this.vectorize(text)));
      embeddings.push(...batchEmbeddings);

      // Rate limiting delay
      if (i + batchSize < texts.length) {
        await this.sleep(1000);
      }
    }

    return embeddings;
  }

  /**
   * Generate a mock embedding for development/testing
   * Uses a simple hash-based approach to generate consistent vectors
   */
  private mockEmbedding(text: string): number[] {
    const dimension = 768; // Typical embedding dimension
    const vector: number[] = [];

    // Simple hash-based mock embedding
    for (let i = 0; i < dimension; i++) {
      const hash = this.simpleHash(text + i);
      vector.push((hash % 2000 - 1000) / 1000); // Normalize to [-1, 1]
    }

    return vector;
  }

  /**
   * Simple string hash function
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  static cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      magnitudeA += vectorA[i] * vectorA[i];
      magnitudeB += vectorB[i] * vectorB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }
}
