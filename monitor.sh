#!/bin/bash

SESSION_ID="$1"
API="https://424n5iwvji.execute-api.us-east-1.amazonaws.com/prod"

if [ -z "$SESSION_ID" ]; then
  echo "Usage: $0 <session-id>"
  exit 1
fi

echo "Monitoring: $SESSION_ID"
echo "========================================"

for i in {1..30}; do
  STATUS=$(curl -s "$API/status/$SESSION_ID")

  CURRENT_STATUS=$(echo "$STATUS" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  MESSAGE=$(echo "$STATUS" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)

  echo "[$CURRENT_STATUS] $MESSAGE"

  if [ "$CURRENT_STATUS" = "success" ] || [ "$CURRENT_STATUS" = "failed" ]; then
    echo ""
    echo "COMPLETE: $CURRENT_STATUS"
    break
  fi

  sleep 10
done
