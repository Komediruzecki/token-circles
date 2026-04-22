#!/bin/bash
cd /tmp/finance-manager/frontend
timeout 300 npx playwright test --reporter=line 2>&1 > /tmp/test-output.txt
EXIT_CODE=$?
echo "Exit code: $EXIT_CODE"
grep -E "^✓|^✘|^passed|^failed" /tmp/test-output.txt | tail -50
exit $EXIT_CODE