#!/bin/bash
# Test: Verify account balance auto-update from transactions
# Uses local test backend on port 3848

BASE="http://localhost:3848"
COOKIE_JAR=$(mktemp)
PASS=0
FAIL=0

cleanup() { rm -f "$COOKIE_JAR"; fuser -k 3848/tcp 2>/dev/null || true; }
trap cleanup EXIT

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $label = $actual"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $label expected=$expected got=$actual"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Account Balance Verification Test ==="

# 1. Start test backend
echo ""
echo "--- Starting test backend ---"
fuser -k 3848/tcp 2>/dev/null || true
cd /tmp/finance-manager && PORT=3848 node backend/index.js &
sleep 3

# 2. Login
echo ""
echo "--- Login ---"
curl -s -c "$COOKIE_JAR" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"maff","password":"add2"}' > /dev/null

# 3. Create a test account
echo "--- Create account 'TestBank' ---"
ACCT_RESULT=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/accounts" \
  -H "Content-Type: application/json" \
  -d '{"name":"TestBank","type":"giro","currency":"USD","balance":1000,"starting_balance":1000,"starting_date":"2024-04-01"}')
echo "  Created: $ACCT_RESULT"

# 4. Get the account ID
ACCT_ID=$(curl -s -b "$COOKIE_JAR" "$BASE/api/accounts" | python3 -c "
import sys,json
for a in json.load(sys.stdin):
    if a['name'] == 'TestBank':
        print(a['id'])
        break
")
echo "  TestBank ID: $ACCT_ID"

# 5. Create transactions
echo "--- Create income +500 ---"
curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/transactions" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Salary\",\"amount\":500,\"date\":\"2024-05-01\",\"type\":\"income\",\"account_id\":$ACCT_ID}" > /dev/null

echo "--- Create expense -200 ---"
curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/transactions" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Rent\",\"amount\":200,\"date\":\"2024-05-15\",\"type\":\"expense\",\"account_id\":$ACCT_ID}" > /dev/null

echo "--- Create expense -50 ---"
curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/transactions" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Groceries\",\"amount\":50,\"date\":\"2024-06-01\",\"type\":\"expense\",\"account_id\":$ACCT_ID}" > /dev/null

# 6. Check balance: 1000 + 500 - 200 - 50 = 1250
echo ""
echo "--- Checking balance (expected: 1000+500-200-50=1250) ---"
BALANCE=$(curl -s -b "$COOKIE_JAR" "$BASE/api/accounts" | python3 -c "
import sys,json
for a in json.load(sys.stdin):
    if a['id'] == $ACCT_ID:
        print(int(a['balance']))
        break
")
check "Balance after 3 txs" "1250" "$BALANCE"

# 7. Update expense from 200 to 300
echo ""
echo "--- Update expense: 200 -> 300 ---"
TX_ID=$(curl -s -b "$COOKIE_JAR" "$BASE/api/transactions" | python3 -c "
import sys,json
for t in json.load(sys.stdin):
    if t.get('account_id') == $ACCT_ID and t.get('amount') == 200:
        print(t['id'])
        break
")
curl -s -b "$COOKIE_JAR" -X PUT "$BASE/api/transactions/$TX_ID" \
  -H "Content-Type: application/json" \
  -d '{"amount":300}' > /dev/null

BALANCE=$(curl -s -b "$COOKIE_JAR" "$BASE/api/accounts" | python3 -c "
import sys,json
for a in json.load(sys.stdin):
    if a['id'] == $ACCT_ID:
        print(int(a['balance']))
        break
")
check "Balance after update (1000+500-300-50=1150)" "1150" "$BALANCE"

# 8. Delete income transaction
echo ""
echo "--- Delete income +500 ---"
TX_ID=$(curl -s -b "$COOKIE_JAR" "$BASE/api/transactions" | python3 -c "
import sys,json
for t in json.load(sys.stdin):
    if t.get('account_id') == $ACCT_ID and t.get('type') == 'income':
        print(t['id'])
        break
")
curl -s -b "$COOKIE_JAR" -X DELETE "$BASE/api/transactions/$TX_ID" > /dev/null

BALANCE=$(curl -s -b "$COOKIE_JAR" "$BASE/api/accounts" | python3 -c "
import sys,json
for a in json.load(sys.stdin):
    if a['id'] == $ACCT_ID:
        print(int(a['balance']))
        break
")
check "Balance after delete income (1000-300-50=650)" "650" "$BALANCE"

# 9. Cleanup
echo ""
echo "--- Cleanup ---"
curl -s -b "$COOKIE_JAR" "$BASE/api/transactions" | python3 -c "
import sys,json
for t in json.load(sys.stdin):
    if t.get('account_id') == $ACCT_ID:
        print(t['id'])
" 2>/dev/null | while read tid; do
  curl -s -b "$COOKIE_JAR" -X DELETE "$BASE/api/transactions/$tid" > /dev/null 2>&1
done
curl -s -b "$COOKIE_JAR" -X DELETE "$BASE/api/accounts/$ACCT_ID" > /dev/null 2>&1

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $FAIL
