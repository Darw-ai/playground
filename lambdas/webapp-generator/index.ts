import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as archiver from 'archiver';
import { Readable } from 'stream';

const s3Client = new S3Client({});
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || 'webapp-generator-output';

interface GenerateRequest {
  description: string;
  projectName?: string;
  includeDatabase?: boolean;
  style?: 'minimal' | 'modern' | 'corporate';
}

interface ParsedFeatures {
  projectName: string;
  entities: Entity[];
  endpoints: Endpoint[];
  pages: Page[];
  hasAuth: boolean;
  hasDatabase: boolean;
  style: string;
}

interface Entity {
  name: string;
  fields: Field[];
}

interface Field {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'email';
  required: boolean;
}

interface Endpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  description: string;
  entity?: string;
}

interface Page {
  name: string;
  route: string;
  description: string;
  components: string[];
}

interface GeneratedApp {
  projectName: string;
  backend: {
    'package.json': string;
    'server.js': string;
    'routes.js': string;
    'models.js'?: string;
    'database.js'?: string;
  };
  frontend: {
    'index.html': string;
    'styles.css': string;
    'app.js': string;
  };
  deployment: {
    'template.yaml': string;
    'README.md': string;
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST' || event.path !== '/generate') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Not found' }),
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const request: GenerateRequest = JSON.parse(event.body);

    if (!request.description) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Description is required' }),
      };
    }

    // Parse the description to extract features
    const features = parseDescription(request.description, request);

    // Generate the web application
    const generatedApp = generateWebApp(features);

    // Return the generated code
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        projectName: features.projectName,
        message: 'Web application generated successfully',
        app: generatedApp,
        features: {
          entities: features.entities.length,
          endpoints: features.endpoints.length,
          pages: features.pages.length,
          hasAuth: features.hasAuth,
          hasDatabase: features.hasDatabase,
        },
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

function parseDescription(description: string, request: GenerateRequest): ParsedFeatures {
  const lowerDesc = description.toLowerCase();

  // Extract project name
  const projectName = request.projectName || extractProjectName(description) || 'my-webapp';

  // Detect entities (nouns that appear multiple times or after key phrases)
  const entities = extractEntities(description);

  // Detect endpoints based on actions mentioned
  const endpoints = extractEndpoints(description, entities);

  // Detect pages/views
  const pages = extractPages(description, entities);

  // Detect if authentication is needed
  const hasAuth =
    lowerDesc.includes('login') ||
    lowerDesc.includes('signup') ||
    lowerDesc.includes('authentication') ||
    lowerDesc.includes('user account') ||
    lowerDesc.includes('register');

  // Detect if database is needed
  const hasDatabase =
    request.includeDatabase !== false && (
      lowerDesc.includes('store') ||
      lowerDesc.includes('save') ||
      lowerDesc.includes('database') ||
      lowerDesc.includes('persist') ||
      entities.length > 0
    );

  const style = request.style || 'modern';

  return {
    projectName,
    entities,
    endpoints,
    pages,
    hasAuth,
    hasDatabase,
    style,
  };
}

function extractProjectName(description: string): string | null {
  // Try to find project name after phrases like "called", "named", "for a"
  const patterns = [
    /(?:called|named|for a|building a|create a)\s+["']?([a-zA-Z][a-zA-Z0-9\s-]{2,30})["']?/i,
    /^([A-Z][a-zA-Z0-9\s]{2,30})(?:\s+(?:application|app|system|platform|website))/,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      return match[1].trim().toLowerCase().replace(/\s+/g, '-');
    }
  }

  return null;
}

function extractEntities(description: string): Entity[] {
  const entities: Entity[] = [];
  const lowerDesc = description.toLowerCase();

  // Common entity indicators
  const entityPatterns = [
    /(?:manage|create|add|edit|delete|list|view|track)\s+([a-z]+s?)(?:\s|,|\.)/gi,
    /(?:each|every|a|the)\s+([a-z]+)\s+(?:has|contains|includes|with)/gi,
  ];

  const entityCandidates = new Map<string, number>();

  for (const pattern of entityPatterns) {
    let match;
    while ((match = pattern.exec(description)) !== null) {
      const entity = match[1].toLowerCase();
      // Skip common words
      if (!['user', 'data', 'item', 'thing', 'page', 'view'].includes(entity) || entity === 'user') {
        entityCandidates.set(entity, (entityCandidates.get(entity) || 0) + 1);
      }
    }
  }

  // Get entities mentioned at least once
  const mainEntities = Array.from(entityCandidates.entries())
    .filter(([_, count]) => count >= 1)
    .map(([name]) => name)
    .slice(0, 5); // Limit to 5 entities

  // Extract fields for each entity
  for (const entityName of mainEntities) {
    const fields = extractFieldsForEntity(description, entityName);
    entities.push({
      name: capitalize(singular(entityName)),
      fields,
    });
  }

  // If no entities found, create a default one
  if (entities.length === 0) {
    entities.push({
      name: 'Item',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'string', required: false },
        { name: 'createdAt', type: 'date', required: true },
      ],
    });
  }

  return entities;
}

function extractFieldsForEntity(description: string, entityName: string): Field[] {
  const fields: Field[] = [
    { name: 'id', type: 'string', required: true },
  ];

  // Look for field patterns around the entity
  const fieldPatterns = [
    new RegExp(`${entityName}\\s+(?:has|with|includes?)\\s+([^.]+)`, 'gi'),
    new RegExp(`(?:each|every)\\s+${entityName}\\s+(?:has|contains?)\\s+([^.]+)`, 'gi'),
  ];

  const fieldCandidates = new Set<string>();

  for (const pattern of fieldPatterns) {
    let match;
    while ((match = pattern.exec(description)) !== null) {
      const fieldText = match[1].toLowerCase();

      // Extract individual fields
      const words = fieldText.split(/,|and|\s+/);
      for (const word of words) {
        const cleaned = word.trim().replace(/[^a-z]/g, '');
        if (cleaned.length > 2 && cleaned.length < 20) {
          fieldCandidates.add(cleaned);
        }
      }
    }
  }

  // Convert candidates to field objects
  for (const fieldName of Array.from(fieldCandidates).slice(0, 6)) {
    let type: Field['type'] = 'string';

    if (fieldName.includes('email')) type = 'email';
    else if (fieldName.includes('date') || fieldName.includes('time')) type = 'date';
    else if (fieldName.includes('count') || fieldName.includes('number') || fieldName.includes('age') || fieldName.includes('price')) type = 'number';
    else if (fieldName.includes('active') || fieldName.includes('enabled') || fieldName.includes('is')) type = 'boolean';

    fields.push({
      name: fieldName,
      type,
      required: false,
    });
  }

  // Add default fields if none found
  if (fields.length === 1) {
    fields.push(
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'createdAt', type: 'date', required: true }
    );
  }

  return fields;
}

function extractEndpoints(description: string, entities: Entity[]): Endpoint[] {
  const endpoints: Endpoint[] = [];
  const lowerDesc = description.toLowerCase();

  // For each entity, create CRUD endpoints
  for (const entity of entities) {
    const entityLower = entity.name.toLowerCase();
    const entityPlural = plural(entityLower);

    // Check which operations are mentioned
    const hasCreate = lowerDesc.includes('create') || lowerDesc.includes('add') || lowerDesc.includes('new');
    const hasRead = lowerDesc.includes('view') || lowerDesc.includes('list') || lowerDesc.includes('get') || lowerDesc.includes('show');
    const hasUpdate = lowerDesc.includes('edit') || lowerDesc.includes('update') || lowerDesc.includes('modify');
    const hasDelete = lowerDesc.includes('delete') || lowerDesc.includes('remove');

    // Default to full CRUD if not specific
    const includeAll = !hasCreate && !hasRead && !hasUpdate && !hasDelete;

    if (includeAll || hasRead) {
      endpoints.push({
        path: `/api/${entityPlural}`,
        method: 'GET',
        description: `Get all ${entityPlural}`,
        entity: entity.name,
      });

      endpoints.push({
        path: `/api/${entityPlural}/:id`,
        method: 'GET',
        description: `Get a single ${entityLower}`,
        entity: entity.name,
      });
    }

    if (includeAll || hasCreate) {
      endpoints.push({
        path: `/api/${entityPlural}`,
        method: 'POST',
        description: `Create a new ${entityLower}`,
        entity: entity.name,
      });
    }

    if (includeAll || hasUpdate) {
      endpoints.push({
        path: `/api/${entityPlural}/:id`,
        method: 'PUT',
        description: `Update a ${entityLower}`,
        entity: entity.name,
      });
    }

    if (includeAll || hasDelete) {
      endpoints.push({
        path: `/api/${entityPlural}/:id`,
        method: 'DELETE',
        description: `Delete a ${entityLower}`,
        entity: entity.name,
      });
    }
  }

  return endpoints;
}

function extractPages(description: string, entities: Entity[]): Page[] {
  const pages: Page[] = [];

  // Home page
  pages.push({
    name: 'Home',
    route: '/',
    description: 'Landing page',
    components: ['navigation', 'hero', 'footer'],
  });

  // Entity pages
  for (const entity of entities) {
    const entityLower = entity.name.toLowerCase();
    const entityPlural = plural(entityLower);

    pages.push({
      name: `${entity.name} List`,
      route: `/${entityPlural}`,
      description: `List all ${entityPlural}`,
      components: ['navigation', 'list', 'search', 'footer'],
    });

    pages.push({
      name: `${entity.name} Form`,
      route: `/${entityPlural}/new`,
      description: `Create/Edit ${entityLower}`,
      components: ['navigation', 'form', 'footer'],
    });
  }

  return pages;
}

function generateWebApp(features: ParsedFeatures): GeneratedApp {
  const backend = generateBackend(features);
  const frontend = generateFrontend(features);
  const deployment = generateDeployment(features);

  return {
    projectName: features.projectName,
    backend,
    frontend,
    deployment,
  };
}

function generateBackend(features: ParsedFeatures): GeneratedApp['backend'] {
  const packageJson = {
    name: features.projectName,
    version: '1.0.0',
    description: `Backend for ${features.projectName}`,
    main: 'server.js',
    scripts: {
      start: 'node server.js',
      dev: 'nodemon server.js',
    },
    dependencies: {
      express: '^4.18.2',
      cors: '^2.8.5',
      'body-parser': '^1.20.2',
      dotenv: '^16.3.1',
    },
    devDependencies: {
      nodemon: '^3.0.1',
    },
  };

  // Generate server.js
  const serverJs = `const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

// API routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
  console.log(\`Visit http://localhost:\${PORT}\`);
});

module.exports = app;
`;

  // Generate routes.js
  const routesJs = generateRoutes(features);

  const backend: GeneratedApp['backend'] = {
    'package.json': JSON.stringify(packageJson, null, 2),
    'server.js': serverJs,
    'routes.js': routesJs,
  };

  if (features.hasDatabase) {
    backend['models.js'] = generateModels(features);
    backend['database.js'] = generateDatabase(features);
  }

  return backend;
}

function generateRoutes(features: ParsedFeatures): string {
  let code = `const express = require('express');
const router = express.Router();
`;

  if (features.hasDatabase) {
    code += `const models = require('./models');\n`;
  } else {
    code += `
// In-memory storage (for demo purposes)
const storage = {};
`;

    for (const entity of features.entities) {
      const entityPlural = plural(entity.name.toLowerCase());
      code += `storage.${entityPlural} = [];\n`;
    }
  }

  code += '\n';

  // Generate routes for each endpoint
  for (const endpoint of features.endpoints) {
    const method = endpoint.method.toLowerCase();
    const pathParams = endpoint.path.replace('/api', '');

    code += `// ${endpoint.description}\n`;
    code += `router.${method}('${pathParams}', (req, res) => {\n`;

    if (endpoint.entity) {
      const entityName = endpoint.entity;
      const entityLower = entityName.toLowerCase();
      const entityPlural = plural(entityLower);

      if (endpoint.method === 'GET' && endpoint.path.includes(':id')) {
        // Get single item
        if (features.hasDatabase) {
          code += `  const item = models.${entityPlural}.find(i => i.id === req.params.id);\n`;
        } else {
          code += `  const item = storage.${entityPlural}.find(i => i.id === req.params.id);\n`;
        }
        code += `  if (!item) return res.status(404).json({ error: '${entityName} not found' });\n`;
        code += `  res.json(item);\n`;
      } else if (endpoint.method === 'GET') {
        // Get all items
        if (features.hasDatabase) {
          code += `  res.json(models.${entityPlural});\n`;
        } else {
          code += `  res.json(storage.${entityPlural});\n`;
        }
      } else if (endpoint.method === 'POST') {
        // Create item
        code += `  const newItem = {\n`;
        code += `    id: Date.now().toString(),\n`;
        code += `    ...req.body,\n`;
        code += `    createdAt: new Date().toISOString(),\n`;
        code += `  };\n`;
        if (features.hasDatabase) {
          code += `  models.${entityPlural}.push(newItem);\n`;
        } else {
          code += `  storage.${entityPlural}.push(newItem);\n`;
        }
        code += `  res.status(201).json(newItem);\n`;
      } else if (endpoint.method === 'PUT') {
        // Update item
        if (features.hasDatabase) {
          code += `  const index = models.${entityPlural}.findIndex(i => i.id === req.params.id);\n`;
        } else {
          code += `  const index = storage.${entityPlural}.findIndex(i => i.id === req.params.id);\n`;
        }
        code += `  if (index === -1) return res.status(404).json({ error: '${entityName} not found' });\n`;
        if (features.hasDatabase) {
          code += `  models.${entityPlural}[index] = { ...models.${entityPlural}[index], ...req.body };\n`;
          code += `  res.json(models.${entityPlural}[index]);\n`;
        } else {
          code += `  storage.${entityPlural}[index] = { ...storage.${entityPlural}[index], ...req.body };\n`;
          code += `  res.json(storage.${entityPlural}[index]);\n`;
        }
      } else if (endpoint.method === 'DELETE') {
        // Delete item
        if (features.hasDatabase) {
          code += `  const index = models.${entityPlural}.findIndex(i => i.id === req.params.id);\n`;
        } else {
          code += `  const index = storage.${entityPlural}.findIndex(i => i.id === req.params.id);\n`;
        }
        code += `  if (index === -1) return res.status(404).json({ error: '${entityName} not found' });\n`;
        if (features.hasDatabase) {
          code += `  models.${entityPlural}.splice(index, 1);\n`;
        } else {
          code += `  storage.${entityPlural}.splice(index, 1);\n`;
        }
        code += `  res.status(204).send();\n`;
      }
    } else {
      code += `  res.json({ message: 'Not implemented yet' });\n`;
    }

    code += `});\n\n`;
  }

  code += `module.exports = router;\n`;

  return code;
}

function generateModels(features: ParsedFeatures): string {
  let code = `// Data models\n`;
  code += `// In a real application, this would connect to a database\n\n`;

  for (const entity of features.entities) {
    const entityPlural = plural(entity.name.toLowerCase());
    code += `exports.${entityPlural} = [];\n`;
  }

  return code;
}

function generateDatabase(features: ParsedFeatures): string {
  return `// Database configuration
// This is a placeholder. In production, configure your database here.

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || '${features.projectName}',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
};

// Example: PostgreSQL connection
// const { Pool } = require('pg');
// const pool = new Pool(config);

module.exports = config;
`;
}

function generateFrontend(features: ParsedFeatures): GeneratedApp['frontend'] {
  const indexHtml = generateIndexHtml(features);
  const stylesCss = generateStylesCss(features);
  const appJs = generateAppJs(features);

  return {
    'index.html': indexHtml,
    'styles.css': stylesCss,
    'app.js': appJs,
  };
}

function generateIndexHtml(features: ParsedFeatures): string {
  const title = features.projectName.split('-').map(capitalize).join(' ');

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <h1 class="logo">${title}</h1>
            <ul class="nav-links">
                <li><a href="#home">Home</a></li>
`;

  // Add navigation for entities
  for (const entity of features.entities) {
    const entityPlural = plural(entity.name.toLowerCase());
    html += `                <li><a href="#${entityPlural}">${entity.name}s</a></li>\n`;
  }

  html += `            </ul>
        </div>
    </nav>

    <main class="container">
        <section id="home" class="section active">
            <h2>Welcome to ${title}</h2>
            <p>Your simple web application is ready to use!</p>
        </section>
`;

  // Add sections for each entity
  for (const entity of features.entities) {
    const entityPlural = plural(entity.name.toLowerCase());
    const entityLower = entity.name.toLowerCase();

    html += `
        <section id="${entityPlural}" class="section">
            <div class="section-header">
                <h2>${entity.name}s</h2>
                <button class="btn btn-primary" onclick="showAddForm('${entityLower}')">Add ${entity.name}</button>
            </div>

            <div id="${entityLower}-list" class="item-list">
                <!-- Items will be loaded here -->
            </div>

            <div id="${entityLower}-form" class="form-container" style="display: none;">
                <h3 id="${entityLower}-form-title">Add ${entity.name}</h3>
                <form id="${entityLower}-form-element">
`;

    // Add form fields
    for (const field of entity.fields) {
      if (field.name !== 'id' && field.name !== 'createdAt') {
        const inputType = field.type === 'email' ? 'email' :
                          field.type === 'number' ? 'number' :
                          field.type === 'date' ? 'date' :
                          field.type === 'boolean' ? 'checkbox' : 'text';

        if (field.type === 'boolean') {
          html += `                    <div class="form-group">
                        <label>
                            <input type="${inputType}" name="${field.name}" id="${entityLower}-${field.name}">
                            ${capitalize(field.name)}
                        </label>
                    </div>
`;
        } else {
          html += `                    <div class="form-group">
                        <label for="${entityLower}-${field.name}">${capitalize(field.name)}</label>
                        <input type="${inputType}" name="${field.name}" id="${entityLower}-${field.name}" ${field.required ? 'required' : ''}>
                    </div>
`;
        }
      }
    }

    html += `                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Save</button>
                        <button type="button" class="btn btn-secondary" onclick="hideForm('${entityLower}')">Cancel</button>
                    </div>
                </form>
            </div>
        </section>
`;
  }

  html += `    </main>

    <footer class="footer">
        <div class="container">
            <p>&copy; 2024 ${title}. Generated by WebApp Generator.</p>
        </div>
    </footer>

    <script src="app.js"></script>
</body>
</html>
`;

  return html;
}

function generateStylesCss(features: ParsedFeatures): string {
  const styles = features.style === 'minimal' ? generateMinimalStyles() :
                 features.style === 'corporate' ? generateCorporateStyles() :
                 generateModernStyles();

  return styles;
}

function generateModernStyles(): string {
  return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    line-height: 1.6;
    color: #333;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
}

/* Navigation */
.navbar {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    padding: 1rem 0;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    position: sticky;
    top: 0;
    z-index: 100;
}

.navbar .container {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.logo {
    font-size: 1.5rem;
    font-weight: 700;
    color: #667eea;
}

.nav-links {
    list-style: none;
    display: flex;
    gap: 2rem;
}

.nav-links a {
    text-decoration: none;
    color: #333;
    font-weight: 500;
    transition: color 0.3s;
}

.nav-links a:hover {
    color: #667eea;
}

/* Main Content */
main {
    background: white;
    min-height: calc(100vh - 200px);
    margin: 2rem auto;
    padding: 2rem;
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
}

.section {
    display: none;
    animation: fadeIn 0.5s;
}

.section.active {
    display: block;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #f0f0f0;
}

/* Buttons */
.btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 5px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s;
}

.btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
}

.btn-secondary {
    background: #e0e0e0;
    color: #333;
}

.btn-secondary:hover {
    background: #d0d0d0;
}

.btn-danger {
    background: #ff4757;
    color: white;
}

.btn-danger:hover {
    background: #ff3838;
}

/* Item List */
.item-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
}

.item-card {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
    transition: all 0.3s;
}

.item-card:hover {
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
    transform: translateY(-5px);
}

.item-card h3 {
    color: #667eea;
    margin-bottom: 0.5rem;
}

.item-card-actions {
    margin-top: 1rem;
    display: flex;
    gap: 0.5rem;
}

.item-card-actions .btn {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
}

/* Forms */
.form-container {
    background: #f9f9f9;
    padding: 2rem;
    border-radius: 8px;
    margin-bottom: 2rem;
}

.form-group {
    margin-bottom: 1.5rem;
}

.form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: #333;
}

.form-group input,
.form-group textarea,
.form-group select {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #ddd;
    border-radius: 5px;
    font-size: 1rem;
    transition: border-color 0.3s;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
    outline: none;
    border-color: #667eea;
}

.form-actions {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
}

/* Footer */
.footer {
    background: rgba(255, 255, 255, 0.95);
    padding: 2rem 0;
    text-align: center;
    color: #666;
}

/* Responsive */
@media (max-width: 768px) {
    .navbar .container {
        flex-direction: column;
        gap: 1rem;
    }

    .nav-links {
        flex-wrap: wrap;
        justify-content: center;
        gap: 1rem;
    }

    .item-list {
        grid-template-columns: 1fr;
    }

    .section-header {
        flex-direction: column;
        gap: 1rem;
        align-items: flex-start;
    }
}
`;
}

function generateMinimalStyles(): string {
  return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Courier New', monospace;
    line-height: 1.6;
    color: #000;
    background: #fff;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

.navbar {
    border-bottom: 2px solid #000;
    padding-bottom: 1rem;
    margin-bottom: 2rem;
}

.logo {
    font-size: 1.5rem;
    font-weight: bold;
}

.nav-links {
    list-style: none;
    display: flex;
    gap: 1rem;
    margin-top: 0.5rem;
}

.nav-links a {
    color: #000;
    text-decoration: underline;
}

.section {
    display: none;
}

.section.active {
    display: block;
}

.btn {
    padding: 0.5rem 1rem;
    border: 2px solid #000;
    background: #fff;
    cursor: pointer;
    font-family: inherit;
}

.btn:hover {
    background: #000;
    color: #fff;
}

.item-list {
    margin: 2rem 0;
}

.item-card {
    border: 1px solid #000;
    padding: 1rem;
    margin-bottom: 1rem;
}

.form-group {
    margin-bottom: 1rem;
}

.form-group label {
    display: block;
    margin-bottom: 0.25rem;
}

.form-group input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #000;
}

.footer {
    border-top: 2px solid #000;
    padding-top: 1rem;
    margin-top: 2rem;
    text-align: center;
}
`;
}

function generateCorporateStyles(): string {
  return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    line-height: 1.6;
    color: #333;
    background: #f4f4f4;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
}

.navbar {
    background: #003366;
    color: white;
    padding: 1rem 0;
}

.navbar .container {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.logo {
    color: white;
    font-size: 1.5rem;
}

.nav-links {
    list-style: none;
    display: flex;
    gap: 2rem;
}

.nav-links a {
    color: white;
    text-decoration: none;
    font-weight: 500;
}

.nav-links a:hover {
    text-decoration: underline;
}

main {
    background: white;
    min-height: calc(100vh - 200px);
    margin: 2rem auto;
    padding: 2rem;
    box-shadow: 0 0 10px rgba(0,0,0,0.1);
}

.section {
    display: none;
}

.section.active {
    display: block;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #003366;
}

.btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 3px;
    font-weight: 500;
    cursor: pointer;
}

.btn-primary {
    background: #003366;
    color: white;
}

.btn-primary:hover {
    background: #004080;
}

.btn-secondary {
    background: #ccc;
    color: #333;
}

.btn-danger {
    background: #cc0000;
    color: white;
}

.item-list {
    display: grid;
    gap: 1rem;
}

.item-card {
    background: #fafafa;
    padding: 1.5rem;
    border-left: 4px solid #003366;
}

.item-card h3 {
    color: #003366;
    margin-bottom: 0.5rem;
}

.item-card-actions {
    margin-top: 1rem;
    display: flex;
    gap: 0.5rem;
}

.form-container {
    background: #fafafa;
    padding: 2rem;
    margin-bottom: 2rem;
}

.form-group {
    margin-bottom: 1.5rem;
}

.form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
}

.form-group input,
.form-group textarea {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #ccc;
    border-radius: 3px;
}

.form-group input:focus {
    outline: none;
    border-color: #003366;
}

.form-actions {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
}

.footer {
    background: #003366;
    color: white;
    padding: 2rem 0;
    text-align: center;
}
`;
}

function generateAppJs(features: ParsedFeatures): string {
  let js = `const API_BASE = window.location.origin;

// Navigation
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').substring(1);
        showSection(targetId);
    });
});

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');

        // Load data if it's an entity section
        if (sectionId !== 'home') {
            loadItems(sectionId);
        }
    }
}

`;

  // Generate functions for each entity
  for (const entity of features.entities) {
    const entityName = entity.name;
    const entityLower = entityName.toLowerCase();
    const entityPlural = plural(entityLower);

    js += `
// ${entityName} functions
async function loadItems(sectionId) {
    if (sectionId !== '${entityPlural}') return;

    try {
        const response = await fetch(\`\${API_BASE}/api/${entityPlural}\`);
        const items = await response.json();

        const listElement = document.getElementById('${entityLower}-list');

        if (items.length === 0) {
            listElement.innerHTML = '<p>No ${entityPlural} found. Click "Add ${entityName}" to create one.</p>';
            return;
        }

        listElement.innerHTML = items.map(item => \`
            <div class="item-card">
                <h3>\${item.name || item.title || '${entityName} #' + item.id}</h3>
                ${entity.fields.filter(f => f.name !== 'id' && f.name !== 'name' && f.name !== 'title').slice(0, 3).map(f =>
                  `<p><strong>${capitalize(f.name)}:</strong> \${item.${f.name} || 'N/A'}</p>`
                ).join('\n                ')}
                <div class="item-card-actions">
                    <button class="btn btn-primary btn-sm" onclick="edit${entityName}('\${item.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="delete${entityName}('\${item.id}')">Delete</button>
                </div>
            </div>
        \`).join('');
    } catch (error) {
        console.error('Error loading ${entityPlural}:', error);
        alert('Failed to load ${entityPlural}');
    }
}

function showAddForm(entityType) {
    if (entityType !== '${entityLower}') return;

    const form = document.getElementById('${entityLower}-form');
    const formElement = document.getElementById('${entityLower}-form-element');
    const formTitle = document.getElementById('${entityLower}-form-title');

    formTitle.textContent = 'Add ${entityName}';
    formElement.reset();
    formElement.dataset.mode = 'create';
    delete formElement.dataset.itemId;

    form.style.display = 'block';
}

function hideForm(entityType) {
    if (entityType !== '${entityLower}') return;

    const form = document.getElementById('${entityLower}-form');
    form.style.display = 'none';
}

async function edit${entityName}(id) {
    try {
        const response = await fetch(\`\${API_BASE}/api/${entityPlural}/\${id}\`);
        const item = await response.json();

        const form = document.getElementById('${entityLower}-form');
        const formElement = document.getElementById('${entityLower}-form-element');
        const formTitle = document.getElementById('${entityLower}-form-title');

        formTitle.textContent = 'Edit ${entityName}';
        formElement.dataset.mode = 'update';
        formElement.dataset.itemId = id;

        // Populate form
        ${entity.fields.filter(f => f.name !== 'id' && f.name !== 'createdAt').map(f => {
          if (f.type === 'boolean') {
            return `document.getElementById('${entityLower}-${f.name}').checked = item.${f.name} || false;`;
          } else {
            return `document.getElementById('${entityLower}-${f.name}').value = item.${f.name} || '';`;
          }
        }).join('\n        ')}

        form.style.display = 'block';
    } catch (error) {
        console.error('Error loading ${entityLower}:', error);
        alert('Failed to load ${entityLower}');
    }
}

async function delete${entityName}(id) {
    if (!confirm('Are you sure you want to delete this ${entityLower}?')) return;

    try {
        await fetch(\`\${API_BASE}/api/${entityPlural}/\${id}\`, {
            method: 'DELETE',
        });

        loadItems('${entityPlural}');
    } catch (error) {
        console.error('Error deleting ${entityLower}:', error);
        alert('Failed to delete ${entityLower}');
    }
}

// Form submission
document.getElementById('${entityLower}-form-element')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const data = {};

    for (const [key, value] of formData.entries()) {
        const input = document.getElementById('${entityLower}-' + key);
        if (input && input.type === 'checkbox') {
            data[key] = input.checked;
        } else {
            data[key] = value;
        }
    }

    const mode = e.target.dataset.mode;
    const itemId = e.target.dataset.itemId;

    try {
        const url = mode === 'create'
            ? \`\${API_BASE}/api/${entityPlural}\`
            : \`\${API_BASE}/api/${entityPlural}/\${itemId}\`;

        const method = mode === 'create' ? 'POST' : 'PUT';

        await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        hideForm('${entityLower}');
        loadItems('${entityPlural}');
    } catch (error) {
        console.error('Error saving ${entityLower}:', error);
        alert('Failed to save ${entityLower}');
    }
});
`;
  }

  js += `
// Initialize
document.addEventListener('DOMContentLoaded', () => {
    showSection('home');
});
`;

  return js;
}

function generateDeployment(features: ParsedFeatures): GeneratedApp['deployment'] {
  const templateYaml = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: ${features.projectName} - Generated Web Application

Resources:
  # API Gateway
  ApiGateway:
    Type: AWS::Serverless::Api
    Properties:
      StageName: prod
      Cors:
        AllowMethods: "'GET,POST,PUT,DELETE,OPTIONS'"
        AllowHeaders: "'Content-Type,Authorization'"
        AllowOrigin: "'*'"

  # Lambda Function for Backend
  BackendFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: server.handler
      Runtime: nodejs18.x
      CodeUri: ./
      MemorySize: 512
      Timeout: 30
      Environment:
        Variables:
          NODE_ENV: production
      Events:
        ApiEvent:
          Type: Api
          Properties:
            RestApiId: !Ref ApiGateway
            Path: /{proxy+}
            Method: ANY

  # S3 Bucket for Static Files
  WebsiteBucket:
    Type: AWS::S3::Bucket
    Properties:
      WebsiteConfiguration:
        IndexDocument: index.html
        ErrorDocument: index.html
      PublicAccessBlockConfiguration:
        BlockPublicAcls: false
        BlockPublicPolicy: false
        IgnorePublicAcls: false
        RestrictPublicBuckets: false

  WebsiteBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref WebsiteBucket
      PolicyDocument:
        Statement:
          - Effect: Allow
            Principal: '*'
            Action: 's3:GetObject'
            Resource: !Sub '\${WebsiteBucket.Arn}/*'

Outputs:
  ApiUrl:
    Description: API Gateway endpoint URL
    Value: !Sub 'https://\${ApiGateway}.execute-api.\${AWS::Region}.amazonaws.com/prod/'

  WebsiteUrl:
    Description: Website URL
    Value: !GetAtt WebsiteBucket.WebsiteURL

  BackendFunctionArn:
    Description: Backend Lambda Function ARN
    Value: !GetAtt BackendFunction.Arn
`;

  const readme = `# ${features.projectName}

Generated web application with backend and frontend.

## Features

${features.entities.map(e => `- ${e.name} management`).join('\n')}
${features.hasAuth ? '- User authentication' : ''}
${features.hasDatabase ? '- Database integration' : ''}

## Project Structure

\`\`\`
.
├── server.js           # Express server
├── routes.js           # API routes
${features.hasDatabase ? '├── models.js          # Data models\n├── database.js        # Database config\n' : ''}├── index.html          # Main HTML file
├── styles.css          # Styles
├── app.js              # Frontend JavaScript
├── template.yaml       # AWS SAM template
└── package.json        # Dependencies
\`\`\`

## Local Development

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Start the server:
\`\`\`bash
npm start
\`\`\`

3. Open your browser:
\`\`\`
http://localhost:3000
\`\`\`

## API Endpoints

${features.endpoints.map(e => `- \`${e.method} ${e.path}\` - ${e.description}`).join('\n')}

## Deployment

### Deploy to AWS Lambda (using SAM)

1. Install AWS SAM CLI
2. Build and deploy:
\`\`\`bash
sam build
sam deploy --guided
\`\`\`

### Deploy to any Node.js hosting

1. Upload all files to your hosting provider
2. Set environment variables if needed
3. Run \`npm install\` and \`npm start\`

## Environment Variables

- \`PORT\` - Server port (default: 3000)
${features.hasDatabase ? `- \`DB_HOST\` - Database host
- \`DB_PORT\` - Database port
- \`DB_NAME\` - Database name
- \`DB_USER\` - Database user
- \`DB_PASSWORD\` - Database password
` : ''}

## Customization

This is a generated application. Feel free to modify:
- Add authentication
- Connect to a real database
- Add more features
- Improve styling
- Add validation

## License

MIT
`;

  return {
    'template.yaml': templateYaml,
    'README.md': readme,
  };
}

// Helper functions
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function singular(str: string): string {
  if (str.endsWith('ies')) return str.slice(0, -3) + 'y';
  if (str.endsWith('ses') || str.endsWith('ches') || str.endsWith('shes')) return str.slice(0, -2);
  if (str.endsWith('s')) return str.slice(0, -1);
  return str;
}

function plural(str: string): string {
  if (str.endsWith('y')) return str.slice(0, -1) + 'ies';
  if (str.endsWith('s') || str.endsWith('ch') || str.endsWith('sh')) return str + 'es';
  return str + 's';
}
