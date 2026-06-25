const { execSync } = require('child_process');
execSync(
  'NODE_ENV=test node index.js > /dev/null 2>&1 & sleep 2 && npx jest ../test/e2e/backend-api/transactions.spec.js',
  { stdio: 'inherit' }
);
