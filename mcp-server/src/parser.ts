import * as fs from 'fs';
import * as path from 'path';

export interface ParseResult {
  filePath: string;
  originalTokens: number;
  compactedTokens: number;
  reductionPercent: number;
  skeleton: string;
  error?: string;
}

export function getLanguage(filePath: string): string {
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

function processPython(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let inDocstring = false;
  let docstringChar = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

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

    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      skeleton.push(line);
      continue;
    }

    if (trimmed.startsWith('@')) {
      skeleton.push(line);
      continue;
    }

    if (trimmed.startsWith('class ') || trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      let sig = line;
      let j = i;
      while (!sig.includes(':') && j < lines.length - 1) {
        j++;
        sig += ' ' + lines[j].trim();
      }
      i = j;
      skeleton.push(sig + ' ...');
      continue;
    }

    if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.includes('=') && !trimmed.startsWith('if ') && !trimmed.startsWith('for ')) {
      skeleton.push(line);
      continue;
    }
  }
  return skeleton.join('\n');
}

function processCLike(content: string, language: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let depth = 0;
  
  const isSignature = (str: string): boolean => {
    if (str.startsWith('import ') || str.startsWith('package ') || str.startsWith('using ')) return true;
    if (str.startsWith('@') || str.startsWith('[')) return true;
    if (str.includes('class ') || str.includes('interface ') || str.includes('enum ') || str.includes('struct ') || str.includes('type ') || str.includes('record ')) return true;
    if (str.match(/(public\s+|private\s+|protected\s+|async\s+)*[\w<>\[\]]+\s+\w+\s*\(/) || str.match(/func\s+\w+\s*\(/) || str.match(/fn\s+\w+\s*\(/) || str.match(/fun\s+\w+\s*\(/)) return true;
    if (str.includes(' { get;') || str.includes(' { get ')) return true;
    if ((depth === 0 || depth === 1) && (str.includes('const ') || str.includes('let ') || str.includes('var ') || str.includes('val '))) return true;
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;

    if (isSignature(trimmed) && depth <= 1) {
      if (trimmed.endsWith('{')) {
        skeleton.push(line + ' /* ... */ }');
      } else {
        skeleton.push(line);
      }
    } else if (openBraces > 0 && depth === 0) {
      skeleton.push(line);
    } else if (closeBraces > 0 && depth === 1) {
      skeleton.push(line);
    }

    depth += openBraces;
    depth -= closeBraces;
    if (depth < 0) depth = 0;
  }

  return skeleton.join('\n');
}

export function analyzeFile(filePath: string): ParseResult {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lang = getLanguage(filePath);
    const originalLines = content.split('\n').length;
    const originalChars = content.length;

    if (lang === 'unknown') {
      return {
        filePath,
        originalTokens: 0,
        compactedTokens: 0,
        reductionPercent: 0,
        skeleton: '',
        error: 'Unsupported file type'
      };
    }

    let skeleton = '';
    if (lang === 'python') {
      skeleton = processPython(content);
    } else {
      skeleton = processCLike(content, lang);
    }

    const skeletonLines = skeleton.split('\n').length;
    const skeletonChars = skeleton.length;
    
    const originalTokens = Math.ceil(originalChars / 4);
    const compactedTokens = Math.ceil(skeletonChars / 4);
    const reductionPercent = originalTokens > 0 ? Math.round(((originalTokens - compactedTokens) / originalTokens) * 100) : 0;

    const fileName = path.basename(filePath);
    const header = `// ${fileName} (${originalLines} lines → ${skeletonLines}-line skeleton)\n\n`;

    return {
      filePath,
      originalTokens,
      compactedTokens,
      reductionPercent,
      skeleton: header + skeleton
    };
  } catch (err: any) {
    return {
      filePath,
      originalTokens: 0,
      compactedTokens: 0,
      reductionPercent: 0,
      skeleton: '',
      error: err.message
    };
  }
}
