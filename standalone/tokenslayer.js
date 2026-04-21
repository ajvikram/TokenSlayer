#!/usr/bin/env node
/**
 * TokenSlayer Standalone Parser
 * Zero-dependency codebase structural extractor for any IDE/Agent.
 * Usage: node tokenslayer.js <filepath>
 */

const fs = require('fs');
const path = require('path');

function getLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.py') return 'python';
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return 'typescript';
  if (ext === '.go') return 'go';
  if (ext === '.java') return 'java';
  if (ext === '.rs') return 'rust';
  if (ext === '.cs') return 'csharp';
  if (ext === '.kt') return 'kotlin';
  return 'unknown';
}

function processPython(content) {
  const lines = content.split('\n');
  const skeleton = [];
  let inDocstring = false;
  let docstringChar = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Handle docstrings
    if (!inDocstring && (trimmed.startsWith('"""') || trimmed.startsWith("'''"))) {
      inDocstring = true;
      docstringChar = trimmed.substring(0, 3);
      skeleton.push(line);
      if (trimmed.length > 3 && trimmed.endsWith(docstringChar)) {
        inDocstring = false;
      }
      continue;
    }
    if (inDocstring) {
      if (trimmed.endsWith(docstringChar) && trimmed.length >= 3) {
        inDocstring = false;
        skeleton.push(line);
      }
      continue;
    }

    // Keep imports
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      skeleton.push(line);
      continue;
    }

    // Keep decorators
    if (trimmed.startsWith('@')) {
      skeleton.push(line);
      continue;
    }

    // Keep class and def
    if (trimmed.startsWith('class ') || trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      let sig = line;
      // If signature wraps, collect it
      let j = i;
      while (!sig.includes(':') && j < lines.length - 1) {
        j++;
        sig += ' ' + lines[j].trim();
      }
      i = j;
      skeleton.push(sig + ' ...');
      continue;
    }

    // Keep top-level assignments
    if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.includes('=') && !trimmed.startsWith('if ') && !trimmed.startsWith('for ')) {
      skeleton.push(line);
      continue;
    }
  }
  return skeleton.join('\n');
}

function processCLike(content, language) {
  const lines = content.split('\n');
  const skeleton = [];
  let depth = 0;
  
  // Regex to detect signatures
  const isSignature = (str) => {
    if (str.startsWith('import ') || str.startsWith('package ') || str.startsWith('using ')) return true;
    if (str.startsWith('@') || str.startsWith('[')) return true;
    if (str.includes('class ') || str.includes('interface ') || str.includes('enum ') || str.includes('struct ') || str.includes('type ') || str.includes('record ')) return true;
    
    // Method/Function detection: name(args)
    if (str.match(/(public\s+|private\s+|protected\s+|async\s+)*[\w<>\[\]]+\s+\w+\s*\(/) || str.match(/func\s+\w+\s*\(/) || str.match(/fn\s+\w+\s*\(/) || str.match(/fun\s+\w+\s*\(/)) {
      return true;
    }
    
    // Properties (public string Name { get; set; })
    if (str.includes(' { get;') || str.includes(' { get ')) return true;
    
    // Top-level or class-level variable declarations
    if ((depth === 0 || depth === 1) && (str.includes('const ') || str.includes('let ') || str.includes('var ') || str.includes('val '))) {
      return true;
    }

    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      continue;
    }

    // Count braces
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;

    let kept = false;

    if (isSignature(trimmed) && depth <= 1) {
      // If it's a method opening, append /*...*/
      if (trimmed.endsWith('{')) {
        skeleton.push(line + ' /* ... */ }');
        // We artificially "close" it visually, so we don't output the actual close brace later
      } else {
        skeleton.push(line);
      }
      kept = true;
    } else if (openBraces > 0 && depth === 0) {
      skeleton.push(line);
      kept = true;
    } else if (closeBraces > 0 && depth === 1) {
      skeleton.push(line);
      kept = true;
    }

    depth += openBraces;
    depth -= closeBraces;
    if (depth < 0) depth = 0;
  }

  return skeleton.join('\n');
}

function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lang = getLanguage(filePath);
    const originalLines = content.split('\n').length;
    const originalChars = content.length;

    let skeleton = '';
    if (lang === 'python') {
      skeleton = processPython(content);
    } else if (lang !== 'unknown') {
      skeleton = processCLike(content, lang);
    } else {
      console.error(`Unsupported file type: ${filePath}`);
      process.exit(1);
    }

    const skeletonLines = skeleton.split('\n').length;
    const skeletonChars = skeleton.length;
    
    // Approximate Token Counting (1 token ~= 4 chars)
    const originalTokens = Math.ceil(originalChars / 4);
    const compactedTokens = Math.ceil(skeletonChars / 4);
    const reduction = originalTokens > 0 ? Math.round(((originalTokens - compactedTokens) / originalTokens) * 100) : 0;

    const fileName = path.basename(filePath);
    const header = `// ${fileName} (${originalLines} lines → ${skeletonLines}-line skeleton)`;
    
    console.log(`[TokenSlayer Saved ${reduction}% (${originalTokens} -> ${compactedTokens} tokens)]\n`);
    console.log(header);
    console.log('');
    console.log(skeleton);

  } catch (err) {
    console.error(`Error reading file: ${err.message}`);
    process.exit(1);
  }
}

// CLI Entry Point
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node tokenslayer.js <filepath>');
  process.exit(1);
}

processFile(args[0]);
