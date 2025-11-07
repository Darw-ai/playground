/**
 * Central export for all synthesis modules
 */

export * from './cluster-finder';
export * from './problem-summarizer';
export * from './blueprint-generator';

import { ClusterFinder } from './cluster-finder';
import { ProblemSummarizer } from './problem-summarizer';
import { BlueprintGenerator } from './blueprint-generator';
import { ProcessedDataPoint, PainPointCluster, ProblemStatement, AppBlueprint } from '../types';
import { config } from '../config';

/**
 * Synthesis Engine Orchestrator
 *
 * Coordinates the entire synthesis pipeline:
 * Find Clusters -> Summarize Problems -> Generate Blueprints
 */
export class SynthesisEngine {
  private clusterFinder: ClusterFinder;
  private problemSummarizer: ProblemSummarizer;
  private blueprintGenerator: BlueprintGenerator;

  constructor() {
    this.clusterFinder = new ClusterFinder();
    this.problemSummarizer = new ProblemSummarizer();
    this.blueprintGenerator = new BlueprintGenerator();
  }

  /**
   * Run the complete synthesis pipeline
   */
  async synthesize(processedDataPoints: ProcessedDataPoint[]): Promise<AppBlueprint[]> {
    console.log('\n========================================');
    console.log('       SYNTHESIS ENGINE STARTED        ');
    console.log('========================================\n');

    // Step 1: Find clusters
    const clusters = await this.clusterFinder.findClusters(
      processedDataPoints,
      config.processing.clusterSizeThreshold
    );

    if (clusters.length === 0) {
      console.log('No clusters found. Synthesis complete.');
      return [];
    }

    // Step 2: Summarize each cluster into a problem statement
    const problemStatements = await this.problemSummarizer.summarizeBatch(clusters);

    // Step 3: Generate app blueprints
    const clusterMap = new Map<string, PainPointCluster>();
    clusters.forEach((c) => clusterMap.set(c.clusterId, c));

    const blueprints = await this.blueprintGenerator.generateBatch(problemStatements, clusterMap);

    console.log('\n========================================');
    console.log('      SYNTHESIS ENGINE COMPLETE        ');
    console.log('========================================\n');
    console.log(`Results:`);
    console.log(`  - ${clusters.length} clusters identified`);
    console.log(`  - ${problemStatements.length} problem statements generated`);
    console.log(`  - ${blueprints.length} app blueprints created`);
    console.log('');

    return blueprints;
  }

  /**
   * Get synthesis statistics
   */
  getSynthesisStats(clusters: PainPointCluster[], blueprints: AppBlueprint[]) {
    const clusterStats = this.clusterFinder.getClusterStats(clusters);

    return {
      ...clusterStats,
      totalBlueprints: blueprints.length,
      productTypes: this.getProductTypeDistribution(blueprints),
    };
  }

  /**
   * Get product type distribution
   */
  private getProductTypeDistribution(blueprints: AppBlueprint[]): Record<string, number> {
    const distribution: Record<string, number> = {};

    blueprints.forEach((bp) => {
      distribution[bp.productType] = (distribution[bp.productType] || 0) + 1;
    });

    return distribution;
  }
}
