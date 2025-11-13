# Market-Gap-Finder Bot

An automated system that transforms raw, unstructured public data (like rants on Reddit) into structured, actionable "App Blueprints" that AI engineering tools can use for development.

## Overview

The Market-Gap-Finder Bot identifies clusters of user pain points and market gaps from public discourse, then synthesizes these findings into detailed, structured specifications for new applications, games, or tools.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MARKET-GAP-FINDER BOT                        │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Ingestion   │────▶│  Processing  │────▶│  Synthesis   │
│  (Listeners) │     │  (Pipeline)  │     │  (AI Engine) │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                      │
       ▼                    ▼                      ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  S3 Data     │     │  Vector DB   │     │  Blueprint   │
│  Lake        │     │  (Pinecone)  │     │  Database    │
└──────────────┘     └──────────────┘     └──────────────┘
```

## Pipeline Stages

### 1. **Ingestion** - The "Listeners"
Scheduled functions that fetch raw data from target sources:
- **Reddit**: r/AppIdeas, r/Startup_Ideas, r/SomebodyMakeThis, r/SideProject, r/indiehackers, r/smallbusiness, etc.
- **Hacker News**: "Ask HN" and "Show HN" posts via Algolia API
- **Reviews**: G2, Capterra, GetApp (1-3 star reviews)
- **GitHub**: Trending repositories with high star velocity

### 2. **Raw Storage** - The "Data Lake"
Raw JSON data stored in S3 for permanent archival and audit trails.

### 3. **Processing** - The "Insight Extractor"
NLP and data transformation pipeline:
- **Text Cleaner**: Removes HTML, normalizes whitespace, strips markdown
- **Pain Point Classifier**: Scores text 0.0-1.0 for actionability
- **Sentiment Analyzer**: Categorizes as frustrated, angry, hopeful, neutral, positive
- **Entity Extractor**: Identifies products, features, audiences, competitors
- **Vectorizer**: Generates embeddings using Gemini API

### 4. **Vector Storage** - The "Knowledge Base"
Processed pain points stored as numerical embeddings in Pinecone for semantic search.

### 5. **Synthesis** - The "AI Architect"
Core LLM-based service using Gemini API:
- **Cluster Finder**: Groups similar pain points using vector similarity
- **Problem Summarizer**: Generates structured problem statements
- **Blueprint Generator**: Creates complete App Blueprints

### 6. **Blueprint Storage** - The "Output Database"
Final structured JSON blueprints stored in DynamoDB for downstream consumption.

## Data Sources

### Category 1: Direct Pain Points
Sources where people explicitly state problems:
- Reddit subreddits (r/AppIdeas, r/Startup_Ideas, etc.)
- Hacker News "Ask HN" threads
- Indie Hackers forum

**Keywords**: "I wish there was an app for", "Does anyone know a tool that", "How do you all handle", "frustrated with"

### Category 2: Market Gaps
Weaknesses in existing products:
- G2, Capterra, GetApp (1-3 star reviews)
- App Store & Play Store reviews
- Focus on "missing features" and "too expensive/complex" complaints

### Category 3: Emerging Trends
New technologies and problem spaces:
- GitHub trending repositories
- Google Trends breakout queries
- Tech news (TechCrunch, Y Combinator)

## App Blueprint Schema

The final output follows this structured JSON schema:

```json
{
  "appName": "Catchy app name",
  "productType": "SaaS | Mobile App | Web Tool | Game | Browser Extension | Developer Tool",
  "elevatorPitch": "One sentence description",
  "problemStatement": "Clear problem statement",
  "targetAudience": "Detailed user persona",
  "userStories": [
    "As a [user], I want to [action] so that [benefit]"
  ],
  "coreFeatures": [
    {
      "featureName": "Feature name",
      "description": "Feature description"
    }
  ],
  "keyDifferentiators": [
    "How this is better than competitors"
  ],
  "monetizationStrategy": "Freemium | One-time Purchase | Monthly Subscription | Usage-Based | Ad-Supported",
  "evidence": [
    {
      "snippet": "User quote",
      "source": "r/smallbusiness",
      "url": "https://..."
    }
  ]
}
```

## Installation

### Prerequisites
- Node.js 18+
- AWS Account (for S3 and DynamoDB)
- Gemini API key
- Vector database (Pinecone recommended)
- Optional: Reddit API credentials, GitHub token

### Setup

1. **Clone and install dependencies**
```bash
cd market-gap-finder-container
npm install
```

2. **Configure environment variables**
```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

3. **Build the project**
```bash
npm run build
```

## Configuration

All configuration is managed through environment variables. See `.env.example` for the complete list.

### Key Configuration Options

**Processing Thresholds:**
- `PAIN_POINT_THRESHOLD`: Minimum score (0.0-1.0) to keep a data point (default: 0.7)
- `CLUSTER_SIZE_THRESHOLD`: Minimum number of points to form a cluster (default: 20)
- `MAX_BATCH_SIZE`: Processing batch size (default: 100)

**Data Sources:**
- `REDDIT_SUBREDDITS`: Comma-separated list of subreddits
- `REDDIT_KEYWORDS`: Comma-separated pain point keywords
- `GITHUB_MIN_STARS`: Minimum stars for trending repos (default: 500)

**AI Configuration:**
- `GEMINI_API_KEY`: Your Gemini API key
- `GEMINI_MODEL`: Model for text generation (default: gemini-1.5-flash)
- `GEMINI_EMBEDDING_MODEL`: Model for embeddings (default: text-embedding-004)

## Usage

### Run Complete Pipeline
```bash
npm start
# or
node dist/index.js run
```

### Run Individual Stages

**Ingestion only:**
```bash
npm run ingest
# or
node dist/index.js ingest
```

**Processing only** (on existing data):
```bash
npm run process
# or
node dist/index.js process [start-date] [end-date]
```

**Synthesis only:**
```bash
npm run synthesize
# or
node dist/index.js synthesize
```

### Docker Deployment

**Build image:**
```bash
docker build -t market-gap-finder .
```

**Run container:**
```bash
docker run --env-file .env market-gap-finder
```

## Development

### Project Structure

```
market-gap-finder-container/
├── src/
│   ├── index.ts                 # Main orchestrator
│   ├── config.ts                # Configuration management
│   ├── ingestion/              # Data listeners
│   │   ├── reddit-listener.ts
│   │   ├── hackernews-listener.ts
│   │   ├── reviews-listener.ts
│   │   ├── github-listener.ts
│   │   └── index.ts
│   ├── processing/             # NLP pipeline
│   │   ├── cleaner.ts
│   │   ├── classifier.ts
│   │   ├── sentiment-analyzer.ts
│   │   ├── entity-extractor.ts
│   │   ├── vectorizer.ts
│   │   └── index.ts
│   ├── synthesis/              # AI synthesis
│   │   ├── cluster-finder.ts
│   │   ├── problem-summarizer.ts
│   │   ├── blueprint-generator.ts
│   │   └── index.ts
│   ├── storage/                # Storage interfaces
│   │   ├── data-lake.ts
│   │   ├── vector-db.ts
│   │   ├── blueprint-db.ts
│   │   └── index.ts
│   └── types/                  # TypeScript types
│       ├── app-blueprint.ts
│       ├── pain-point.ts
│       └── index.ts
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

### Running in Development

```bash
npm run dev
```

### Building

```bash
npm run build
```

## AWS Infrastructure Requirements

### S3 Bucket (Data Lake)
```bash
aws s3 mb s3://market-gap-finder-data-lake
```

### DynamoDB Table (Blueprints)
```json
{
  "TableName": "AppBlueprints",
  "KeySchema": [
    { "AttributeName": "blueprintId", "KeyType": "HASH" }
  ],
  "AttributeDefinitions": [
    { "AttributeName": "blueprintId", "AttributeType": "S" }
  ],
  "BillingMode": "PAY_PER_REQUEST"
}
```

### IAM Permissions
The bot requires:
- S3: `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`
- DynamoDB: `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:Scan`

## Scheduling & Orchestration

### AWS Step Functions (Recommended)
Create a daily workflow that runs the complete pipeline:

```json
{
  "Comment": "Daily Market-Gap-Finder execution",
  "StartAt": "RunBot",
  "States": {
    "RunBot": {
      "Type": "Task",
      "Resource": "arn:aws:ecs:...",
      "End": true
    }
  }
}
```

### AWS EventBridge Schedule
```bash
aws events put-rule \
  --name market-gap-finder-daily \
  --schedule-expression "cron(0 2 * * ? *)"
```

### Kubernetes CronJob
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: market-gap-finder
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: market-gap-finder
            image: market-gap-finder:latest
            envFrom:
            - secretRef:
                name: market-gap-finder-secrets
          restartPolicy: OnFailure
```

## Monitoring & Observability

### CloudWatch Logs
All output is logged to stdout/stderr and can be captured by CloudWatch Logs.

### Key Metrics to Track
- Data points collected per source
- Processing success rate (% passing quality threshold)
- Average pain point score
- Clusters identified
- Blueprints generated
- Pipeline duration

## Cost Estimation

### Gemini API Costs
- **Embeddings**: ~$0.00001 per text (text-embedding-004)
- **Text generation**: ~$0.001 per request (gemini-1.5-flash)
- **Estimated monthly**: $10-50 depending on volume

### AWS Costs
- **S3**: ~$0.01/GB storage + $0.0004/1000 PUT requests
- **DynamoDB**: Pay-per-request pricing, ~$1.25/million writes
- **ECS/Fargate**: ~$0.04/hour (1 vCPU, 2GB RAM)
- **Estimated monthly**: $20-100 for daily runs

### Vector Database (Pinecone)
- **Free tier**: 1 index, 1GB storage
- **Starter**: $70/month (5M vectors)
- **Scale as needed**

## Troubleshooting

### No data points collected
- Check API credentials (Reddit, GitHub)
- Verify network connectivity
- Review rate limits on APIs

### Low pain point scores
- Adjust `PAIN_POINT_THRESHOLD` lower (try 0.5)
- Review and expand keyword lists
- Check data source quality

### No clusters found
- Lower `CLUSTER_SIZE_THRESHOLD` (try 10)
- Ensure vector embeddings are being generated
- Verify Gemini API key is valid

### Gemini API errors
- Check API key and quotas
- Verify model names are correct
- Review rate limits (60 requests/minute)

## Future Enhancements

- [ ] Support for more data sources (Twitter, ProductHunt, Indie Hackers API)
- [ ] Advanced clustering algorithms (DBSCAN, HDBSCAN)
- [ ] Web UI for browsing blueprints
- [ ] Slack/Discord notifications for new blueprints
- [ ] Integration with no-code builders (Bubble, Webflow)
- [ ] Automated competitive analysis
- [ ] Market size estimation
- [ ] Blueprint versioning and updates

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - See LICENSE file for details

## Support

For issues and questions:
- Open a GitHub issue
- Check existing documentation
- Review CloudWatch logs for errors

## Acknowledgments

Built with:
- Gemini AI for embeddings and text generation
- AWS for infrastructure
- Pinecone for vector search
- TypeScript for type safety
