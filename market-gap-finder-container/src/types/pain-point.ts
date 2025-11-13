/**
 * Pain Point and Raw Data Types
 *
 * These types represent the intermediate data structures used throughout the pipeline.
 */

export type SourceType =
  | 'reddit'
  | 'hackernews'
  | 'indie_hackers'
  | 'app_store'
  | 'play_store'
  | 'g2'
  | 'capterra'
  | 'github'
  | 'google_trends'
  | 'techcrunch';

export type Sentiment = 'frustrated' | 'angry' | 'hopeful' | 'neutral' | 'positive';

export interface RawDataPoint {
  id: string;
  source: SourceType;
  sourceUrl: string;
  sourceIdentifier: string; // e.g., subreddit name, review ID
  timestamp: Date;
  rawText: string;
  metadata: Record<string, any>;
}

export interface ProcessedDataPoint extends RawDataPoint {
  cleanedText: string;
  painPointScore: number; // 0.0 to 1.0
  sentiment: Sentiment;
  entities: ExtractedEntities;
  vector?: number[]; // Text embedding
}

export interface ExtractedEntities {
  products: string[]; // e.g., ["Notion", "Salesforce"]
  features: string[]; // e.g., ["Gantt charts", "AI summary"]
  audiences: string[]; // e.g., ["small business owners", "freelance writers"]
  competitors?: string[];
}

export interface PainPointCluster {
  clusterId: string;
  centerPoint: ProcessedDataPoint;
  relatedPoints: ProcessedDataPoint[];
  clusterSize: number;
  avgPainPointScore: number;
  commonEntities: ExtractedEntities;
  discoveredAt: Date;
}

export interface ProblemStatement {
  clusterId: string;
  statement: string;
  targetAudience: string;
  competitors: string[];
  missingFeatures: string[];
  evidenceCount: number;
  generatedAt: Date;
}
