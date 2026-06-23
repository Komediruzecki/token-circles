#!/usr/bin/env node
/**
 * Second pass: handle remaining try/catch patterns that use
 * logError('error', 'source', err, req) signature.
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : fs.readdirSync('routes').filter(f => f.endsWith('.js')).map(f => 'routes/' + f);

// Pattern: console.error + logError('error', 'sourcename', err, req) + res.status(500)
const patternWithSourceReq = /\n( +)try \{\n((?:.*\n)*?)\1\} catch \(err\) \{\n\1  console\.error\(err\.message\);\n\1  logError\('error',\s*'[^']+',\s*err,\s*req\);\n\1  res\.status\(500\)\.json\(\{ error: err\.message[^}]*\}\);\n\1\}/g;

// Same but with custom error string (not err.message)
const patternWithSourceReqCustom = /\n( +)try \{\n((?:.*\n)*?)\1\} catch \(err\) \{\n\1  console\.error\(err\.message\);\n\1  logError\('error',\s*'[^']+',\s*err,\s*req\);\n\1  res\.status\(500\)\.json\(\{ error: '[^']+' \}\);\n\1\}/g;

// Pattern: logError('error', 'source', err, req) without console.error
const patternNoConsole = /\n( +)try \{\n((?:.*\n)*?)\1\} catch \(err\) \{\n\1  logError\('error',\s*'[^']+',\s*err,\s*req\);\n\1  res\.status\(500\)\.json\(\{ error: err\.message[^}]*\}\);\n\1\}/g;

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  const orig = content;
  let replaced = 0;

  for (const re of [patternWithSourceReq, patternWithSourceReqCustom, patternNoConsole]) {
    content = content.replace(re, (match, indent, body) => {
      replaced++;
      const lines = body.split('\n');
      const fixed = lines.map(line => {
        if (line === '') return '';
        if (line.startsWith(indent + '  ')) return indent + line.slice(indent.length + 2);
        return line;
      }).join('\n');
      return '\n' + fixed;
    });
  }

  if (replaced > 0) {
    // Add asyncHandler import if not present
    if (!content.includes("require('../lib/errors')")) {
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

    // Wrap handlers
    content = content.replace(
      /, (\(req, res(?:, next)?\))\s*=>\s*\{(?!\s*\n\s*asyncHandler)/g,
      (match, params) => `, asyncHandler(${params} => {`
    );

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ ${path.basename(filePath)}: ${replaced} removed`);
  } else {
    console.log(`  ${path.basename(filePath)}: no matches`);
  }
}
