/**
 * Central export for all ingestion modules
 */

export * from './reddit-listener';
export * from './hackernews-listener';
export * from './reviews-listener';
export * from './github-listener';

import { RedditListener } from './reddit-listener';
import { HackerNewsListener } from './hackernews-listener';
import { ReviewsListener } from './reviews-listener';
import { GitHubListener } from './github-listener';
import { RawDataPoint } from '../types';

/**
 * Orchestrator for all data ingestion
 */
export class IngestionOrchestrator {
  private redditListener: RedditListener;
  private hackerNewsListener: HackerNewsListener;
  private reviewsListener: ReviewsListener;
  private githubListener: GitHubListener;

  constructor() {
    this.redditListener = new RedditListener();
    this.hackerNewsListener = new HackerNewsListener();
    this.reviewsListener = new ReviewsListener();
    this.githubListener = new GitHubListener();
  }

  /**
   * Run all listeners and collect data
   */
  async runAll(): Promise<RawDataPoint[]> {
    console.log('=== Starting Data Ingestion ===');

    const allDataPoints: RawDataPoint[] = [];

    // Run Reddit listener
    console.log('\n--- Reddit Listener ---');
    try {
      const redditData = await this.redditListener.fetchAll();
      allDataPoints.push(...redditData);
      console.log(`✓ Reddit: ${redditData.length} data points`);
    } catch (error) {
      console.error('✗ Reddit error:', error);
    }

    // Run Hacker News listener
    console.log('\n--- Hacker News Listener ---');
    try {
      const hnData = await this.hackerNewsListener.fetchAll();
      allDataPoints.push(...hnData);
      console.log(`✓ Hacker News: ${hnData.length} data points`);
    } catch (error) {
      console.error('✗ Hacker News error:', error);
    }

    // Run Reviews listener
    console.log('\n--- Reviews Listener ---');
    try {
      const reviewsData = await this.reviewsListener.fetchAll();
      allDataPoints.push(...reviewsData);
      console.log(`✓ Reviews: ${reviewsData.length} data points`);
    } catch (error) {
      console.error('✗ Reviews error:', error);
    }

    // Run GitHub listener
    console.log('\n--- GitHub Listener ---');
    try {
      const githubData = await this.githubListener.fetchAll();
      allDataPoints.push(...githubData);
      console.log(`✓ GitHub: ${githubData.length} data points`);
    } catch (error) {
      console.error('✗ GitHub error:', error);
    }

    console.log(`\n=== Total Data Points Collected: ${allDataPoints.length} ===\n`);

    return allDataPoints;
  }

  /**
   * Run a specific listener
   */
  async runListener(listenerName: 'reddit' | 'hackernews' | 'reviews' | 'github'): Promise<RawDataPoint[]> {
    console.log(`Running ${listenerName} listener...`);

    switch (listenerName) {
      case 'reddit':
        return this.redditListener.fetchAll();
      case 'hackernews':
        return this.hackerNewsListener.fetchAll();
      case 'reviews':
        return this.reviewsListener.fetchAll();
      case 'github':
        return this.githubListener.fetchAll();
      default:
        throw new Error(`Unknown listener: ${listenerName}`);
    }
  }
}
