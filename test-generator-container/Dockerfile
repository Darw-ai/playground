FROM public.ecr.aws/lambda/nodejs:20

# Install git
RUN yum install -y git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY *.ts ./

# Build TypeScript
RUN npm run build

# Set the command to run the application
CMD ["node", "dist/index.js"]
