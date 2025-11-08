FROM public.ecr.aws/docker/library/node:20-alpine

# Install minimal system dependencies
RUN apk add --no-cache \
    ca-certificates

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY *.ts ./

# Build TypeScript
RUN npm install typescript @types/node --save-dev && \
    npm run build && \
    npm uninstall typescript @types/node

# Set the entry point
CMD ["node", "dist/index.js"]
