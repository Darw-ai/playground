# Project Root Path Feature - Implementation Analysis

## Current State

### Request Flow
1. **API Handler** receives request:
   ```json
   {
     "repository": "https://github.com/username/repo",
     "branch": "main"
   }
   ```

2. **Repository is cloned** to `/tmp/{sessionId}` (full repo root)

3. **IaC detection** happens at the cloned repo root level

4. **Deployment** uses the repo root as the project directory

### Current Limitations
- **Cannot deploy from subdirectories** in a monorepo
- **Entire repository must be a single IaC project**
- **No support for multi-function repositories**

## Desired State

### Enhanced Request
```json
{
  "repository": "https://github.com/username/repo",
  "branch": "main",
  "projectRoot": "functions/my-lambda"  // Optional: relative path within repo
}
```

### Use Cases
1. **Monorepo with multiple functions**:
   ```
   my-repo/
   ├── functions/
   │   ├── function-a/
   │   │   ├── index.js
   │   │   └── package.json
   │   └── function-b/
   │       ├── template.yaml
   │       └── index.js
   ├── shared/
   └── README.md
   ```
   Deploy with: `"projectRoot": "functions/function-a"`

2. **Nested project structure**:
   ```
   playground/
   ├── examples/
   │   ├── simple-lambda/
   │   │   ├── index.js
   │   │   └── package.json
   │   └── cloudformation-lambda/
   │       ├── template.yaml
   │       └── index.js
   └── other-stuff/
   ```
   Deploy with: `"projectRoot": "examples/simple-lambda"`

3. **Subdirectory-based organization**:
   ```
   app/
   ├── backend/
   │   └── lambda/
   │       ├── template.yaml
   │       └── handler.js
   └── frontend/
   ```
   Deploy with: `"projectRoot": "backend/lambda"`

## Required Changes

### 1. API Handler (`lambdas/api-handler/index.ts`)

#### Change 1.1: Update DeployRequest Interface
**Location**: Lines 18-21

**Current**:
```typescript
interface DeployRequest {
  repository: string;
  branch: string;
}
```

**Proposed**:
```typescript
interface DeployRequest {
  repository: string;
  branch: string;
  projectRoot?: string;  // Optional: relative path to project directory within repo
}
```

#### Change 1.2: Add Validation for projectRoot
**Location**: Lines 106-132 (handleDeploy function)

**Add after branch validation**:
```typescript
// Validate projectRoot if provided
if (request.projectRoot) {
  // Remove leading/trailing slashes
  request.projectRoot = request.projectRoot.replace(/^\/+|\/+$/g, '');

  // Validate path format (no .. or absolute paths)
  if (request.projectRoot.includes('..') || path.isAbsolute(request.projectRoot)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid projectRoot: must be a relative path without ".."',
        example: 'functions/my-lambda',
      }),
    };
  }

  // Validate characters (alphanumeric, dash, underscore, slash)
  const pathPattern = /^[a-zA-Z0-9_\-\/]+$/;
  if (!pathPattern.test(request.projectRoot)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid projectRoot: only alphanumeric, dash, underscore, and slash allowed',
        example: 'functions/my-lambda',
      }),
    };
  }
}
```

#### Change 1.3: Update DeploymentRecord Interface
**Location**: Lines 23-33

**Current**:
```typescript
interface DeploymentRecord {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  repository: string;
  branch: string;
  message?: string;
  logs?: string[];
  deployedResources?: Record<string, any>;
  error?: string;
}
```

**Proposed**:
```typescript
interface DeploymentRecord {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  repository: string;
  branch: string;
  projectRoot?: string;  // Add this field
  message?: string;
  logs?: string[];
  deployedResources?: Record<string, any>;
  error?: string;
}
```

#### Change 1.4: Store projectRoot in DynamoDB
**Location**: Lines 139-147 (deploymentRecord creation)

**Add field**:
```typescript
const deploymentRecord: DeploymentRecord = {
  sessionId,
  timestamp,
  status: 'pending',
  repository: request.repository,
  branch: request.branch,
  projectRoot: request.projectRoot,  // Add this line
  message: 'Deployment queued',
  logs: ['Deployment initiated'],
};
```

#### Change 1.5: Pass projectRoot to ECS Task
**Location**: Lines 175-179 (ECS container environment)

**Current**:
```typescript
environment: [
  { name: 'SESSION_ID', value: sessionId },
  { name: 'REPOSITORY', value: request.repository },
  { name: 'BRANCH', value: request.branch },
],
```

**Proposed**:
```typescript
environment: [
  { name: 'SESSION_ID', value: sessionId },
  { name: 'REPOSITORY', value: request.repository },
  { name: 'BRANCH', value: request.branch },
  { name: 'PROJECT_ROOT', value: request.projectRoot || '' },  // Add this line
],
```

#### Change 1.6: Update Status Response
**Location**: Lines 227-274 (handleGetStatus function)

**Add projectRoot to response** (line 266):
```typescript
return {
  statusCode: 200,
  headers,
  body: JSON.stringify({
    sessionId: latestRecord.sessionId,
    status: latestRecord.status,
    repository: latestRecord.repository,
    branch: latestRecord.branch,
    projectRoot: latestRecord.projectRoot,  // Add this line
    message: latestRecord.message,
    logs: allLogs,
    deployedResources: latestRecord.deployedResources,
    error: latestRecord.error,
    lastUpdated: new Date(latestRecord.timestamp).toISOString(),
  }),
};
```

### 2. Deployer Container (`deployer-container/index.ts`)

#### Change 2.1: Read PROJECT_ROOT Environment Variable
**Location**: Lines 31-34

**Current**:
```typescript
// Container-specific environment variables (passed as overrides)
const SESSION_ID = process.env.SESSION_ID!;
const REPOSITORY = process.env.REPOSITORY!;
const BRANCH = process.env.BRANCH!;
```

**Proposed**:
```typescript
// Container-specific environment variables (passed as overrides)
const SESSION_ID = process.env.SESSION_ID!;
const REPOSITORY = process.env.REPOSITORY!;
const BRANCH = process.env.BRANCH!;
const PROJECT_ROOT = process.env.PROJECT_ROOT || '';  // Add this line (default to empty)
```

#### Change 2.2: Update DeploymentLog Interface
**Location**: Lines 36-46

**Add field**:
```typescript
interface DeploymentLog {
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  repository: string;
  branch: string;
  projectRoot?: string;  // Add this field
  message?: string;
  logs?: string[];
  deployedResources?: Record<string, any>;
  error?: string;
}
```

#### Change 2.3: Update main() Function Logging
**Location**: Lines 48-56

**Current**:
```typescript
console.log(`Starting deployment for session ${SESSION_ID}`);
console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}`);

try {
  await updateDeploymentStatus(SESSION_ID, 'deploying', 'Cloning repository...', [
    'Starting deployment process',
    `Cloning ${REPOSITORY} (branch: ${BRANCH})`,
  ]);
```

**Proposed**:
```typescript
console.log(`Starting deployment for session ${SESSION_ID}`);
console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}${PROJECT_ROOT ? `, Project Root: ${PROJECT_ROOT}` : ''}`);

try {
  await updateDeploymentStatus(SESSION_ID, 'deploying', 'Cloning repository...', [
    'Starting deployment process',
    `Cloning ${REPOSITORY} (branch: ${BRANCH})${PROJECT_ROOT ? ` with project root: ${PROJECT_ROOT}` : ''}`,
  ]);
```

#### Change 2.4: Modify cloneRepository to Support projectRoot
**Location**: Lines 105-119

**Current**:
```typescript
async function cloneRepository(sessionId: string, repository: string, branch: string): Promise<string> {
  const tmpDir = `/tmp/${sessionId}`;

  // Clean up if exists
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const git = simpleGit();
  await git.clone(repository, tmpDir, ['--branch', branch, '--single-branch', '--depth', '1']);

  return tmpDir;
}
```

**Proposed**:
```typescript
async function cloneRepository(sessionId: string, repository: string, branch: string, projectRoot?: string): Promise<string> {
  const tmpDir = `/tmp/${sessionId}`;

  // Clean up if exists
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const git = simpleGit();
  await git.clone(repository, tmpDir, ['--branch', branch, '--single-branch', '--depth', '1']);

  // If projectRoot is specified, adjust the path
  if (projectRoot) {
    const projectPath = path.join(tmpDir, projectRoot);

    // Verify the project directory exists
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project root directory not found: ${projectRoot}`);
    }

    // Verify it's a directory
    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) {
      throw new Error(`Project root is not a directory: ${projectRoot}`);
    }

    return projectPath;
  }

  return tmpDir;
}
```

#### Change 2.5: Update cloneRepository Call in main()
**Location**: Line 59

**Current**:
```typescript
const repoPath = await cloneRepository(SESSION_ID, REPOSITORY, BRANCH);
```

**Proposed**:
```typescript
const repoPath = await cloneRepository(SESSION_ID, REPOSITORY, BRANCH, PROJECT_ROOT);
```

#### Change 2.6: Update Log Messages
**Location**: Line 61

**Current**:
```typescript
await addLog(SESSION_ID, 'Repository cloned successfully');
```

**Proposed**:
```typescript
await addLog(SESSION_ID, `Repository cloned successfully${PROJECT_ROOT ? ` (using project root: ${PROJECT_ROOT})` : ''}`);
```

#### Change 2.7: Update updateDeploymentStatus Function
**Location**: Lines 412-438

**Add projectRoot to record**:
```typescript
async function updateDeploymentStatus(
  sessionId: string,
  status: 'pending' | 'deploying' | 'success' | 'failed',
  message?: string,
  logs?: string[],
  deployedResources?: Record<string, any>,
  error?: string
): Promise<void> {
  const record: DeploymentLog = {
    sessionId,
    timestamp: Date.now(),
    status,
    repository: REPOSITORY,
    branch: BRANCH,
    projectRoot: PROJECT_ROOT || undefined,  // Add this line
    message,
    logs,
    deployedResources,
    error,
  };

  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: record,
    })
  );
}
```

#### Change 2.8: Update addLog Function
**Location**: Lines 440-456

**Add projectRoot to record**:
```typescript
async function addLog(sessionId: string, logMessage: string): Promise<void> {
  console.log(`[${sessionId}] ${logMessage}`);

  await docClient.send(
    new PutCommand({
      TableName: DEPLOYMENTS_TABLE,
      Item: {
        sessionId,
        timestamp: Date.now(),
        status: 'deploying',
        repository: REPOSITORY,
        branch: BRANCH,
        projectRoot: PROJECT_ROOT || undefined,  // Add this line
        logs: [logMessage],
      },
    })
  );
}
```

## Testing Plan

### Test Case 1: Root-level deployment (backward compatibility)
```bash
curl -X POST https://API_ENDPOINT/prod/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/username/simple-lambda-repo",
    "branch": "main"
  }'
```
**Expected**: Should work exactly as before (projectRoot is optional)

### Test Case 2: Subdirectory deployment
```bash
curl -X POST https://API_ENDPOINT/prod/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/username/monorepo",
    "branch": "main",
    "projectRoot": "functions/lambda-a"
  }'
```
**Expected**: Should clone repo, detect IaC in `functions/lambda-a/`, deploy from there

### Test Case 3: Nested subdirectory
```bash
curl -X POST https://API_ENDPOINT/prod/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/darwai/playground",
    "branch": "claude/github-lambda-deployer-api-011CUtEFz61F1BD8sF8yhbbS",
    "projectRoot": "examples/simple-lambda"
  }'
```
**Expected**: Should deploy the example Lambda from playground repo

### Test Case 4: Invalid path with ".."
```bash
curl -X POST https://API_ENDPOINT/prod/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/username/repo",
    "branch": "main",
    "projectRoot": "../etc/passwd"
  }'
```
**Expected**: Should return 400 error with validation message

### Test Case 5: Non-existent directory
```bash
curl -X POST https://API_ENDPOINT/prod/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "https://github.com/username/repo",
    "branch": "main",
    "projectRoot": "nonexistent/path"
  }'
```
**Expected**: Should fail with "Project root directory not found" error

## Security Considerations

### Path Traversal Prevention
1. **Reject absolute paths**: `path.isAbsolute()` check
2. **Reject parent directory references**: Block `..` in path
3. **Sanitize slashes**: Remove leading/trailing slashes
4. **Validate characters**: Only allow alphanumeric, dash, underscore, slash
5. **Verify existence**: Check directory exists after clone
6. **Verify type**: Ensure it's a directory, not a file

### Additional Safety Measures
- Path is always joined with `path.join()` to prevent injection
- All filesystem operations happen within `/tmp/{sessionId}/`
- ECS task has read-only access to cloned repository
- No shell execution with user-provided paths

## Example: Deploying from Playground Repo

Your playground repo structure:
```
playground/
├── examples/
│   ├── simple-lambda/
│   │   ├── index.js
│   │   └── package.json
│   └── cloudformation-lambda/
│       ├── template.yaml
│       └── index.js
├── cdk/
├── lambdas/
└── deployer-container/
```

To deploy the `simple-lambda` example:
```json
{
  "repository": "https://github.com/your-username/playground",
  "branch": "claude/github-lambda-deployer-api-011CUtEFz61F1BD8sF8yhbbS",
  "projectRoot": "examples/simple-lambda"
}
```

The deployer will:
1. Clone the playground repo
2. Navigate to `examples/simple-lambda/`
3. Detect IaC type (simple-lambda)
4. Deploy the Lambda function from that subdirectory

## Summary of Changes

| File | Lines Changed | Description |
|------|---------------|-------------|
| `lambdas/api-handler/index.ts` | ~50 lines | Add projectRoot field, validation, pass to ECS |
| `deployer-container/index.ts` | ~30 lines | Read PROJECT_ROOT, adjust repoPath, validate |
| **Total** | **~80 lines** | Minimal changes, maintains backward compatibility |

## Benefits

1. ✅ **Monorepo support**: Deploy multiple functions from one repo
2. ✅ **Flexible organization**: Any directory structure supported
3. ✅ **Backward compatible**: Existing API calls work unchanged
4. ✅ **Secure**: Path traversal protection built-in
5. ✅ **Clear errors**: Validation at API layer and deployment layer
6. ✅ **Full logging**: projectRoot included in all logs and status

## Next Steps

1. Implement changes in API handler
2. Implement changes in deployer container
3. Test with playground examples
4. Update API documentation
5. Add projectRoot to project-overview.md
