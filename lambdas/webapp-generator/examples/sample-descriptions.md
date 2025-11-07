# Sample Application Descriptions

This file contains example descriptions you can use to test the WebApp Generator.

## 1. Task Management App

```json
{
  "description": "I want to build a task management app called TaskMaster. Users can create, view, edit, and delete tasks. Each task should have a title, description, priority level (low, medium, high), status (todo, in-progress, done), due date, and assigned to field. The app should have a modern colorful interface.",
  "projectName": "taskmaster",
  "style": "modern"
}
```

**Expected Output:**
- Entity: Task
- Fields: title, description, priority, status, dueDate, assignedTo
- Full CRUD endpoints
- Modern UI with task cards

---

## 2. Simple Blog Platform

```json
{
  "description": "Create a blog platform where writers can publish articles. Each article has a title, content, author name, category, tags, and publication date. Users should be able to list all articles, read individual articles, and authors can create, edit, or delete their articles.",
  "projectName": "myblog",
  "style": "minimal"
}
```

**Expected Output:**
- Entity: Article
- Fields: title, content, author, category, tags, publishedAt
- CRUD operations
- Minimal, typography-focused design

---

## 3. Product Inventory System

```json
{
  "description": "Build an inventory management system for our warehouse called StockTracker. Track products with SKU, name, description, quantity in stock, reorder level, unit price, supplier, and last updated date. Need to add new products, update stock quantities, view inventory reports, and remove discontinued items. Use a corporate professional style.",
  "projectName": "stocktracker",
  "style": "corporate",
  "includeDatabase": true
}
```

**Expected Output:**
- Entity: Product
- Fields: sku, name, description, quantity, reorderLevel, unitPrice, supplier, lastUpdated
- Full inventory management
- Professional corporate theme

---

## 4. Event Management Platform

```json
{
  "description": "I need an event management platform called EventHub. Organizers can create events with a name, description, date, time, location, category, maximum attendees, and ticket price. Users should be able to browse upcoming events, view event details, register for events, and organizers can manage their events with user authentication.",
  "projectName": "eventhub",
  "style": "modern",
  "includeDatabase": true
}
```

**Expected Output:**
- Entity: Event
- Fields: name, description, date, time, location, category, maxAttendees, ticketPrice
- Event browsing and management
- Authentication scaffolding
- Modern event card layout

---

## 5. Recipe Collection

```json
{
  "description": "Create a recipe management app. Each recipe has a title, description, ingredients list, preparation time, cooking time, difficulty level (easy, medium, hard), servings, and category (breakfast, lunch, dinner, dessert). Users can add recipes, view all recipes, search by category, edit recipes, and delete recipes they created.",
  "projectName": "cookbook",
  "style": "modern"
}
```

**Expected Output:**
- Entity: Recipe
- Fields: title, description, ingredients, prepTime, cookTime, difficulty, servings, category
- Recipe CRUD operations
- Colorful cooking-themed UI

---

## 6. Customer Contact Manager (CRM)

```json
{
  "description": "Build a simple CRM system to manage customer contacts. Store customer name, email, phone number, company, job title, address, notes, and date added. Sales team needs to add new contacts, view contact list, update contact information, and delete outdated contacts. Professional corporate design.",
  "projectName": "contacts-crm",
  "style": "corporate"
}
```

**Expected Output:**
- Entity: Contact
- Fields: name, email, phone, company, jobTitle, address, notes, dateAdded
- Contact management operations
- Professional business UI

---

## 7. Simple E-commerce Store

```json
{
  "description": "I want to create a product catalog for an online store called ShopEasy. Each product should have a name, description, price, category, image URL, stock quantity, and ratings. Customers can browse products, view product details, and admins can add new products, edit product information, and remove products.",
  "projectName": "shopeasy",
  "style": "modern",
  "includeDatabase": false
}
```

**Expected Output:**
- Entity: Product
- Fields: name, description, price, category, imageUrl, stockQuantity, ratings
- Product catalog management
- E-commerce style layout

---

## 8. Project Tracker

```json
{
  "description": "Create a project tracking application where teams can manage projects. Each project has a name, description, status (planning, active, on-hold, completed), start date, end date, budget, project manager, and team members. Users can create projects, update project status, view all projects, and archive completed projects.",
  "projectName": "projecttracker",
  "style": "corporate"
}
```

**Expected Output:**
- Entity: Project
- Fields: name, description, status, startDate, endDate, budget, projectManager, teamMembers
- Project management operations
- Status tracking interface

---

## 9. Movie Collection

```json
{
  "description": "Build a personal movie collection manager. Track movies with title, director, release year, genre, rating, runtime, watched status, and personal notes. Users can add movies to their collection, mark movies as watched, edit movie details, and delete movies from the collection. Use a minimal design.",
  "projectName": "movielog",
  "style": "minimal"
}
```

**Expected Output:**
- Entity: Movie
- Fields: title, director, releaseYear, genre, rating, runtime, watched, notes
- Movie collection management
- Clean, simple interface

---

## 10. Student Grade Tracker

```json
{
  "description": "I need a student grade tracking system for teachers. Track students with student ID, name, email, course, assignment name, grade, submission date, and feedback. Teachers should be able to add grades, view all student grades, update grades and feedback, and delete grade entries. Corporate professional style.",
  "projectName": "gradetracker",
  "style": "corporate"
}
```

**Expected Output:**
- Entity: Grade
- Fields: studentId, name, email, course, assignmentName, grade, submissionDate, feedback
- Grade management operations
- Academic professional theme

---

## Testing These Examples

### Using cURL

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{"description":"Your description here","projectName":"myapp","style":"modern"}'
```

### Using AWS SAM CLI

```bash
sam local invoke WebAppGeneratorFunction -e examples/test-request.json
```

### Using Postman

1. Set method to POST
2. URL: `https://your-api-gateway-url/generate`
3. Headers: `Content-Type: application/json`
4. Body: Raw JSON with your description

---

## Tips for Writing Good Descriptions

1. **Be Specific**: Clearly state what your app does
2. **Name It**: Give your project a name in the description
3. **List Fields**: Mention all the properties/fields you need
4. **State Operations**: Say what users can do (create, view, edit, delete)
5. **Mention Style**: If you have a preference, mention minimal/modern/corporate
6. **Add Context**: Include details about who uses it and why

### Example Template

```
I want to build a [type] app called [name]. Users can [actions].
Each [entity] should have [field1], [field2], [field3], and [field4].
The app should have a [style] interface.
```
