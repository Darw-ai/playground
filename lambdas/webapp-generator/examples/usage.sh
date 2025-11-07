#!/bin/bash

# WebApp Generator - Usage Examples
# This script shows how to test the webapp-generator Lambda function

API_ENDPOINT="${API_ENDPOINT:-http://localhost:3000}"

echo "==================================="
echo "WebApp Generator - Usage Examples"
echo "==================================="
echo ""

# Example 1: Simple Todo App
echo "Example 1: Generating a Todo App..."
curl -X POST "${API_ENDPOINT}/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Create a simple todo app where users can add, view, edit, and delete tasks. Each task has a title, description, and status (completed or not).",
    "projectName": "todo-app",
    "style": "minimal"
  }' | jq '.'

echo ""
echo "-----------------------------------"
echo ""

# Example 2: Blog Platform
echo "Example 2: Generating a Blog Platform..."
curl -X POST "${API_ENDPOINT}/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "I want to build a blog where writers can publish articles. Each article has a title, content, author, publication date, and category. Users can read articles, and authors can create, edit, and delete their posts.",
    "projectName": "my-blog",
    "style": "modern"
  }' | jq '.'

echo ""
echo "-----------------------------------"
echo ""

# Example 3: Product Catalog
echo "Example 3: Generating a Product Catalog..."
curl -X POST "${API_ENDPOINT}/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Build a product inventory system for a store called ShopHub. Products have SKU, name, description, price, quantity, and category. Store managers need to add products, update inventory, view all products, and remove discontinued items. Use corporate style.",
    "projectName": "shophub",
    "style": "corporate",
    "includeDatabase": true
  }' | jq '.'

echo ""
echo "-----------------------------------"
echo ""

# Example 4: Extract and save generated files
echo "Example 4: Generating and Saving Files..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Create a contact manager where I can store contacts with name, email, phone, and company. I need to add, view, edit, and delete contacts.",
    "projectName": "contacts"
  }')

PROJECT_NAME=$(echo "$RESPONSE" | jq -r '.projectName')
echo "Generated project: $PROJECT_NAME"

# Create project directory
mkdir -p "$PROJECT_NAME"

# Save backend files
echo "$RESPONSE" | jq -r '.app.backend["package.json"]' > "$PROJECT_NAME/package.json"
echo "$RESPONSE" | jq -r '.app.backend["server.js"]' > "$PROJECT_NAME/server.js"
echo "$RESPONSE" | jq -r '.app.backend["routes.js"]' > "$PROJECT_NAME/routes.js"

# Save frontend files
mkdir -p "$PROJECT_NAME/public"
echo "$RESPONSE" | jq -r '.app.frontend["index.html"]' > "$PROJECT_NAME/public/index.html"
echo "$RESPONSE" | jq -r '.app.frontend["styles.css"]' > "$PROJECT_NAME/public/styles.css"
echo "$RESPONSE" | jq -r '.app.frontend["app.js"]' > "$PROJECT_NAME/public/app.js"

# Save deployment files
echo "$RESPONSE" | jq -r '.app.deployment["template.yaml"]' > "$PROJECT_NAME/template.yaml"
echo "$RESPONSE" | jq -r '.app.deployment["README.md"]' > "$PROJECT_NAME/README.md"

echo "Files saved to ./$PROJECT_NAME/"
echo ""
echo "To run the application:"
echo "  cd $PROJECT_NAME"
echo "  npm install"
echo "  npm start"
echo ""

echo "==================================="
echo "Examples completed!"
echo "==================================="
