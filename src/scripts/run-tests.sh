#!/bin/bash
#
# Quick API Test Runner for Tarasa Backend
#
# Usage:
#   ./src/scripts/run-tests.sh                    # Basic tests (no API key)
#   API_KEY=your-key ./src/scripts/run-tests.sh   # Full tests with triggers
#
# Prerequisites:
#   - Server running on localhost:4000 (npm run dev)
#   - jq installed (optional, for pretty output)
#

API_BASE="${API_BASE:-http://localhost:4000}"
PASS=0
FAIL=0
RESULTS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "=============================================="
echo "   Tarasa Backend API Test Runner"
echo "=============================================="
echo "API Base: $API_BASE"
echo "API Key:  ${API_KEY:+[SET]}${API_KEY:-[NOT SET]}"
echo "=============================================="
echo ""

# Helper function to run a test
run_test() {
  local name="$1"
  local method="$2"
  local endpoint="$3"
  local expected_field="$4"
  local needs_auth="$5"

  # Build curl command
  local curl_opts="-s -w '\n%{http_code}'"
  local headers=""

  if [[ "$needs_auth" == "true" && -n "$API_KEY" ]]; then
    headers="-H 'X-API-Key: $API_KEY'"
  fi

  # Execute request
  if [[ "$method" == "POST" ]]; then
    response=$(eval "curl $curl_opts $headers -X POST '$API_BASE$endpoint'")
  else
    response=$(eval "curl $curl_opts $headers '$API_BASE$endpoint'")
  fi

  # Extract status code (last line) and body (everything else)
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  # Check result
  local status="FAIL"
  local details=""

  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    if [[ -n "$expected_field" ]]; then
      if echo "$body" | grep -q "$expected_field"; then
        status="PASS"
        # Extract some useful info
        if [[ "$endpoint" == "/api/health" ]]; then
          details=$(echo "$body" | grep -o '"status":"[^"]*"' | head -1)
        elif [[ "$endpoint" == "/api/posts" ]]; then
          count=$(echo "$body" | grep -o '"total":[0-9]*' | head -1 | grep -o '[0-9]*')
          details="total=$count"
        elif [[ "$endpoint" == "/api/messages" ]]; then
          queue=$(echo "$body" | grep -o '"queue":[0-9]*' | head -1 | grep -o '[0-9]*')
          sent=$(echo "$body" | grep -o '"sentLast24h":[0-9]*' | head -1 | grep -o '[0-9]*')
          details="queue=$queue, sent24h=$sent"
        elif [[ "$endpoint" == "/api/logs"* ]]; then
          total=$(echo "$body" | grep -o '"total":[0-9]*' | head -1 | grep -o '[0-9]*')
          details="total=$total"
        fi
      else
        details="missing expected field: $expected_field"
      fi
    else
      status="PASS"
    fi
  elif [[ "$http_code" == "401" && "$needs_auth" == "true" && -z "$API_KEY" ]]; then
    status="SKIP"
    details="requires API_KEY"
  else
    details="HTTP $http_code"
  fi

  # Record result
  if [[ "$status" == "PASS" ]]; then
    ((PASS++))
    echo -e "${GREEN}PASS${NC} - $name ${details:+-> $details}"
  elif [[ "$status" == "SKIP" ]]; then
    echo -e "${YELLOW}SKIP${NC} - $name -> $details"
  else
    ((FAIL++))
    echo -e "${RED}FAIL${NC} - $name -> $details"
  fi

  RESULTS+=("$status|$name|$details")
}

# Helper to check specific conditions
check_condition() {
  local name="$1"
  local condition="$2"
  local details="$3"

  if eval "$condition"; then
    ((PASS++))
    echo -e "${GREEN}PASS${NC} - $name ${details:+-> $details}"
    RESULTS+=("PASS|$name|$details")
  else
    ((FAIL++))
    echo -e "${RED}FAIL${NC} - $name -> $details"
    RESULTS+=("FAIL|$name|$details")
  fi
}

echo -e "${BLUE}=== Core Endpoints ===${NC}"
echo ""

# 1. Health check
run_test "Health Check" "GET" "/api/health" '"status":"ok"' "false"

# 2. Posts endpoint
run_test "Posts Endpoint" "GET" "/api/posts" '"data":' "false"

# 3. Messages endpoint
run_test "Messages Endpoint" "GET" "/api/messages" '"queue":' "false"

# 4. Logs endpoint
run_test "Logs Endpoint" "GET" "/api/logs?limit=5" '"data":' "false"

# 5. Settings endpoint
run_test "Settings Endpoint" "GET" "/api/settings" '"groups":' "false"

# 6. Stats endpoint
run_test "Stats Endpoint" "GET" "/api/stats" '"postsTotal":' "false"

# 7. Session status
run_test "Session Status" "GET" "/api/session/status" '"sessionHealth":' "false"

# 8. Session groups
run_test "Session Groups" "GET" "/api/session/groups" '"groups":' "false"

echo ""
echo -e "${BLUE}=== Trigger Endpoints (require API_KEY) ===${NC}"
echo ""

# Trigger endpoints (require auth)
run_test "Trigger Scrape" "POST" "/api/trigger-scrape" "" "true"
run_test "Trigger Classification" "POST" "/api/trigger-classification" "" "true"
run_test "Trigger Message" "POST" "/api/trigger-message" "" "true"
run_test "Session Validate" "POST" "/api/session/validate" "" "true"

echo ""
echo -e "${BLUE}=== Health Checks ===${NC}"
echo ""

# Detailed health checks
health_response=$(curl -s "$API_BASE/api/health")

# Check database
db_ok=$(echo "$health_response" | grep -o '"database":true')
check_condition "Database Connection" "[[ -n '$db_ok' ]]" "connected"

# Check Facebook session
fb_ok=$(echo "$health_response" | grep -o '"facebookSession":true')
check_condition "Facebook Session" "[[ -n '$fb_ok' ]]" "valid"

# Check OpenAI key
openai_ok=$(echo "$health_response" | grep -o '"openaiKey":true')
check_condition "OpenAI API Key" "[[ -n '$openai_ok' ]]" "configured"

# Check Apify token
apify_ok=$(echo "$health_response" | grep -o '"apifyToken":true')
check_condition "Apify Token" "[[ -n '$apify_ok' ]]" "configured"

echo ""
echo -e "${BLUE}=== Log Spam Check ===${NC}"
echo ""

# Check for log spam (should not have "Skipping generation" messages in last hour)
logs_response=$(curl -s "$API_BASE/api/logs?limit=50&type=message")
spam_count=$(echo "$logs_response" | grep -o '"Skipping generation for post' | wc -l | tr -d ' ')

if [[ "$spam_count" -eq 0 ]]; then
  ((PASS++))
  echo -e "${GREEN}PASS${NC} - No log spam detected"
  RESULTS+=("PASS|Log Spam Check|none detected")
else
  # Check if these are from the last hour
  echo -e "${YELLOW}WARN${NC} - Found $spam_count 'Skipping generation' log entries (may need server restart)"
  RESULTS+=("WARN|Log Spam Check|$spam_count entries found")
fi

# Summary
echo ""
echo "=============================================="
echo "                  SUMMARY"
echo "=============================================="
echo -e "Passed: ${GREEN}$PASS${NC}"
echo -e "Failed: ${RED}$FAIL${NC}"
echo "=============================================="

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo -e "${RED}Some tests failed. Check the output above for details.${NC}"
  exit 1
else
  echo ""
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
