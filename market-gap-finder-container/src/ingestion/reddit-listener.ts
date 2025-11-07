/**
 * Reddit Listener
 *
 * Fetches data from specified subreddits using the Reddit API.
 * Focuses on posts and comments containing pain points and feature requests.
 */

import { config } from '../config';
import { RawDataPoint } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class RedditListener {
  private clientId: string;
  private clientSecret: string;
  private userAgent: string;
  private accessToken?: string;
  private tokenExpiry?: Date;

  constructor() {
    this.clientId = config.reddit.clientId;
    this.clientSecret = config.reddit.clientSecret;
    this.userAgent = config.reddit.userAgent;
  }

  /**
   * Authenticate with Reddit API
   */
  private async authenticate(): Promise<void> {
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return; // Token still valid
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: 'grant_type=client_credentials',
    });

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  }

  /**
   * Fetch posts from a subreddit
   */
  async fetchFromSubreddit(subreddit: string, limit: number = 100): Promise<RawDataPoint[]> {
    await this.authenticate();

    const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/new?limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'User-Agent': this.userAgent,
      },
    });

    const data = await response.json();
    const posts = data.data.children;

    const dataPoints: RawDataPoint[] = [];

    for (const post of posts) {
      const postData = post.data;

      // Check if post contains relevant keywords
      if (this.containsKeywords(postData.title + ' ' + postData.selftext)) {
        dataPoints.push({
          id: uuidv4(),
          source: 'reddit',
          sourceUrl: `https://reddit.com${postData.permalink}`,
          sourceIdentifier: `r/${subreddit}`,
          timestamp: new Date(postData.created_utc * 1000),
          rawText: `${postData.title}\n\n${postData.selftext}`,
          metadata: {
            postId: postData.id,
            author: postData.author,
            score: postData.score,
            numComments: postData.num_comments,
            subreddit: postData.subreddit,
          },
        });

        // Fetch comments for this post
        const comments = await this.fetchComments(postData.id, subreddit);
        dataPoints.push(...comments);
      }
    }

    return dataPoints;
  }

  /**
   * Fetch comments for a specific post
   */
  private async fetchComments(postId: string, subreddit: string): Promise<RawDataPoint[]> {
    await this.authenticate();

    const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/comments/${postId}?limit=100`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'User-Agent': this.userAgent,
      },
    });

    const data = await response.json();
    const comments = data[1]?.data?.children || [];

    const dataPoints: RawDataPoint[] = [];

    for (const comment of comments) {
      if (comment.kind === 't1' && comment.data.body) {
        const commentData = comment.data;

        if (this.containsKeywords(commentData.body)) {
          dataPoints.push({
            id: uuidv4(),
            source: 'reddit',
            sourceUrl: `https://reddit.com${commentData.permalink}`,
            sourceIdentifier: `r/${subreddit}`,
            timestamp: new Date(commentData.created_utc * 1000),
            rawText: commentData.body,
            metadata: {
              commentId: commentData.id,
              postId: postId,
              author: commentData.author,
              score: commentData.score,
              subreddit: commentData.subreddit,
            },
          });
        }
      }
    }

    return dataPoints;
  }

  /**
   * Fetch from all configured subreddits
   */
  async fetchAll(): Promise<RawDataPoint[]> {
    const allDataPoints: RawDataPoint[] = [];

    for (const subreddit of config.reddit.subreddits) {
      console.log(`Fetching from r/${subreddit}...`);
      try {
        const dataPoints = await this.fetchFromSubreddit(subreddit);
        allDataPoints.push(...dataPoints);
        console.log(`Fetched ${dataPoints.length} data points from r/${subreddit}`);
      } catch (error) {
        console.error(`Error fetching from r/${subreddit}:`, error);
      }
    }

    return allDataPoints;
  }

  /**
   * Check if text contains any of the configured keywords
   */
  private containsKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();
    return config.reddit.keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
  }
}
