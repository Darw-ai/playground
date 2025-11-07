# WebApp Generator Lambda

A Lambda function that generates complete web applications from detailed text descriptions. This module intelligently parses requirements and creates both backend (Node.js/Express) and frontend (HTML/CSS/JS) code ready for deployment.

## Features

- **Intelligent Description Parsing**: Extracts entities, fields, endpoints, and UI requirements from natural language
- **Full-Stack Generation**: Creates both backend API and frontend UI
- **Multiple Style Options**: Choose from minimal, modern, or corporate design themes
- **Complete CRUD Operations**: Automatically generates Create, Read, Update, Delete endpoints
- **Deployment Ready**: Includes AWS SAM template and deployment documentation
- **Zero Configuration**: Works out of the box with sensible defaults

## How It Works

### 1. Description Parsing

The module analyzes your description to extract:
- **Entities**: Key objects/models (e.g., "tasks", "users", "products")
- **Fields**: Properties for each entity (e.g., "name", "description", "price")
- **Operations**: CRUD operations needed (create, view, edit, delete)
- **Pages**: UI components and routes
- **Features**: Authentication, database requirements, etc.

### 2. Code Generation

Based on the parsed features, it generates:

**Backend:**
- Express.js server with CORS support
- RESTful API routes
- Data models (in-memory or database-ready)
- Package.json with dependencies

**Frontend:**
- Responsive HTML5 pages
- Modern CSS with animations
- Vanilla JavaScript for API interaction
- Form validation and error handling

**Deployment:**
- AWS SAM CloudFormation template
- README with setup instructions
- Environment configuration

## API Usage

### Endpoint

```
POST /generate
```

### Request Body

```json
{
  "description": "I want to build a task management app where users can create, view, edit, and delete tasks. Each task should have a title, description, priority level, and due date. The app should have a clean modern interface.",
  "projectName": "task-manager",
  "includeDatabase": false,
  "style": "modern"
}
```

#### Parameters

- **description** (required): Detailed description of the web application
- **projectName** (optional): Name for the project (auto-generated if not provided)
- **includeDatabase** (optional): Include database setup code (default: auto-detected)
- **style** (optional): UI style theme - `"minimal"`, `"modern"`, or `"corporate"` (default: "modern")

### Response

```json
{
  "success": true,
  "projectName": "task-manager",
  "message": "Web application generated successfully",
  "app": {
    "backend": {
      "package.json": "...",
      "server.js": "...",
      "routes.js": "..."
    },
    "frontend": {
      "index.html": "...",
      "styles.css": "...",
      "app.js": "..."
    },
    "deployment": {
      "template.yaml": "...",
      "README.md": "..."
    }
  },
  "features": {
    "entities": 1,
    "endpoints": 5,
    "pages": 3,
    "hasAuth": false,
    "hasDatabase": false
  }
}
```

## Example Descriptions

### 1. Simple Blog

```
Create a blog where I can write and publish articles. Each article should have a title,
content, author name, and publication date. I want to be able to list all articles,
view individual articles, create new ones, and edit existing articles.
```

**Generated:**
- Entity: Article (title, content, author, publishedAt)
- Endpoints: GET /api/articles, GET /api/articles/:id, POST /api/articles, PUT /api/articles/:id, DELETE /api/articles/:id
- Pages: Home, Article List, Article Form

### 2. Product Catalog

```
I need a product catalog system called "ShopHub". Users should be able to browse products,
each with a name, description, price, category, and stock quantity. Include search functionality
and the ability for admins to add, edit, and remove products.
```

**Generated:**
- Entity: Product (name, description, price, category, stockQuantity)
- Full CRUD endpoints
- Product listing and management interface
- Modern e-commerce styling

### 3. Event Management

```
Build an event management platform where organizers can create events with a name,
description, date, time, location, and maximum attendees. Users should be able to view
all upcoming events and register for them. Include user authentication.
```

**Generated:**
- Entity: Event (name, description, date, time, location, maxAttendees)
- CRUD endpoints for events
- Authentication scaffolding
- Event listing and registration UI

### 4. Inventory System

```
Create an inventory tracking system for a warehouse. Track items with SKU, name, description,
quantity, location, and last updated date. Need to add items, update quantities, view current
stock, and delete discontinued items. Use a corporate professional style.
```

**Generated:**
- Entity: Item (sku, name, description, quantity, location, lastUpdated)
- Full inventory management API
- Professional corporate UI theme
- Stock tracking interface

## Description Writing Tips

For best results, include these elements in your description:

1. **Project Name**: "I want to build [name]" or "Create a [name] app"
2. **Entities**: Mention the key objects (tasks, products, users, etc.)
3. **Fields**: Describe what information each entity should have
4. **Operations**: Specify what users can do (create, view, edit, delete, list)
5. **Special Features**: Mention authentication, search, filtering, etc.
6. **Style Preference**: Mention "modern", "minimal", or "corporate" if desired

### Good Description Example

```
I want to build a recipe management app called "CookBook". Users can create, view, edit,
and delete recipes. Each recipe should have a title, description, ingredients list,
cooking time, difficulty level, and category. The app should have a modern, colorful
interface with search functionality and user authentication.
```

### What Gets Detected

- **Project Name**: "cookbook"
- **Entity**: Recipe
- **Fields**: title, description, ingredients, cookingTime, difficulty, category
- **Operations**: Full CRUD (create, read, update, delete)
- **Features**: Search, authentication
- **Style**: Modern

## Design Styles

### Modern (Default)
- Gradient backgrounds
- Card-based layouts
- Smooth animations
- Rounded corners
- Vibrant colors
- Box shadows

### Minimal
- Monospace fonts
- Black and white
- Simple borders
- No animations
- Text-focused
- Clean and fast

### Corporate
- Professional blue theme
- Conservative layout
- Standard fonts
- Business-appropriate
- Trust-building design

## Generated File Structure

```
your-project/
├── backend/
│   ├── package.json      # Node.js dependencies
│   ├── server.js         # Express server setup
│   ├── routes.js         # API route handlers
│   ├── models.js         # Data models (if database enabled)
│   └── database.js       # Database config (if enabled)
├── frontend/
│   ├── index.html        # Main HTML page
│   ├── styles.css        # CSS styles
│   └── app.js            # Frontend JavaScript
└── deployment/
    ├── template.yaml     # AWS SAM template
    └── README.md         # Setup instructions
```

## Using the Generated Code

### 1. Save the files

Extract the generated code from the response and save each file to your local filesystem.

### 2. Install dependencies

```bash
cd your-project
npm install
```

### 3. Run locally

```bash
npm start
```

Visit `http://localhost:3000` in your browser.

### 4. Deploy to AWS

```bash
sam build
sam deploy --guided
```

## Customization

The generated code is fully customizable:

- **Add authentication**: Integrate with Passport.js, JWT, or AWS Cognito
- **Connect database**: Replace in-memory storage with MongoDB, PostgreSQL, or DynamoDB
- **Add validation**: Implement request validation with express-validator
- **Enhance UI**: Add more styling, components, or use a framework like React
- **Add testing**: Include Jest, Mocha, or other testing frameworks
- **CI/CD**: Set up GitHub Actions or AWS CodePipeline

## Integration with Main Project

This Lambda can be integrated into the main GitHub Lambda Deployer infrastructure:

1. Add to CDK stack in `cdk/lib/deployer-stack.ts`
2. Create API Gateway endpoint `/generate`
3. Configure CORS and environment variables
4. Optionally save generated code to S3

## Technical Details

### Parser Intelligence

- Uses regex patterns to identify entities and fields
- Counts word frequency to determine importance
- Recognizes field types (string, number, date, email, boolean)
- Detects authentication keywords (login, signup, user)
- Identifies CRUD operations from verbs

### Code Generation

- Template-based approach with dynamic content
- Generates valid, production-ready code
- Follows Node.js and Express best practices
- Creates RESTful API conventions
- Implements proper error handling
- Includes CORS support

### Frontend Architecture

- Vanilla JavaScript (no framework dependencies)
- Single Page Application (SPA) behavior
- Client-side routing with hash navigation
- Fetch API for HTTP requests
- Responsive CSS Grid and Flexbox
- Mobile-friendly design

## Limitations

- Generated apps are starting points, not production-ready
- No built-in authentication (scaffolding only)
- In-memory storage by default (database connection not included)
- Basic validation (enhance as needed)
- Single-file components (no build system)
- No test coverage (add tests yourself)

## Future Enhancements

- [ ] AI-powered description parsing using Claude or GPT
- [ ] Database schema generation and migrations
- [ ] Authentication implementation (OAuth, JWT)
- [ ] React/Vue/Angular frontend options
- [ ] TypeScript support
- [ ] GraphQL API option
- [ ] Docker containerization
- [ ] Kubernetes deployment templates
- [ ] CI/CD pipeline generation
- [ ] Test suite generation

## Dependencies

### Runtime
- `@aws-sdk/client-s3`: AWS S3 integration
- `archiver`: Zip file creation

### Development
- `typescript`: TypeScript compiler
- `@types/aws-lambda`: Lambda type definitions
- `@types/node`: Node.js type definitions

## Build

```bash
npm install
npm run build
```

The compiled JavaScript will be in the `dist/` directory.

## Testing

Test the Lambda locally using AWS SAM CLI:

```bash
sam local invoke WebAppGeneratorFunction -e event.json
```

Example `event.json`:

```json
{
  "httpMethod": "POST",
  "path": "/generate",
  "body": "{\"description\":\"Create a simple todo app with tasks that have a title and status\"}"
}
```

## License

MIT
