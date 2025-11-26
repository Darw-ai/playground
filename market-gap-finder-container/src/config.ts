/**
 * Configuration Management
 *
 * Centralized configuration for the Market-Gap-Finder Bot.
 * Uses environment variables with sensible defaults.
 */

export interface RedditConfig {
  clientId: string;
  clientSecret: string;
  userAgent: string;
  subreddits: string[];
  keywords: string[];
}

export interface HackerNewsConfig {
  apiUrl: string;
  searchTypes: string[];
  keywords: string[];
}

export interface ReviewsConfig {
  sources: string[]; // g2, capterra, getapp
  categories: string[];
  minStars: number;
  maxStars: number;
}

export interface GitHubConfig {
  token?: string;
  minStars: number;
  maxAgeInDays: number;
}

export interface StorageConfig {
  // S3 Data Lake
  s3Bucket: string;
  s3Prefix: string;

  // Vector Database
  vectorDbType: 'pinecone' | 'chromadb' | 'pgvector';
  vectorDbUrl: string;
  vectorDbApiKey?: string;

  // Blueprint Database
  blueprintDbType: 'dynamodb' | 'firestore' | 'postgresql';
  blueprintDbTable: string;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  embeddingModel: string;
}

export interface ProcessingConfig {
  painPointScoreThreshold: number; // Minimum score to store (0.0 - 1.0)
  clusterSizeThreshold: number; // Minimum cluster size to synthesize
  maxProcessingBatchSize: number;
}

export interface MarketGapFinderConfig {
  reddit: RedditConfig;
  hackerNews: HackerNewsConfig;
  reviews: ReviewsConfig;
  github: GitHubConfig;
  storage: StorageConfig;
  gemini: GeminiConfig;
  processing: ProcessingConfig;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): MarketGapFinderConfig {
  return {
    reddit: {
      clientId: process.env.REDDIT_CLIENT_ID || '',
      clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
      userAgent: process.env.REDDIT_USER_AGENT || 'MarketGapFinder/1.0',
      subreddits: (process.env.REDDIT_SUBREDDITS || 'AppIdeas,Startup_Ideas,SomebodyMakeThis,lightbulb,SideProject,indiehackers,smallbusiness,freelance,gamedev').split(','),
      keywords: (
        process.env.REDDIT_KEYWORDS ||
        'I wish there was an app for,Does anyone know a tool that,How do you all handle,My biggest problem with,looking for a tool,frustrated with'
      ).split(','),
    },
    hackerNews: {
      apiUrl: process.env.HN_API_URL || 'https://hn.algolia.com/api/v1',
      searchTypes: (process.env.HN_SEARCH_TYPES || 'Ask HN,Show HN').split(','),
      keywords: (
        process.env.HN_KEYWORDS ||
        'what tool do you wish existed,how do you solve,what are you using for,recommend a tool'
      ).split(','),
    },
    reviews: {
      sources: (process.env.REVIEW_SOURCES || 'g2,capterra').split(','),
      categories: (
        process.env.REVIEW_CATEGORIES ||
        'Project Management,CRM,Email Marketing,Productivity,Business'
      ).split(','),
      minStars: parseInt(process.env.REVIEW_MIN_STARS || '1', 10),
      maxStars: parseInt(process.env.REVIEW_MAX_STARS || '3', 10),
    },
    github: {
      token: process.env.GITHUB_TOKEN,
      minStars: parseInt(process.env.GITHUB_MIN_STARS || '500', 10),
      maxAgeInDays: parseInt(process.env.GITHUB_MAX_AGE_DAYS || '7', 10),
    },
    storage: {
      s3Bucket: process.env.S3_BUCKET || 'market-gap-finder-data-lake',
      s3Prefix: process.env.S3_PREFIX || 'raw-data',
      vectorDbType: (process.env.VECTOR_DB_TYPE as any) || 'pinecone',
      vectorDbUrl: process.env.VECTOR_DB_URL || '',
      vectorDbApiKey: process.env.VECTOR_DB_API_KEY,
      blueprintDbType: (process.env.BLUEPRINT_DB_TYPE as any) || 'dynamodb',
      blueprintDbTable: process.env.BLUEPRINT_DB_TABLE || 'AppBlueprints',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
    },
    processing: {
      painPointScoreThreshold: parseFloat(process.env.PAIN_POINT_THRESHOLD || '0.7'),
      clusterSizeThreshold: parseInt(process.env.CLUSTER_SIZE_THRESHOLD || '20', 10),
      maxProcessingBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '100', 10),
    },
  };
}

export const config = loadConfig();
