#!/usr/bin/env node
/**
 * Replace try/catch boilerplate with asyncHandler wrapper in route files.
 *
 * Transform:
 *   router.verb('path', middleware..., (req, res) => {
 *     try {
 *       ...body (indented relative to try)...
 *     } catch (err) {
 *       console.error(err.message);
 *       logError('error', ...);
 *       res.status(500).json({ error: err.message... });
 *     }
 *   });
 *
 * To:
 *   router.verb('path', middleware..., asyncHandler((req, res) => {
 *     ...body (same indent as try was)...
 *   }));
 */

const fs = require('fs');
const path = require('path');

const routesDir = process.argv[2];
if (!routesDir) {
  console.error('Usage: node remove-try-catch.js <routes-dir>');
  process.exit(1);
}

const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && f !== 'appInfo.js');

// Pre-built full regex patterns for each catch variant.
// Group 1: indent, Group 2: body
const tryCatchPatterns = [
  // Standard: console.error + logError + res.status(500)
  /\n( +)try \{\n((?:.*\n)*?)\1\} catch \(err\) \{\n\1  console\.error\(err\.message\);\n\1  logError\([^)]+\);\n\1  res\.status\(500\)\.json\(\{ error: err\.message[^}]*\}\);\n\1\}/g,
  // No logError
  /\n( +)try \{\n((?:.*\n)*?)\1\} catch \(err\) \{\n\1  console\.error\(err\.message\);\n\1  res\.status\(500\)\.json\(\{ error: err\.message[^}]*\}\);\n\1\}/g,
  // Just res.status
  /\n( +)try \{\n((?:.*\n)*?)\1\} catch \(err\) \{\n\1  res\.status\(500\)\.json\(\{ error: err\.message[^}]*\}\);\n\1\}/g,
];

for (const file of files) {
  const filePath = path.join(routesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const orig = content;

  let replaced = 0;

  for (const re of tryCatchPatterns) {
    content = content.replace(re, (match, indent, body) => {
      replaced++;
      // Body was at indent+2, make it indent level (remove 2 spaces)
      const lines = body.split('\n');
      const fixed = lines.map(line => {
        if (line === '') return '';
        if (line.startsWith(indent + '  ')) return indent + line.slice(indent.length + 2);
        return line;
      }).join('\n');
      return '\n' + fixed;
    });
  }

  // Count remaining try blocks
  const afterCount = (content.match(/\btry \{/g) || []).length;

  if (replaced > 0) {
    // Add asyncHandler import if not already present
    if (!content.includes("require('../lib/errors')") && !content.includes('require("./lib/errors")')) {
      const requireLine = "const { asyncHandler } = require('../lib/errors');";
      const lines = content.split('\n');
      let insertIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('const ') && lines[i].includes('require(')) {
          insertIdx = i + 1;
        }
      }
      lines.splice(insertIdx, 0, requireLine);
      content = lines.join('\n');
    }

    // Wrap handler callbacks with asyncHandler
    // Match: , (req, res) => {  or  , (req, res, next) => {
    // But NOT if already asyncHandler(
    content = content.replace(
      /, (\(req, res(?:, next)?\))\s*=>\s*\{(?!\s*\n\s*asyncHandler)/g,
      (match, params) => {
        return `, asyncHandler(${params} => {`;
      }
    );

    fs.writeFileSync(filePath, content, 'utf8');
    const beforeCount = (orig.match(/\btry \{/g) || []).length;
    console.log(`✓ ${file}: ${beforeCount}→${afterCount} try blocks (${replaced} removed)`);
  } else {
    console.log(`  ${file}: no standard catch blocks`);
  }
}

console.log('\nDone. Run tests to verify.');
