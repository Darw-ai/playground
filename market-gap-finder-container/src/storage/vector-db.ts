/**
 * Vector Database Storage
 *
 * Stores processed pain points as vector embeddings for semantic search.
 * Supports multiple vector database backends (Pinecone, ChromaDB, PGVector).
 */

import { config } from '../config';
import { ProcessedDataPoint, PainPointCluster } from '../types';

export interface VectorSearchResult {
  dataPoint: ProcessedDataPoint;
  score: number;
}

export interface VectorDatabase {
  /**
   * Store a processed data point with its vector embedding
   */
  store(dataPoint: ProcessedDataPoint): Promise<void>;

  /**
   * Store multiple data points in batch
   */
  storeBatch(dataPoints: ProcessedDataPoint[]): Promise<void>;

  /**
   * Search for similar data points using vector similarity
   */
  search(queryVector: number[], k: number): Promise<VectorSearchResult[]>;

  /**
   * Search using text query (will be converted to vector)
   */
  searchByText(query: string, k: number): Promise<VectorSearchResult[]>;

  /**
   * Find clusters of similar pain points
   */
  findClusters(minClusterSize: number): Promise<PainPointCluster[]>;
}

/**
 * Pinecone Vector Database Implementation
 */
export class PineconeVectorDB implements VectorDatabase {
  private apiKey: string;
  private indexUrl: string;

  constructor() {
    this.apiKey = config.storage.vectorDbApiKey || '';
    this.indexUrl = config.storage.vectorDbUrl;
  }

  async store(dataPoint: ProcessedDataPoint): Promise<void> {
    if (!dataPoint.vector) {
      throw new Error('Data point must have a vector embedding');
    }

    await fetch(`${this.indexUrl}/vectors/upsert`, {
      method: 'POST',
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vectors: [
          {
            id: dataPoint.id,
            values: dataPoint.vector,
            metadata: {
              source: dataPoint.source,
              painPointScore: dataPoint.painPointScore,
              sentiment: dataPoint.sentiment,
              cleanedText: dataPoint.cleanedText,
              timestamp: dataPoint.timestamp.toISOString(),
            },
          },
        ],
      }),
    });
  }

  async storeBatch(dataPoints: ProcessedDataPoint[]): Promise<void> {
    const vectors = dataPoints
      .filter((dp) => dp.vector)
      .map((dp) => ({
        id: dp.id,
        values: dp.vector!,
        metadata: {
          source: dp.source,
          painPointScore: dp.painPointScore,
          sentiment: dp.sentiment,
          cleanedText: dp.cleanedText,
          timestamp: dp.timestamp.toISOString(),
        },
      }));

    await fetch(`${this.indexUrl}/vectors/upsert`, {
      method: 'POST',
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vectors }),
    });
  }

  async search(queryVector: number[], k: number): Promise<VectorSearchResult[]> {
    const response = await fetch(`${this.indexUrl}/query`, {
      method: 'POST',
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vector: queryVector,
        topK: k,
        includeMetadata: true,
      }),
    });

    const data = await response.json();
    return data.matches.map((match: any) => ({
      dataPoint: this.metadataToDataPoint(match.id, match.metadata),
      score: match.score,
    }));
  }

  async searchByText(query: string, k: number): Promise<VectorSearchResult[]> {
    // This would require calling the Gemini API to get the embedding
    // For now, throw not implemented
    throw new Error('searchByText requires integration with Gemini API');
  }

  async findClusters(minClusterSize: number): Promise<PainPointCluster[]> {
    // Clustering logic would be implemented here
    // This is a simplified placeholder
    throw new Error('findClusters not yet implemented');
  }

  private metadataToDataPoint(id: string, metadata: any): ProcessedDataPoint {
    // Convert metadata back to ProcessedDataPoint
    // This is a simplified version
    return {
      id,
      source: metadata.source,
      painPointScore: metadata.painPointScore,
      sentiment: metadata.sentiment,
      cleanedText: metadata.cleanedText,
      timestamp: new Date(metadata.timestamp),
    } as ProcessedDataPoint;
  }
}

/**
 * Factory function to create the appropriate vector database implementation
 */
export function createVectorDatabase(): VectorDatabase {
  switch (config.storage.vectorDbType) {
    case 'pinecone':
      return new PineconeVectorDB();
    case 'chromadb':
      throw new Error('ChromaDB not yet implemented');
    case 'pgvector':
      throw new Error('PGVector not yet implemented');
    default:
      throw new Error(`Unknown vector DB type: ${config.storage.vectorDbType}`);
  }
}
