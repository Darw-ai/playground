/**
 * Hacker News Listener
 *
 * Fetches data from Hacker News using the Algolia API.
 * Focuses on "Ask HN" and "Show HN" posts about tools and problems.
 */

import { config } from '../config';
import { RawDataPoint } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class HackerNewsListener {
  private apiUrl: string;

  constructor() {
    this.apiUrl = config.hackerNews.apiUrl;
  }

  /**
   * Search Hacker News for posts matching keywords
   */
  async search(query: string, tags: string = 'ask_hn'): Promise<RawDataPoint[]> {
    const response = await fetch(`${this.apiUrl}/search?query=${encodeURIComponent(query)}&tags=${tags}&hitsPerPage=100`);

    const data = await response.json();
    const hits = data.hits;

    const dataPoints: RawDataPoint[] = [];

    for (const hit of hits) {
      // Process the post
      dataPoints.push({
        id: uuidv4(),
        source: 'hackernews',
        sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        sourceIdentifier: 'Hacker News',
        timestamp: new Date(hit.created_at),
        rawText: `${hit.title}\n\n${hit.story_text || hit.comment_text || ''}`,
        metadata: {
          objectId: hit.objectID,
          author: hit.author,
          points: hit.points,
          numComments: hit.num_comments,
          tags: hit._tags,
        },
      });

      // Fetch comments for this post
      if (hit.num_comments > 0) {
        const comments = await this.fetchComments(hit.objectID);
        dataPoints.push(...comments);
      }
    }

    return dataPoints;
  }

  /**
   * Fetch comments for a specific post
   */
  private async fetchComments(postId: string): Promise<RawDataPoint[]> {
    const response = await fetch(`${this.apiUrl}/search?tags=comment,story_${postId}&hitsPerPage=100`);

    const data = await response.json();
    const comments = data.hits;

    const dataPoints: RawDataPoint[] = [];

    for (const comment of comments) {
      if (comment.comment_text && this.containsKeywords(comment.comment_text)) {
        dataPoints.push({
          id: uuidv4(),
          source: 'hackernews',
          sourceUrl: `https://news.ycombinator.com/item?id=${comment.objectID}`,
          sourceIdentifier: 'Hacker News',
          timestamp: new Date(comment.created_at),
          rawText: comment.comment_text,
          metadata: {
            objectId: comment.objectID,
            author: comment.author,
            postId: postId,
            tags: comment._tags,
          },
        });
      }
    }

    return dataPoints;
  }

  /**
   * Fetch all configured search types and keywords
   */
  async fetchAll(): Promise<RawDataPoint[]> {
    const allDataPoints: RawDataPoint[] = [];

    for (const keyword of config.hackerNews.keywords) {
      for (const searchType of config.hackerNews.searchTypes) {
        console.log(`Searching HN for "${keyword}" in ${searchType}...`);
        try {
          const tag = searchType.toLowerCase().replace(' ', '_');
          const dataPoints = await this.search(keyword, tag);
          allDataPoints.push(...dataPoints);
          console.log(`Fetched ${dataPoints.length} data points for "${keyword}" in ${searchType}`);

          // Rate limiting
          await this.sleep(1000);
        } catch (error) {
          console.error(`Error fetching HN data for "${keyword}" in ${searchType}:`, error);
        }
      }
    }

    return allDataPoints;
  }

  /**
   * Check if text contains any of the configured keywords
   */
  private containsKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();
    return config.hackerNews.keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
