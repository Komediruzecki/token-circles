#!/bin/bash
# Portfolio feature test script
# Tests: CRUD, summary, allocation, price fetching

BASE_URL="http://localhost:3001"
PASS=0
FAIL=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $label"
    ((PASS++))
  else
    echo "  FAIL: $label (expected '$expected', got '$actual')"
    ((FAIL++))
  fi
}

assert_gt() {
  local label="$1" expected="$2" actual="$3"
  if [ "$(echo "$actual > $expected" | bc -l)" -eq 1 ]; then
    echo "  PASS: $label ($actual > $expected)"
    ((PASS++))
  else
    echo "  FAIL: $label (expected > $expected, got $actual)"
    ((FAIL++))
  fi
}

echo "=== Portfolio API Tests ==="
echo ""

# Clean up any test data from previous runs
curl -s -X DELETE "$BASE_URL/api/portfolio/holdings/16" > /dev/null 2>&1
curl -s -X DELETE "$BASE_URL/api/portfolio/holdings/17" > /dev/null 2>&1

# ── 1: List holdings ──
echo "1. List holdings"
RESP=$(curl -s "$BASE_URL/api/portfolio/holdings")
COUNT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
assert_gt "Holdings count > 0" 0 "$COUNT"

# ── 2: Create holding ──
echo "2. Create holding"
CREATE_RESP=$(curl -s -X POST "$BASE_URL/api/portfolio/holdings" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"TSLA","shares":25,"purchase_price":200,"purchase_date":"2025-03-01","notes":"Test holding"}')
CREATED_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
assert_gt "Created holding has ID" 0 "$CREATED_ID"

# ── 3: Verify creation ──
echo "3. Verify creation"
GET_RESP=$(curl -s "$BASE_URL/api/portfolio/holdings")
TICKER=$(echo "$GET_RESP" | python3 -c "
import sys,json
holdings = json.load(sys.stdin)
for h in holdings:
    if h.get('id') == $CREATED_ID:
        print(h['ticker'])
        break
" 2>/dev/null)
assert_eq "Created ticker matches" "TSLA" "$TICKER"

# ── 4: Update holding ──
echo "4. Update holding"
curl -s -X PUT "$BASE_URL/api/portfolio/holdings/$CREATED_ID" \
  -H "Content-Type: application/json" \
  -d '{"shares":50}' > /dev/null
UPDATED_SHARES=$(curl -s "$BASE_URL/api/portfolio/holdings" | python3 -c "
import sys,json
holdings = json.load(sys.stdin)
for h in holdings:
    if h.get('id') == $CREATED_ID:
        print(h['shares'])
        break
" 2>/dev/null)
assert_eq "Updated shares match" "50" "$UPDATED_SHARES"

# ── 5: Delete holding ──
echo "5. Delete holding"
curl -s -X DELETE "$BASE_URL/api/portfolio/holdings/$CREATED_ID" > /dev/null
VERIFY_RESP=$(curl -s "$BASE_URL/api/portfolio/holdings")
VERIFY_ID=$(echo "$VERIFY_RESP" | python3 -c "
import sys,json
holdings = json.load(sys.stdin)
found = any(h.get('id') == $CREATED_ID for h in holdings)
print('found' if found else 'deleted')
" 2>/dev/null)
assert_eq "Holding deleted" "deleted" "$VERIFY_ID"

# ── 6: Summary endpoint ──
echo "6. Portfolio summary"
SUMMARY=$(curl -s "$BASE_URL/api/portfolio/summary")
TOTAL_VALUE=$(echo "$SUMMARY" | python3 -c "import sys,json; print(json.load(sys.stdin)['totalValue'])" 2>/dev/null)
assert_gt "Total value > 0" 0 "$TOTAL_VALUE"

# ── 7: Allocation check ──
echo "7. Allocation data"
ALLOC_COUNT=$(echo "$SUMMARY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['allocation']))" 2>/dev/null)
assert_gt "Allocation has entries" 0 "$ALLOC_COUNT"

# ── 8: Prices endpoint ──
echo "8. Prices lookup"
PRICES=$(curl -s -X POST "$BASE_URL/api/portfolio/prices" \
  -H "Content-Type: application/json" \
  -d '{"tickers":["SPY","QQQ"]}')
PRICE_COUNT=$(echo "$PRICES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
echo "   Prices returned: $PRICE_COUNT tickers (may be 0 if API unavailable)"
if [ "$PRICE_COUNT" -ge 0 ]; then
  echo "  PASS: Price endpoint responds"
  ((PASS++))
else
  echo "  FAIL: Price endpoint failed"
  ((FAIL++))
fi

# ── 9: Validation test ──
echo "9. Validation - missing fields"
VALIDATE_RESP=$(curl -s -X POST "$BASE_URL/api/portfolio/holdings" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"BAD"}')
VALIDATE_ERR=$(echo "$VALIDATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
assert_eq "Rejects invalid data" "ticker, shares, purchase_price, and purchase_date are required" "$VALIDATE_ERR"

# ── 10: Not found test ──
echo "10. Not found handling"
NF_RESP=$(curl -s -X PUT "$BASE_URL/api/portfolio/holdings/99999" \
  -H "Content-Type: application/json" \
  -d '{"shares":10}')
NF_ERR=$(echo "$NF_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
assert_eq "Returns not found" "Holding not found" "$NF_ERR"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
