/**
 * GitHub Listener
 *
 * Monitors GitHub for trending repositories with high star velocity.
 * Identifies hot new developer tools and open-source projects.
 */

import { config } from '../config';
import { RawDataPoint } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class GitHubListener {
  private token?: string;

  constructor() {
    this.token = config.github.token;
  }

  /**
   * Search for trending repositories
   */
  async searchTrendingRepos(): Promise<RawDataPoint[]> {
    const headers: HeadersInit = {
      Accept: 'application/vnd.github.v3+json',
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    // Calculate date range for recent repos
    const maxAgeDate = new Date();
    maxAgeDate.setDate(maxAgeDate.getDate() - config.github.maxAgeInDays);
    const dateString = maxAgeDate.toISOString().split('T')[0];

    // Search for repos created recently with high stars
    const query = `created:>${dateString} stars:>${config.github.minStars} sort:stars`;

    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=100`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();
    const repos = data.items;

    const dataPoints: RawDataPoint[] = [];

    for (const repo of repos) {
      // Calculate star velocity (stars per day)
      const createdAt = new Date(repo.created_at);
      const daysOld = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const starVelocity = repo.stargazers_count / daysOld;

      dataPoints.push({
        id: uuidv4(),
        source: 'github',
        sourceUrl: repo.html_url,
        sourceIdentifier: `GitHub - ${repo.full_name}`,
        timestamp: new Date(),
        rawText: `${repo.name}\n\n${repo.description}\n\nREADME: ${repo.full_name}`,
        metadata: {
          repoName: repo.full_name,
          description: repo.description,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          language: repo.language,
          topics: repo.topics,
          createdAt: repo.created_at,
          starVelocity: Math.round(starVelocity),
        },
      });

      // Optionally fetch README for more context
      // This would require additional API calls
    }

    return dataPoints;
  }

  /**
   * Fetch trending topics from GitHub
   */
  async fetchTrendingTopics(): Promise<RawDataPoint[]> {
    console.log('Fetching trending GitHub topics...');

    // GitHub doesn't have a direct "trending topics" API
    // This would require scraping github.com/trending or using a third-party service

    const dataPoints: RawDataPoint[] = [];

    console.log('Note: Trending topics require scraping github.com/trending');

    return dataPoints;
  }

  /**
   * Fetch issues from popular repositories
   * This can reveal pain points and feature requests
   */
  async fetchIssuesFromRepo(repoOwner: string, repoName: string): Promise<RawDataPoint[]> {
    const headers: HeadersInit = {
      Accept: 'application/vnd.github.v3+json',
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/issues?state=open&labels=enhancement,feature-request&per_page=100`,
      { headers }
    );

    if (!response.ok) {
      console.error(`Failed to fetch issues from ${repoOwner}/${repoName}`);
      return [];
    }

    const issues = await response.json();
    const dataPoints: RawDataPoint[] = [];

    for (const issue of issues) {
      if (!issue.pull_request) {
        // Skip pull requests
        dataPoints.push({
          id: uuidv4(),
          source: 'github',
          sourceUrl: issue.html_url,
          sourceIdentifier: `GitHub - ${repoOwner}/${repoName}`,
          timestamp: new Date(issue.created_at),
          rawText: `${issue.title}\n\n${issue.body || ''}`,
          metadata: {
            issueNumber: issue.number,
            repo: `${repoOwner}/${repoName}`,
            labels: issue.labels.map((l: any) => l.name),
            comments: issue.comments,
            reactions: issue.reactions,
          },
        });
      }
    }

    return dataPoints;
  }

  /**
   * Fetch all GitHub data
   */
  async fetchAll(): Promise<RawDataPoint[]> {
    const allDataPoints: RawDataPoint[] = [];

    console.log('Fetching trending GitHub repositories...');
    try {
      const trendingRepos = await this.searchTrendingRepos();
      allDataPoints.push(...trendingRepos);
      console.log(`Fetched ${trendingRepos.length} trending repositories`);

      // Rate limiting
      await this.sleep(2000);
    } catch (error) {
      console.error('Error fetching trending repos:', error);
    }

    return allDataPoints;
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
