import re

with open('.github/workflows/ci.yml', 'r') as f:
    content = f.read()

content = content.replace('cache: \'npm\'', 'cache: \'pnpm\'')
content = content.replace('run: npm ci --prefer-offline', 'run: pnpm install --frozen-lockfile')
content = content.replace('run: npm ci', 'run: pnpm install --frozen-lockfile')
content = content.replace('run: npm rebuild better-sqlite3 --build-from-source', 'run: pnpm rebuild better-sqlite3')
content = content.replace('npm run test:backend', 'pnpm run test:backend')
content = content.replace('npm test', 'pnpm run test')
content = content.replace('npm run lint', 'pnpm run lint')

# Insert pnpm setup before Node.js setup
setup_pnpm = """      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

"""
content = content.replace('      - name: Setup Node.js', setup_pnpm + '      - name: Setup Node.js')

with open('.github/workflows/ci.yml', 'w') as f:
    f.write(content)
