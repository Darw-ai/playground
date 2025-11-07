/**
 * Data Lake Storage (S3)
 *
 * Stores raw, unstructured data from all listeners.
 * This creates a permanent archive of all ingested data.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { config } from '../config';
import { RawDataPoint } from '../types';

export class DataLake {
  private s3Client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor() {
    this.s3Client = new S3Client({});
    this.bucket = config.storage.s3Bucket;
    this.prefix = config.storage.s3Prefix;
  }

  /**
   * Store raw data point in S3
   */
  async store(dataPoint: RawDataPoint): Promise<string> {
    const key = this.generateKey(dataPoint);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(dataPoint, null, 2),
        ContentType: 'application/json',
        Metadata: {
          source: dataPoint.source,
          timestamp: dataPoint.timestamp.toISOString(),
        },
      })
    );

    return `s3://${this.bucket}/${key}`;
  }

  /**
   * Store multiple data points in batch
   */
  async storeBatch(dataPoints: RawDataPoint[]): Promise<string[]> {
    const promises = dataPoints.map((dp) => this.store(dp));
    return Promise.all(promises);
  }

  /**
   * Retrieve a data point by key
   */
  async retrieve(key: string): Promise<RawDataPoint | null> {
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      if (!response.Body) {
        return null;
      }

      const bodyString = await response.Body.transformToString();
      return JSON.parse(bodyString) as RawDataPoint;
    } catch (error) {
      console.error(`Failed to retrieve ${key}:`, error);
      return null;
    }
  }

  /**
   * List all data points for a given source and date range
   */
  async listBySourceAndDateRange(source: string, startDate: Date, endDate: Date): Promise<string[]> {
    const prefix = `${this.prefix}/${source}/${startDate.getFullYear()}`;

    const response = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      })
    );

    if (!response.Contents) {
      return [];
    }

    return response.Contents.filter((obj) => {
      if (!obj.LastModified) return false;
      return obj.LastModified >= startDate && obj.LastModified <= endDate;
    }).map((obj) => obj.Key!);
  }

  /**
   * Generate a unique S3 key for a data point
   * Format: {prefix}/{source}/{year}/{month}/{day}/{id}.json
   */
  private generateKey(dataPoint: RawDataPoint): string {
    const date = dataPoint.timestamp;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${this.prefix}/${dataPoint.source}/${year}/${month}/${day}/${dataPoint.id}.json`;
  }
}
