#!/bin/bash

# SDLC Deployment Monitor Script
# Usage: ./monitor-sdlc.sh <repository-url> <branch> [custom-root-folder]

API_ENDPOINT="https://424n5iwvji.execute-api.us-east-1.amazonaws.com/prod"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check arguments
if [ -z "$1" ] || [ -z "$2" ]; then
  echo -e "${RED}Usage: $0 <repository-url> <branch> [custom-root-folder]${NC}"
  echo "Example: $0 https://github.com/user/repo main"
  exit 1
fi

REPOSITORY="$1"
BRANCH="$2"
CUSTOM_ROOT_FOLDER="${3:-}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}SDLC Deployment Monitor${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Repository: ${GREEN}$REPOSITORY${NC}"
echo -e "Branch: ${GREEN}$BRANCH${NC}"
if [ -n "$CUSTOM_ROOT_FOLDER" ]; then
  echo -e "Custom Root: ${GREEN}$CUSTOM_ROOT_FOLDER${NC}"
fi
echo -e "${BLUE}========================================${NC}\n"

# Build request body
if [ -n "$CUSTOM_ROOT_FOLDER" ]; then
  REQUEST_BODY=$(cat <<EOF
{
  "repository": "$REPOSITORY",
  "branch": "$BRANCH",
  "customRootFolder": "$CUSTOM_ROOT_FOLDER"
}
EOF
)
else
  REQUEST_BODY=$(cat <<EOF
{
  "repository": "$REPOSITORY",
  "branch": "$BRANCH"
}
EOF
)
fi

# Start SDLC deployment
echo -e "${YELLOW}Starting SDLC deployment...${NC}"
RESPONSE=$(curl -s -X POST "$API_ENDPOINT/sdlc-deploy" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY")

# Check if deployment started successfully
if [ $? -ne 0 ]; then
  echo -e "${RED}Failed to start deployment${NC}"
  exit 1
fi

SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | sed 's/"sessionId":"\([^"]*\)"/\1/')

if [ -z "$SESSION_ID" ]; then
  echo -e "${RED}Failed to get session ID${NC}"
  echo "Response: $RESPONSE"
  exit 1
fi

echo -e "${GREEN}Deployment started!${NC}"
echo -e "Session ID: ${GREEN}$SESSION_ID${NC}\n"

# Track last log count to only show new logs
LAST_LOG_COUNT=0

# Poll for status
while true; do
  STATUS_RESPONSE=$(curl -s "$API_ENDPOINT/status/$SESSION_ID")

  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to get status${NC}"
    sleep 5
    continue
  fi

  # Extract status
  CURRENT_STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"\([^"]*\)"/\1/')
  MESSAGE=$(echo "$STATUS_RESPONSE" | grep -o '"message":"[^"]*"' | head -1 | sed 's/"message":"\([^"]*\)"/\1/')

  # Display status
  case $CURRENT_STATUS in
    "pending")
      echo -e "${YELLOW}[PENDING]${NC} $MESSAGE"
      ;;
    "deploying")
      echo -e "${BLUE}[IN PROGRESS]${NC} $MESSAGE"
      ;;
    "success")
      echo -e "${GREEN}[SUCCESS]${NC} $MESSAGE"
      ;;
    "failed")
      echo -e "${RED}[FAILED]${NC} $MESSAGE"
      ;;
  esac

  # Extract and display new logs
  LOGS=$(echo "$STATUS_RESPONSE" | grep -o '"logs":\[[^]]*\]' | sed 's/"logs":\[\(.*\)\]/\1/')

  if [ -n "$LOGS" ]; then
    # Count logs (count commas + 1, but handle empty array)
    if [ "$LOGS" = "" ]; then
      LOG_COUNT=0
    else
      LOG_COUNT=$(($(echo "$LOGS" | grep -o ',' | wc -l) + 1))
    fi

    # Show only new logs
    if [ $LOG_COUNT -gt $LAST_LOG_COUNT ]; then
      # Extract new log entries
      NEW_LOGS=$(echo "$LOGS" | sed 's/","/\n/g' | sed 's/^"//;s/"$//' | tail -n $((LOG_COUNT - LAST_LOG_COUNT)))
      echo "$NEW_LOGS" | while IFS= read -r line; do
        echo -e "  ${BLUE}→${NC} $line"
      done
      LAST_LOG_COUNT=$LOG_COUNT
    fi
  fi

  # Check if deployment is complete
  if [[ "$CURRENT_STATUS" == "success" ]] || [[ "$CURRENT_STATUS" == "failed" ]]; then
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}Deployment Complete${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo -e "Final Status: ${GREEN}$CURRENT_STATUS${NC}"

    # Show deployed resources if successful
    if [[ "$CURRENT_STATUS" == "success" ]]; then
      DEPLOYED_RESOURCES=$(echo "$STATUS_RESPONSE" | grep -o '"deployedResources":{[^}]*}')
      if [ -n "$DEPLOYED_RESOURCES" ]; then
        echo -e "\n${GREEN}Deployed Resources:${NC}"
        echo "$STATUS_RESPONSE" | grep -o '"deployedResources":{[^}]*}' | sed 's/^"deployedResources"://' | sed 's/,/\n/g' | sed 's/[{}"]//g' | while IFS= read -r line; do
          echo -e "  ${GREEN}•${NC} $line"
        done
      fi

      # Show test results if available
      echo -e "\n${GREEN}View full details:${NC}"
      echo -e "  curl $API_ENDPOINT/status/$SESSION_ID | jq '.'"
    else
      # Show error if failed
      ERROR=$(echo "$STATUS_RESPONSE" | grep -o '"error":"[^"]*"' | sed 's/"error":"\([^"]*\)"/\1/')
      if [ -n "$ERROR" ]; then
        echo -e "\n${RED}Error: $ERROR${NC}"
      fi
    fi

    break
  fi

  # Wait before next poll
  sleep 5
done
