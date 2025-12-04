#!/bin/bash

echo "🔍 TARASA PROJECT DIAGNOSTIC TOOL"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if server is running
if ! curl -s http://localhost:4000/api/health > /dev/null; then
    echo -e "${RED}❌ SERVER NOT RUNNING${NC}"
    echo "Start the server first: npm start"
    exit 1
fi

echo -e "${GREEN}✅ Server is running${NC}"
echo ""

# Get data
POSTS=$(curl -s http://localhost:4000/api/posts)
MESSAGES=$(curl -s http://localhost:4000/api/messages)
LOGS=$(curl -s http://localhost:4000/api/logs)

# Analysis
echo "📊 DATA ANALYSIS"
echo "================"

TOTAL_POSTS=$(echo $POSTS | jq 'length')
MISSING_LINKS=$(echo $POSTS | jq '[.[] | select(.authorLink == null)] | length')
MISSING_NAMES=$(echo $POSTS | jq '[.[] | select(.authorName == "")] | length')
FAKE_IDS=$(echo $POSTS | jq '[.[] | select(.fbPostId | startswith("generated_"))] | length')
TRUNCATED=$(echo $POSTS | jq '[.[] | select(.text | endswith("عرض المزيد"))] | length')

echo "Total Posts: $TOTAL_POSTS"
echo ""

# Critical Issues
echo -e "${RED}🔴 CRITICAL ISSUES${NC}"
echo "==================="
if [ "$MISSING_LINKS" -gt 0 ]; then
    echo -e "${RED}❌ Missing Author Links: $MISSING_LINKS / $TOTAL_POSTS${NC}"
else
    echo -e "${GREEN}✅ All posts have author links${NC}"
fi

if [ "$MISSING_NAMES" -gt 0 ]; then
    echo -e "${RED}❌ Missing Author Names: $MISSING_NAMES / $TOTAL_POSTS${NC}"
else
    echo -e "${GREEN}✅ All posts have author names${NC}"
fi

SENT=$(echo $MESSAGES | jq '.stats.sentLast24h')
if [ "$SENT" -eq 0 ]; then
    echo -e "${RED}❌ Messages Sent (24h): 0${NC}"
else
    echo -e "${GREEN}✅ Messages Sent (24h): $SENT${NC}"
fi

echo ""

# High Priority
echo -e "${YELLOW}🟠 HIGH PRIORITY ISSUES${NC}"
echo "======================="
if [ "$FAKE_IDS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Fake Post IDs: $FAKE_IDS / $TOTAL_POSTS${NC}"
else
    echo -e "${GREEN}✅ All posts have real Facebook IDs${NC}"
fi

if [ "$TRUNCATED" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Truncated Posts: $TRUNCATED / $TOTAL_POSTS${NC}"
else
    echo -e "${GREEN}✅ All posts have full text${NC}"
fi

SKIPPED=$(echo $LOGS | jq '[.[] | select(.message | contains("Skipped message"))] | length')
echo -e "${YELLOW}⚠️  Skipped Messages (logs): $SKIPPED${NC}"

echo ""

# Messages
echo "💬 MESSAGES STATUS"
echo "=================="
QUEUED=$(echo $MESSAGES | jq '.stats.queue')
SENT_TOTAL=$(echo $MESSAGES | jq '.sent | length')
echo "Queued: $QUEUED"
echo "Sent (all time): $SENT_TOTAL"
echo "Sent (24h): $SENT"

echo ""

# Classification
echo "🎯 CLASSIFICATION"
echo "================="
CLASSIFIED=$(echo $POSTS | jq '[.[] | select(.classified != null)] | length')
HISTORIC=$(echo $POSTS | jq '[.[] | select(.classified.isHistoric == true)] | length')
echo "Classified Posts: $CLASSIFIED / $TOTAL_POSTS"
echo "Historic Posts: $HISTORIC"

echo ""

# Auth Test
echo "🔐 AUTHENTICATION"
echo "================="
AUTH_TEST=$(curl -s -X POST http://localhost:4000/api/trigger-scrape)
if echo $AUTH_TEST | jq -e '.error == "Unauthorized"' > /dev/null; then
    echo -e "${YELLOW}⚠️  API triggers require authentication${NC}"
    echo "   Use: curl -H 'x-api-key: YOUR_KEY' ..."
else
    echo -e "${GREEN}✅ Triggers accessible${NC}"
fi

echo ""

# Recent Activity
echo "📝 RECENT ACTIVITY (Last 5 logs)"
echo "================================"
echo $LOGS | jq -r '.[0:5] | .[] | "\(.type | ascii_upcase): \(.message)"'

echo ""
echo ""

# Summary Score
TOTAL_CHECKS=7
PASSED=0

[ "$MISSING_LINKS" -eq 0 ] && ((PASSED++))
[ "$MISSING_NAMES" -eq 0 ] && ((PASSED++))
[ "$SENT" -gt 0 ] && ((PASSED++))
[ "$FAKE_IDS" -eq 0 ] && ((PASSED++))
[ "$TRUNCATED" -eq 0 ] && ((PASSED++))
[ "$CLASSIFIED" -eq "$TOTAL_POSTS" ] && ((PASSED++))
[ "$QUEUED" -gt 0 ] && ((PASSED++))

PERCENTAGE=$((PASSED * 100 / TOTAL_CHECKS))

echo "🎯 HEALTH SCORE: $PASSED/$TOTAL_CHECKS ($PERCENTAGE%)"
echo "================================"

if [ $PERCENTAGE -lt 30 ]; then
    echo -e "${RED}❌ CRITICAL: Multiple major issues need immediate attention${NC}"
elif [ $PERCENTAGE -lt 70 ]; then
    echo -e "${YELLOW}⚠️  WARNING: Several issues need to be fixed${NC}"
else
    echo -e "${GREEN}✅ GOOD: System is mostly functional${NC}"
fi

echo ""
echo "💡 Next Steps:"
echo "1. Fix missing author links in scraper"
echo "2. Fix missing author names"
echo "3. Extract real Facebook post IDs"
echo "4. Get full post text (not truncated)"
echo "5. Enable message sending"

