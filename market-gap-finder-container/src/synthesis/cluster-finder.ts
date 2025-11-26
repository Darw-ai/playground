/**
 * Cluster Finder
 *
 * Finds clusters of semantically similar pain points using vector similarity.
 * Uses a simple clustering algorithm based on cosine similarity.
 */

import { ProcessedDataPoint, PainPointCluster } from '../types';
import { Vectorizer } from '../processing/vectorizer';
import { v4 as uuidv4 } from 'uuid';

export class ClusterFinder {
  private similarityThreshold: number;

  constructor(similarityThreshold: number = 0.75) {
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Find clusters in a set of processed data points
   */
  async findClusters(dataPoints: ProcessedDataPoint[], minClusterSize: number = 5): Promise<PainPointCluster[]> {
    console.log(`\n=== Finding clusters in ${dataPoints.length} data points ===`);

    // Filter data points that have vectors
    const pointsWithVectors = dataPoints.filter((dp) => dp.vector && dp.vector.length > 0);

    if (pointsWithVectors.length === 0) {
      console.log('No data points with vectors found');
      return [];
    }

    const clusters: PainPointCluster[] = [];
    const assigned = new Set<string>();

    // Simple greedy clustering algorithm
    for (const centerPoint of pointsWithVectors) {
      if (assigned.has(centerPoint.id)) {
        continue;
      }

      // Find all similar points
      const clusterPoints: ProcessedDataPoint[] = [];

      for (const otherPoint of pointsWithVectors) {
        if (assigned.has(otherPoint.id)) {
          continue;
        }

        if (!centerPoint.vector || !otherPoint.vector) {
          continue;
        }

        const similarity = Vectorizer.cosineSimilarity(centerPoint.vector, otherPoint.vector);

        if (similarity >= this.similarityThreshold) {
          clusterPoints.push(otherPoint);
          assigned.add(otherPoint.id);
        }
      }

      // Only keep clusters that meet minimum size
      if (clusterPoints.length >= minClusterSize) {
        const cluster = this.createCluster(centerPoint, clusterPoints);
        clusters.push(cluster);
        console.log(`Found cluster with ${clusterPoints.length} points (avg score: ${cluster.avgPainPointScore.toFixed(2)})`);
      }
    }

    console.log(`\n=== Found ${clusters.length} clusters ===\n`);

    return clusters;
  }

  /**
   * Create a cluster from a center point and related points
   */
  private createCluster(centerPoint: ProcessedDataPoint, relatedPoints: ProcessedDataPoint[]): PainPointCluster {
    // Calculate average pain point score
    const avgScore = relatedPoints.reduce((sum, dp) => sum + dp.painPointScore, 0) / relatedPoints.length;

    // Merge entities from all points
    const commonEntities = this.mergeEntities(relatedPoints);

    return {
      clusterId: uuidv4(),
      centerPoint,
      relatedPoints,
      clusterSize: relatedPoints.length,
      avgPainPointScore: avgScore,
      commonEntities,
      discoveredAt: new Date(),
    };
  }

  /**
   * Merge entities from multiple data points
   */
  private mergeEntities(dataPoints: ProcessedDataPoint[]) {
    const allProducts = new Set<string>();
    const allFeatures = new Set<string>();
    const allAudiences = new Set<string>();
    const allCompetitors = new Set<string>();

    dataPoints.forEach((dp) => {
      dp.entities.products.forEach((p) => allProducts.add(p));
      dp.entities.features.forEach((f) => allFeatures.add(f));
      dp.entities.audiences.forEach((a) => allAudiences.add(a));
      dp.entities.competitors?.forEach((c) => allCompetitors.add(c));
    });

    return {
      products: Array.from(allProducts),
      features: Array.from(allFeatures),
      audiences: Array.from(allAudiences),
      competitors: Array.from(allCompetitors),
    };
  }

  /**
   * Find the most representative data points in a cluster
   */
  getRepresentativePoints(cluster: PainPointCluster, count: number = 5): ProcessedDataPoint[] {
    // Sort by pain point score and return top N
    return cluster.relatedPoints
      .sort((a, b) => b.painPointScore - a.painPointScore)
      .slice(0, count);
  }

  /**
   * Get cluster statistics
   */
  getClusterStats(clusters: PainPointCluster[]) {
    const totalDataPoints = clusters.reduce((sum, c) => sum + c.clusterSize, 0);
    const avgClusterSize = totalDataPoints / clusters.length;
    const largestCluster = clusters.reduce((max, c) => (c.clusterSize > max.clusterSize ? c : max), clusters[0]);

    return {
      totalClusters: clusters.length,
      totalDataPoints,
      avgClusterSize: Math.round(avgClusterSize),
      largestClusterSize: largestCluster?.clusterSize || 0,
    };
  }
}
