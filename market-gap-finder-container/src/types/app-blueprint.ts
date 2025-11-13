/**
 * App Blueprint Schema
 *
 * The final output format for the Market-Gap-Finder Bot.
 * This structured JSON is consumed by downstream AI engineering tools.
 */

export type ProductType =
  | 'SaaS'
  | 'Mobile App (iOS/Android)'
  | 'Web Tool'
  | 'Game'
  | 'Browser Extension'
  | 'Developer Tool';

export type MonetizationStrategy =
  | 'Freemium'
  | 'One-time Purchase'
  | 'Monthly Subscription (SaaS)'
  | 'Usage-Based (API)'
  | 'Ad-Supported';

export interface CoreFeature {
  featureName: string;
  description: string;
}

export interface Evidence {
  snippet: string;
  source: string; // e.g., "r/smallbusiness", "G2 Review for QuickBooks"
  url?: string;
}

export interface AppBlueprint {
  appName: string;
  productType: ProductType;
  elevatorPitch: string;
  problemStatement: string;
  targetAudience: string;
  userStories: string[];
  coreFeatures: CoreFeature[];
  keyDifferentiators: string[];
  monetizationStrategy: MonetizationStrategy;
  evidence: Evidence[];
}

/**
 * JSON Schema for validation
 */
export const APP_BLUEPRINT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AppBlueprint',
  type: 'object',
  properties: {
    appName: {
      description: 'A catchy, suggested name for the application.',
      type: 'string',
    },
    productType: {
      description: 'The type of product.',
      type: 'string',
      enum: ['SaaS', 'Mobile App (iOS/Android)', 'Web Tool', 'Game', 'Browser Extension', 'Developer Tool'],
    },
    elevatorPitch: {
      description: 'A single-sentence description of the app.',
      type: 'string',
    },
    problemStatement: {
      description: 'A clear, concise statement of the problem this app solves, based on synthesized user complaints.',
      type: 'string',
    },
    targetAudience: {
      description: 'A detailed description of the primary user persona.',
      type: 'string',
    },
    userStories: {
      description: 'A list of key user stories.',
      type: 'array',
      items: {
        type: 'string',
        examples: [
          'As a freelance writer, I want to automatically generate and send PDF invoices from a simple dashboard so that I can get paid faster.',
        ],
      },
    },
    coreFeatures: {
      description: 'A list of the primary features required for the MVP (Minimum Viable Product).',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          featureName: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['featureName', 'description'],
      },
    },
    keyDifferentiators: {
      description:
        'How this app will be better than existing solutions (e.g., \'Cheaper\', \'Simpler UI\', \'Better Integrations\').',
      type: 'array',
      items: { type: 'string' },
    },
    monetizationStrategy: {
      description: 'The proposed business model.',
      type: 'string',
      enum: ['Freemium', 'One-time Purchase', 'Monthly Subscription (SaaS)', 'Usage-Based (API)', 'Ad-Supported'],
    },
    evidence: {
      description: 'A list of source snippets and URLs that led to this idea, providing validation.',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          snippet: { type: 'string' },
          source: { type: 'string', examples: ['r/smallbusiness', 'G2 Review for QuickBooks'] },
          url: { type: 'string', format: 'uri' },
        },
        required: ['snippet', 'source'],
      },
    },
  },
  required: [
    'appName',
    'productType',
    'elevatorPitch',
    'problemStatement',
    'targetAudience',
    'coreFeatures',
    'monetizationStrategy',
    'evidence',
  ],
} as const;
