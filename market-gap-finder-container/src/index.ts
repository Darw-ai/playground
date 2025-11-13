/**
 * Market-Gap-Finder Bot - Main Entry Point
 *
 * Orchestrates the entire pipeline:
 * 1. Ingestion: Collect raw data from various sources
 * 2. Storage: Save raw data to S3 data lake
 * 3. Processing: Clean, classify, analyze, and vectorize
 * 4. Vector Storage: Store processed data in vector database
 * 5. Synthesis: Find clusters and generate app blueprints
 * 6. Blueprint Storage: Save blueprints to database
 */

import { IngestionOrchestrator } from './ingestion';
import { ProcessingPipeline } from './processing';
import { SynthesisEngine } from './synthesis';
import { DataLake, createVectorDatabase, BlueprintDatabase } from './storage';
import { config } from './config';

export class MarketGapFinderBot {
  private ingestionOrchestrator: IngestionOrchestrator;
  private processingPipeline: ProcessingPipeline;
  private synthesisEngine: SynthesisEngine;
  private dataLake: DataLake;
  private vectorDb: ReturnType<typeof createVectorDatabase>;
  private blueprintDb: BlueprintDatabase;

  constructor() {
    this.ingestionOrchestrator = new IngestionOrchestrator();
    this.processingPipeline = new ProcessingPipeline();
    this.synthesisEngine = new SynthesisEngine();
    this.dataLake = new DataLake();
    this.vectorDb = createVectorDatabase();
    this.blueprintDb = new BlueprintDatabase();
  }

  /**
   * Run the complete pipeline
   */
  async run(): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║        MARKET-GAP-FINDER BOT - STARTING               ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const startTime = Date.now();

    try {
      // Step 1: Ingestion
      console.log('📥 STEP 1: DATA INGESTION');
      console.log('─────────────────────────────────────────────────────────\n');
      const rawDataPoints = await this.ingestionOrchestrator.runAll();

      if (rawDataPoints.length === 0) {
        console.log('⚠️  No data points collected. Exiting.');
        return;
      }

      // Step 2: Store raw data in data lake
      console.log('\n💾 STEP 2: STORING RAW DATA IN DATA LAKE');
      console.log('─────────────────────────────────────────────────────────\n');
      await this.dataLake.storeBatch(rawDataPoints);
      console.log(`✓ Stored ${rawDataPoints.length} raw data points in S3\n`);

      // Step 3: Process data
      console.log('\n⚙️  STEP 3: DATA PROCESSING');
      console.log('─────────────────────────────────────────────────────────');
      const processedDataPoints = await this.processingPipeline.processBatch(rawDataPoints);

      if (processedDataPoints.length === 0) {
        console.log('⚠️  No data points passed quality threshold. Exiting.');
        return;
      }

      // Show processing statistics
      const processingStats = this.processingPipeline.getStatistics(processedDataPoints);
      console.log('\nProcessing Statistics:');
      console.log(`  Total Processed: ${processingStats.totalProcessed}`);
      console.log(`  Avg Pain Point Score: ${processingStats.avgPainPointScore.toFixed(2)}`);
      console.log(`  Sentiment Distribution:`, processingStats.sentimentDistribution);
      console.log('');

      // Step 4: Store in vector database
      console.log('\n🔢 STEP 4: STORING IN VECTOR DATABASE');
      console.log('─────────────────────────────────────────────────────────\n');
      await this.vectorDb.storeBatch(processedDataPoints);
      console.log(`✓ Stored ${processedDataPoints.length} vectors in database\n`);

      // Step 5: Synthesis
      console.log('\n🎨 STEP 5: SYNTHESIS - GENERATING APP BLUEPRINTS');
      console.log('─────────────────────────────────────────────────────────');
      const blueprints = await this.synthesisEngine.synthesize(processedDataPoints);

      if (blueprints.length === 0) {
        console.log('⚠️  No app blueprints generated. May need more data or lower thresholds.');
        return;
      }

      // Step 6: Store blueprints
      console.log('\n📋 STEP 6: STORING APP BLUEPRINTS');
      console.log('─────────────────────────────────────────────────────────\n');
      const storedBlueprints = await Promise.all(blueprints.map((bp) => this.blueprintDb.store(bp)));
      console.log(`✓ Stored ${storedBlueprints.length} blueprints in database\n`);

      // Summary
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('\n╔════════════════════════════════════════════════════════╗');
      console.log('║        MARKET-GAP-FINDER BOT - COMPLETE               ║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      console.log('Summary:');
      console.log(`  ⏱️  Duration: ${duration}s`);
      console.log(`  📥 Data Points Collected: ${rawDataPoints.length}`);
      console.log(`  ✅ Data Points Processed: ${processedDataPoints.length}`);
      console.log(`  🎯 App Blueprints Generated: ${blueprints.length}`);
      console.log('');

      // Show blueprint names
      console.log('Generated Apps:');
      blueprints.forEach((bp, i) => {
        console.log(`  ${i + 1}. ${bp.appName} (${bp.productType})`);
        console.log(`     "${bp.elevatorPitch}"`);
      });
      console.log('');
    } catch (error) {
      console.error('\n❌ ERROR:', error);
      throw error;
    }
  }

  /**
   * Run only ingestion (useful for testing or scheduled jobs)
   */
  async runIngestionOnly(): Promise<void> {
    console.log('Running ingestion only...\n');
    const rawDataPoints = await this.ingestionOrchestrator.runAll();
    await this.dataLake.storeBatch(rawDataPoints);
    console.log(`\n✓ Ingestion complete: ${rawDataPoints.length} data points stored\n`);
  }

  /**
   * Run processing on existing data in data lake
   */
  async runProcessingOnly(startDate: Date, endDate: Date): Promise<void> {
    console.log('Running processing on existing data...\n');

    // Fetch data from data lake
    const sources = ['reddit', 'hackernews', 'github', 'reviews'];
    const allRawData = [];

    for (const source of sources) {
      const keys = await this.dataLake.listBySourceAndDateRange(source, startDate, endDate);
      const dataPoints = await Promise.all(keys.map((key) => this.dataLake.retrieve(key)));
      allRawData.push(...dataPoints.filter((dp) => dp !== null));
    }

    console.log(`Fetched ${allRawData.length} data points from data lake\n`);

    // Process
    const processedDataPoints = await this.processingPipeline.processBatch(allRawData as any);

    // Store in vector database
    await this.vectorDb.storeBatch(processedDataPoints);

    console.log(`\n✓ Processing complete: ${processedDataPoints.length} data points processed\n`);
  }

  /**
   * Run synthesis on existing processed data
   */
  async runSynthesisOnly(): Promise<void> {
    console.log('Running synthesis on existing data...\n');

    // This would require fetching from vector database
    // For now, this is a placeholder
    console.log('Note: Synthesis-only mode requires fetching from vector database');
    console.log('This is a placeholder for future implementation');
  }
}

/**
 * CLI Entry Point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'run';

  const bot = new MarketGapFinderBot();

  switch (command) {
    case 'run':
      await bot.run();
      break;
    case 'ingest':
      await bot.runIngestionOnly();
      break;
    case 'process':
      const startDate = args[1] ? new Date(args[1]) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const endDate = args[2] ? new Date(args[2]) : new Date();
      await bot.runProcessingOnly(startDate, endDate);
      break;
    case 'synthesize':
      await bot.runSynthesisOnly();
      break;
    default:
      console.log('Unknown command. Available commands: run, ingest, process, synthesize');
      process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default MarketGapFinderBot;
