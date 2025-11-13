/**
 * Blueprint Database Storage
 *
 * Stores the final, structured App Blueprints.
 * This is the output consumed by downstream AI engineering tools.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config';
import { AppBlueprint } from '../types';

export interface BlueprintRecord extends AppBlueprint {
  blueprintId: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'draft' | 'validated' | 'published';
  version: number;
}

export class BlueprintDatabase {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const dynamoClient = new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = config.storage.blueprintDbTable;
  }

  /**
   * Store a new blueprint
   */
  async store(blueprint: AppBlueprint): Promise<BlueprintRecord> {
    const blueprintId = this.generateBlueprintId(blueprint);
    const now = new Date();

    const record: BlueprintRecord = {
      ...blueprint,
      blueprintId,
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      version: 1,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      })
    );

    return record;
  }

  /**
   * Retrieve a blueprint by ID
   */
  async get(blueprintId: string): Promise<BlueprintRecord | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { blueprintId },
      })
    );

    if (!response.Item) {
      return null;
    }

    return response.Item as BlueprintRecord;
  }

  /**
   * Update an existing blueprint
   */
  async update(blueprintId: string, updates: Partial<AppBlueprint>): Promise<BlueprintRecord | null> {
    const existing = await this.get(blueprintId);
    if (!existing) {
      return null;
    }

    const updated: BlueprintRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: updated,
      })
    );

    return updated;
  }

  /**
   * List all blueprints with optional filters
   */
  async list(filters?: { status?: string; productType?: string }): Promise<BlueprintRecord[]> {
    let response;

    if (filters) {
      // Use Query if filtering by indexed attributes
      // For now, use Scan (not optimal for production)
      response = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
        })
      );
    } else {
      response = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
        })
      );
    }

    let items = (response.Items || []) as BlueprintRecord[];

    // Apply filters
    if (filters?.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    if (filters?.productType) {
      items = items.filter((item) => item.productType === filters.productType);
    }

    return items;
  }

  /**
   * Search blueprints by target audience
   */
  async searchByAudience(audience: string): Promise<BlueprintRecord[]> {
    const allBlueprints = await this.list();
    return allBlueprints.filter((bp) => bp.targetAudience.toLowerCase().includes(audience.toLowerCase()));
  }

  /**
   * Search blueprints by problem domain
   */
  async searchByProblem(problemKeyword: string): Promise<BlueprintRecord[]> {
    const allBlueprints = await this.list();
    return allBlueprints.filter((bp) => bp.problemStatement.toLowerCase().includes(problemKeyword.toLowerCase()));
  }

  /**
   * Update blueprint status
   */
  async updateStatus(blueprintId: string, status: 'draft' | 'validated' | 'published'): Promise<BlueprintRecord | null> {
    const existing = await this.get(blueprintId);
    if (!existing) {
      return null;
    }

    const updated: BlueprintRecord = {
      ...existing,
      status,
      updatedAt: new Date(),
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: updated,
      })
    );

    return updated;
  }

  /**
   * Generate a unique blueprint ID
   */
  private generateBlueprintId(blueprint: AppBlueprint): string {
    const timestamp = Date.now();
    const appNameSlug = blueprint.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `bp-${appNameSlug}-${timestamp}`;
  }
}
