/**
 * Central export for all processing modules
 */

export * from './cleaner';
export * from './classifier';
export * from './sentiment-analyzer';
export * from './entity-extractor';
export * from './vectorizer';

import { TextCleaner } from './cleaner';
import { PainPointClassifier } from './classifier';
import { SentimentAnalyzer } from './sentiment-analyzer';
import { EntityExtractor } from './entity-extractor';
import { Vectorizer } from './vectorizer';
import { RawDataPoint, ProcessedDataPoint } from '../types';
import { config } from '../config';

/**
 * Processing Pipeline Orchestrator
 *
 * Coordinates the entire data processing pipeline:
 * Clean -> Classify -> Analyze -> Extract -> Vectorize
 */
export class ProcessingPipeline {
  private cleaner: TextCleaner;
  private classifier: PainPointClassifier;
  private sentimentAnalyzer: SentimentAnalyzer;
  private entityExtractor: EntityExtractor;
  private vectorizer: Vectorizer;

  constructor() {
    this.cleaner = new TextCleaner();
    this.classifier = new PainPointClassifier();
    this.sentimentAnalyzer = new SentimentAnalyzer();
    this.entityExtractor = new EntityExtractor();
    this.vectorizer = new Vectorizer();
  }

  /**
   * Process a single raw data point
   */
  async process(rawDataPoint: RawDataPoint): Promise<ProcessedDataPoint | null> {
    try {
      // Step 1: Clean the text
      const cleanedText = this.cleaner.clean(rawDataPoint.rawText);

      // Step 2: Classify pain point score
      const painPointScore = this.classifier.classify(cleanedText);

      // Filter out low-quality data points
      if (painPointScore < config.processing.painPointScoreThreshold) {
        console.log(`Filtered out low-quality data point (score: ${painPointScore.toFixed(2)})`);
        return null;
      }

      // Step 3: Analyze sentiment
      const sentiment = this.sentimentAnalyzer.analyze(cleanedText);

      // Step 4: Extract entities
      const entities = this.entityExtractor.extract(cleanedText);

      // Step 5: Generate vector embedding
      const vector = await this.vectorizer.vectorize(cleanedText);

      const processedDataPoint: ProcessedDataPoint = {
        ...rawDataPoint,
        cleanedText,
        painPointScore,
        sentiment,
        entities,
        vector,
      };

      return processedDataPoint;
    } catch (error) {
      console.error(`Error processing data point ${rawDataPoint.id}:`, error);
      return null;
    }
  }

  /**
   * Process multiple data points in batch
   */
  async processBatch(rawDataPoints: RawDataPoint[]): Promise<ProcessedDataPoint[]> {
    console.log(`\n=== Processing ${rawDataPoints.length} data points ===`);

    const processed: ProcessedDataPoint[] = [];
    const batchSize = config.processing.maxProcessingBatchSize;

    for (let i = 0; i < rawDataPoints.length; i += batchSize) {
      const batch = rawDataPoints.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rawDataPoints.length / batchSize)}...`);

      const batchResults = await Promise.all(batch.map((dp) => this.process(dp)));

      // Filter out null results
      const validResults = batchResults.filter((result): result is ProcessedDataPoint => result !== null);
      processed.push(...validResults);

      console.log(`Batch complete. Valid: ${validResults.length}/${batch.length}`);
    }

    console.log(`\n=== Processing Complete: ${processed.length}/${rawDataPoints.length} data points passed threshold ===\n`);

    return processed;
  }

  /**
   * Get processing statistics
   */
  getStatistics(processedDataPoints: ProcessedDataPoint[]): ProcessingStatistics {
    const sentimentCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    const avgPainPointScore =
      processedDataPoints.reduce((sum, dp) => sum + dp.painPointScore, 0) / processedDataPoints.length;

    processedDataPoints.forEach((dp) => {
      sentimentCounts[dp.sentiment] = (sentimentCounts[dp.sentiment] || 0) + 1;
      sourceCounts[dp.source] = (sourceCounts[dp.source] || 0) + 1;
    });

    return {
      totalProcessed: processedDataPoints.length,
      avgPainPointScore,
      sentimentDistribution: sentimentCounts,
      sourceDistribution: sourceCounts,
    };
  }
}

export interface ProcessingStatistics {
  totalProcessed: number;
  avgPainPointScore: number;
  sentimentDistribution: Record<string, number>;
  sourceDistribution: Record<string, number>;
}
