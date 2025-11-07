FROM public.ecr.aws/docker/library/node:20-alpine

# Install system dependencies and tools
RUN apk add --no-cache \
    git \
    python3 \
    py3-pip \
    bash \
    curl \
    unzip \
    gcc \
    musl-dev \
    python3-dev \
    libffi-dev \
    openssl-dev \
    ca-certificates \
    jq

# Create symlinks for all Lambda-supported Python versions
# Alpine installs python3.12, but SAM CLI looks for version-specific binaries
# These symlinks allow SAM to build for any Lambda Python runtime (3.8, 3.9, 3.10, 3.11, 3.12, 3.13)
RUN ln -sf /usr/bin/python3.12 /usr/bin/python3.8 && \
    ln -sf /usr/bin/python3.12 /usr/bin/python3.9 && \
    ln -sf /usr/bin/python3.12 /usr/bin/python3.10 && \
    ln -sf /usr/bin/python3.12 /usr/bin/python3.11 && \
    ln -sf /usr/bin/python3.12 /usr/bin/python3.13

# Install AWS CLI and SAM CLI via pip
RUN pip3 install --no-cache-dir --break-system-packages --upgrade pip setuptools wheel \
    && pip3 install --no-cache-dir --break-system-packages awscli aws-sam-cli

# Install Terraform
ARG TERRAFORM_VERSION=1.7.5
RUN curl -sL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" -o "terraform.zip" \
    && unzip -q terraform.zip -d /usr/local/bin/ \
    && rm terraform.zip \
    && chmod +x /usr/local/bin/terraform

# Install Serverless Framework and AWS CDK globally
RUN npm install -g serverless@3 aws-cdk

# Verify installations
RUN aws --version && \
    sam --version && \
    terraform version && \
    serverless --version && \
    cdk --version

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
RUN npm install typescript @types/node @types/js-yaml --save-dev && \
    npm run build && \
    npm uninstall typescript @types/node @types/js-yaml

# Set the entry point
CMD ["node", "dist/index.js"]
