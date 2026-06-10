import * as fs from 'fs';
import * as path from 'path';
import { scanForSecrets } from './secretsDetector.js';

// ─── Tokenizer (lazy-loaded) ────────────────────────────────────────────────

let _encodeFn: ((text: string) => number[]) | null = null;
let _loadAttempted = false;

async function loadTokenizer(): Promise<void> {
  if (_loadAttempted) return;
  _loadAttempted = true;
  try {
    const mod = await import('gpt-tokenizer');
    _encodeFn = mod.encode;
  } catch {
    _encodeFn = null;
  }
}

loadTokenizer();

export function tokenize(text: string, targetModel?: string): number {
  if (!text) return 0;
  if (_encodeFn && targetModel && text.length <= 500_000) {
    try { return _encodeFn(text).length; } catch { /* fall through */ }
  }
  return Math.ceil(text.length / 4);
}

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
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (['.css', '.scss', '.sass', '.less'].includes(ext)) return 'css';
  if (ext === '.php') return 'php';
  if (ext === '.rb') return 'ruby';
  if (ext === '.swift') return 'swift';
  if (ext === '.sql') return 'sql';
  if (ext === '.vue') return 'vue';
  if (ext === '.svelte') return 'svelte';
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

    // Class-body constants by convention: SCREAMING_SNAKE_CASE = ... or = with a type hint.
    if (/^[A-Z][A-Z0-9_]*\s*(:\s*[\w\[\], ]+)?\s*=/.test(trimmed)) {
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
  // Depths at which we emitted a container's opening line and owe a closing brace.
  const openContainers: number[] = [];

  const braceDelta = (line: string): { opens: number; closes: number } => ({
    opens: (line.match(/\{/g) || []).length,
    closes: (line.match(/\}/g) || []).length,
  });

  // Keep the declaration and type annotation, drop the assigned value —
  // hardcoded values (especially string literals) are where secrets live.
  const stripAssignedValue = (line: string): string => {
    const idx = line.search(/(?<![=!<>+\-*/%&|^])=(?![=>])/);
    if (idx < 0) return line;
    return `${line.slice(0, idx).trimEnd()};`;
  };

  const isValueDeclaration = (str: string): boolean =>
    /\b(const|let|var|val)\s/.test(str) && !str.includes('=>');

  const isSignature = (str: string): boolean => {
    if (str.startsWith('import ') || str.startsWith('package ') || str.startsWith('using ') || str.startsWith('use ')) return true;
    if (str.startsWith('@') || str.startsWith('[') || str.startsWith('#[')) return true;
    if (str.includes('class ') || str.includes('interface ') || str.includes('enum ') || str.includes('struct ') || str.includes('type ') || str.includes('record ') || str.includes('trait ') || /^(pub\s+)?impl\b/.test(str)) return true;
    if (str.match(/(public\s+|private\s+|protected\s+|async\s+)*[\w<>\[\]]+\s+\w+\s*\(/) || str.match(/^func\b/) || str.match(/fn\s+\w+\s*\(/) || str.match(/fun\s+\w+\s*\(/)) return true;
    if (str.includes(' { get;') || str.includes(' { get ')) return true;
    if ((depth === 0 || depth === 1) && (str.includes('const ') || str.includes('let ') || str.includes('var ') || str.includes('val '))) return true;
    return false;
  };

  // Container types whose body fields/variants are themselves the API.
  // For these we preserve the body verbatim instead of collapsing it.
  const isFieldContainer = (str: string): boolean => {
    if (!str.endsWith('{')) return false;
    if (/\b(struct|interface|enum)\b/.test(str)) return true;
    return /\btype\s+\w+(<[^>]*>)?\s*=\s*\{$/.test(str);
  };

  // Containers whose children (methods, fields) we walk individually,
  // emitting the real closing brace when the block ends.
  const isWalkedContainer = (str: string): boolean => {
    if (!str.endsWith('{')) return false;
    return /\b(class|namespace|object|trait|impl|record)\b/.test(str);
  };

  // Advance past a brace-balanced block starting at lines[start]. Returns the
  // index of the block's last line. When `emit` is given, body lines are
  // copied to it verbatim.
  const consumeBlock = (start: number, baseDepth: number, emit?: string[]): number => {
    const first = braceDelta(lines[start] ?? '');
    let d = baseDepth + first.opens - first.closes;
    let i = start;
    while (i + 1 < lines.length && d > baseDepth) {
      i++;
      const inner = lines[i] ?? '';
      emit?.push(inner);
      const delta = braceDelta(inner);
      d += delta.opens - delta.closes;
    }
    return i;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    const { opens, closes } = braceDelta(line);
    const top = openContainers[openContainers.length - 1];
    const inContainerBody = openContainers.length > 0 && depth === (top ?? 0) + 1;

    if (isSignature(trimmed) && depth <= 1) {
      if (isFieldContainer(trimmed)) {
        // Field names / variants ARE the signal — keep the body verbatim.
        skeleton.push(line);
        i = consumeBlock(i, depth, skeleton);
        continue;
      }
      if (isWalkedContainer(trimmed)) {
        skeleton.push(line);
        openContainers.push(depth);
        depth += opens - closes;
        continue;
      }
      if (trimmed.endsWith('{')) {
        // Function/method: collapse the signature and skip the entire body so
        // locals and object literals can never leak into the skeleton.
        skeleton.push(line + ' /* ... */ }');
        i = consumeBlock(i, depth);
        continue;
      }
      skeleton.push(isValueDeclaration(trimmed) ? stripAssignedValue(line) : line);
      depth += opens - closes;
      if (depth < 0) depth = 0;
      continue;
    }

    if (inContainerBody) {
      // Direct child of a walked container (class body, etc.).
      if (trimmed.endsWith('{') && trimmed.includes('(')) {
        // Method: collapse the signature, skip the body.
        skeleton.push(line + ' /* ... */ }');
        i = consumeBlock(i, depth);
        continue;
      }
      if (
        /^[A-Za-z_@#[]/.test(trimmed) &&
        (trimmed.endsWith(';') || trimmed.endsWith('(') || /\)\s*:?\s*\w*$/.test(trimmed))
      ) {
        // Field, property, or the first line of a multi-line signature.
        skeleton.push(trimmed.endsWith(';') ? stripAssignedValue(line) : line);
        depth = Math.max(0, depth + opens - closes);
        continue;
      }
    }

    const newDepth = Math.max(0, depth + opens - closes);
    // Emit a closing brace only when it closes a container we emitted open.
    if (
      closes > opens &&
      openContainers.length > 0 &&
      newDepth <= (openContainers[openContainers.length - 1] ?? 0)
    ) {
      openContainers.pop();
      skeleton.push(line);
    }
    depth = newDepth;
  }

  return skeleton.join('\n');
}

function processHtml(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let inComment = false;
  let inScript = false;
  let inStyle = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === '') continue;

    // Strip multi-line comments.
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true;
      continue;
    }

    // Pass through script/style boundaries but skip their inline content.
    if (inScript) {
      if (/<\/script\s*>/i.test(line)) { inScript = false; skeleton.push(raw); }
      continue;
    }
    if (inStyle) {
      if (/<\/style\s*>/i.test(line)) { inStyle = false; skeleton.push(raw); }
      continue;
    }
    if (/<script\b/i.test(line) && !/<\/script\s*>/i.test(line)) { skeleton.push(raw); inScript = true; continue; }
    if (/<style\b/i.test(line) && !/<\/style\s*>/i.test(line)) { skeleton.push(raw); inStyle = true; continue; }

    // Doctype declarations.
    if (/^<!doctype/i.test(line)) { skeleton.push(raw); continue; }

    // Lines containing a tag — keep tag structure but elide long text nodes
    // *inside generic containers*. Text inside structural label tags
    // (<title>, <h1>..<h6>, <label>, <button>, <a>, etc.) is preserved
    // because it IS the signal the reader needs.
    if (line.includes('<')) {
      const PRESERVE_TEXT_TAGS = /^(title|h[1-6]|label|button|a|li|option|summary|caption|legend|th|td)$/i;
      const compacted = raw.replace(
        /<([A-Za-z][\w-]*)((?:\s[^>]*)?)>([^<>]{12,})<\/\1>/g,
        (_match, tag, attrs, text) => {
          if (PRESERVE_TEXT_TAGS.test(tag)) return `<${tag}${attrs}>${text}</${tag}>`;
          return `<${tag}${attrs}>…</${tag}>`;
        }
      );
      skeleton.push(compacted);
      continue;
    }
    // Pure text content with no tags — drop.
  }

  return skeleton.join('\n');
}

function processCss(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let inBlockComment = false;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === '') continue;

    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (line.startsWith('//')) continue; // SCSS/Less single-line comment

    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    // At-rules: @media / @keyframes / @import / @font-face / @supports / @charset / @page / @namespace
    if (line.startsWith('@')) {
      skeleton.push(raw);
      depth += opens - closes;
      continue;
    }

    // Selector lines — they typically end with `{` or `,` (multi-line selector list).
    if (line.endsWith('{') || line.endsWith(',')) {
      skeleton.push(raw);
      depth += opens - closes;
      continue;
    }

    // Closing brace — always keep to preserve structure.
    if (line.startsWith('}')) {
      skeleton.push(raw);
      depth -= closes;
      if (depth < 0) depth = 0;
      continue;
    }

    // Top-level :root custom-property declarations carry design-token signal.
    if (depth <= 1 && /^--[\w-]+\s*:/.test(line)) {
      skeleton.push(raw);
      continue;
    }

    // Inside a rule body — drop property:value declarations.
  }

  return skeleton.join('\n');
}

function processPhp(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('#') || line.startsWith('/*') || line.startsWith('*')) continue;

    const opens = (raw.match(/\{/g) || []).length;
    const closes = (raw.match(/\}/g) || []).length;

    if (line.startsWith('<?') || line.startsWith('namespace ') || line.startsWith('use ') ||
        line.startsWith('require') || line.startsWith('include')) {
      skeleton.push(raw);
      depth += opens - closes;
      continue;
    }

    if (depth <= 1) {
      if (/^(abstract\s+|final\s+)?(class|interface|trait|enum)\s/.test(line) ||
          /^(public|private|protected|static|\s)*(function)\s/.test(line) ||
          line.startsWith('#[')) {
        if (line.endsWith('{')) {
          skeleton.push(raw + ' /* ... */ }');
        } else {
          skeleton.push(raw);
        }
        depth += opens - closes;
        continue;
      }
      if (/^(public|private|protected|static|const)\s/.test(line) && !line.includes('function')) {
        skeleton.push(raw);
        depth += opens - closes;
        continue;
      }
    }

    if (line.startsWith('}')) {
      skeleton.push(raw);
    }

    depth += opens - closes;
    if (depth < 0) depth = 0;
  }
  return skeleton.join('\n');
}

function processRuby(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const isBlockOpen = /\b(class|module|def|do|if|unless|case|begin|while|until|for)\b/.test(line) && !line.includes(' end');
    const isBlockClose = line === 'end' || line.startsWith('end ');

    if (line.startsWith('require') || line.startsWith('include ') || line.startsWith('extend ') ||
        line.startsWith('attr_') || line.startsWith('module ') || line.startsWith('class ')) {
      skeleton.push(raw);
      if (isBlockOpen) depth++;
      continue;
    }

    if (depth <= 2 && line.startsWith('def ')) {
      skeleton.push(raw + ' ... end');
      depth++;
      continue;
    }

    if (depth <= 2 && (/^(has_many|has_one|belongs_to|validates|scope|before_|after_)/.test(line) ||
        /^[A-Z][A-Z0-9_]*\s*=/.test(line))) {
      skeleton.push(raw);
      continue;
    }

    if (isBlockClose && depth > 0) {
      depth--;
      if (depth <= 1) skeleton.push(raw);
      continue;
    }

    if (isBlockOpen) depth++;
  }
  return skeleton.join('\n');
}

function processSwift(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;

    const opens = (raw.match(/\{/g) || []).length;
    const closes = (raw.match(/\}/g) || []).length;

    if (line.startsWith('import ') || line.startsWith('@')) {
      skeleton.push(raw);
      depth += opens - closes;
      continue;
    }

    if (depth <= 1) {
      if (/^(open\s+|public\s+|internal\s+|fileprivate\s+|private\s+)?(final\s+)?(class|struct|enum|protocol|extension|actor)\s/.test(line) ||
          /^(open\s+|public\s+|internal\s+|fileprivate\s+|private\s+)?(static\s+|class\s+|override\s+|mutating\s+)*(func|init|var|let|subscript|typealias)\s/.test(line) ||
          /^case\s/.test(line)) {
        if (line.endsWith('{') && /\b(struct|enum|protocol)\b/.test(line)) {
          skeleton.push(raw);
          let containerDepth = depth + opens - closes;
          // keep body
        } else if (line.endsWith('{')) {
          skeleton.push(raw + ' /* ... */ }');
        } else {
          skeleton.push(raw);
        }
        depth += opens - closes;
        continue;
      }
    }

    if (line.startsWith('}')) {
      skeleton.push(raw);
    }

    depth += opens - closes;
    if (depth < 0) depth = 0;
  }
  return skeleton.join('\n');
}

function processSql(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('--')) continue;

    const upper = line.toUpperCase();
    if (upper.startsWith('CREATE ') || upper.startsWith('ALTER ') || upper.startsWith('DROP ') ||
        upper.startsWith('INSERT ') || upper.startsWith('SELECT ') || upper.startsWith('UPDATE ') ||
        upper.startsWith('DELETE ') || upper.startsWith('GRANT ') || upper.startsWith('REVOKE ') ||
        upper.startsWith('BEGIN') || upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK') ||
        upper.startsWith('USE ') || upper.startsWith('SET ') ||
        /^\);?\s*$/.test(line) ||
        /^\s*(PRIMARY|FOREIGN|UNIQUE|CHECK|INDEX|CONSTRAINT|REFERENCES|NOT NULL|DEFAULT)\b/.test(upper) ||
        /^\s*\w+\s+(INT|INTEGER|VARCHAR|TEXT|BOOLEAN|BOOL|DATE|TIMESTAMP|SERIAL|BIGINT|FLOAT|DOUBLE|DECIMAL|NUMERIC|CHAR|BLOB|UUID)/.test(upper)) {
      skeleton.push(raw);
    }
  }
  return skeleton.join('\n');
}

function processVueSvelte(content: string, language: string): string {
  const skeleton: string[] = [];
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/gi);
  const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);

  if (templateMatch) {
    for (const block of templateMatch) {
      const tag = block.match(/<template[^>]*>/i)?.[0] ?? '<template>';
      skeleton.push(tag);
      const inner = block.replace(/<\/?template[^>]*>/gi, '').trim();
      if (inner) skeleton.push(processHtml(inner));
      skeleton.push('</template>');
    }
  }

  if (scriptMatch) {
    for (const block of scriptMatch) {
      const tag = block.match(/<script[^>]*>/i)?.[0] ?? '<script>';
      skeleton.push(tag);
      const inner = block.replace(/<\/?script[^>]*>/gi, '').trim();
      if (inner) skeleton.push(processCLike(inner, 'typescript'));
      skeleton.push('</script>');
    }
  }

  if (styleMatch) {
    for (const block of styleMatch) {
      const tag = block.match(/<style[^>]*>/i)?.[0] ?? '<style>';
      skeleton.push(tag);
      const inner = block.replace(/<\/?style[^>]*>/gi, '').trim();
      if (inner) skeleton.push(processCss(inner));
      skeleton.push('</style>');
    }
  }

  return skeleton.join('\n');
}

// ─── Advanced Features ──────────────────────────────────────────────────────

/**
 * Extract a specific symbol (class, function, etc.) from a skeleton.
 * Returns the matching block or the full skeleton if not found.
 */
export function extractSymbol(skeleton: string, symbolName: string): string {
  const lines = skeleton.split('\n');
  const results: string[] = [];
  let capturing = false;
  let captureIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!capturing) {
      if (trimmed.includes(symbolName) &&
          (trimmed.includes('class ') || trimmed.includes('function ') || trimmed.includes('interface ') ||
           trimmed.includes('def ') || trimmed.includes('fn ') || trimmed.includes('func ') ||
           trimmed.includes('fun ') || trimmed.includes('struct ') || trimmed.includes('enum ') ||
           trimmed.includes('trait ') || trimmed.includes('type ') || trimmed.includes('module ') ||
           trimmed.includes('const ') || trimmed.includes('export '))) {
        capturing = true;
        captureIndent = line.length - line.trimStart().length;
        results.push(line);
      }
    } else {
      const indent = line.length - line.trimStart().length;
      if (trimmed === '' || indent > captureIndent || trimmed === '}' || trimmed === 'end') {
        results.push(line);
        if (trimmed === '}' || trimmed === 'end') capturing = false;
      } else {
        capturing = false;
      }
    }
  }

  return results.length > 0 ? results.join('\n') : skeleton;
}

/**
 * Score a skeleton's relevance to a query (higher = more relevant).
 * Simple keyword-based scoring.
 */
export function scoreRelevance(skeleton: string, filePath: string, query: string): number {
  const lowerSkeleton = skeleton.toLowerCase();
  const lowerPath = filePath.toLowerCase();
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 1);
  if (keywords.length === 0) return 0;

  let score = 0;
  for (const kw of keywords) {
    const pathMatches = lowerPath.includes(kw) ? 10 : 0;
    let contentMatches = 0;
    let idx = 0;
    while ((idx = lowerSkeleton.indexOf(kw, idx)) !== -1) {
      contentMatches++;
      idx += kw.length;
    }
    score += pathMatches + contentMatches;
  }
  return score;
}

/**
 * Progressively prune a skeleton to fit within a token budget.
 * Strategy: strip doc comments → collapse bodies → truncate.
 */
export function pruneToFit(skeleton: string, maxTokens: number, targetModel?: string): string {
  const estimateTokens = (s: string) => tokenize(s, targetModel);
  if (estimateTokens(skeleton) <= maxTokens) return skeleton;

  // Pass 1: strip doc comments (/** ... */, """, ''', /// )
  let pruned = skeleton
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/"""[\s\S]*?"""/g, '')
    .replace(/'''[\s\S]*?'''/g, '')
    .replace(/^\s*\/\/\/.*$/gm, '');
  if (estimateTokens(pruned) <= maxTokens) return pruned.trim();

  // Pass 2: collapse all remaining body hints
  pruned = pruned.replace(/\s*\/\* \.\.\. \*\/\s*\}/g, ' }');
  pruned = pruned.replace(/ \.\.\. end/g, '');
  if (estimateTokens(pruned) <= maxTokens) return pruned.trim();

  // Pass 3: strip blank lines
  pruned = pruned.replace(/\n{2,}/g, '\n');
  if (estimateTokens(pruned) <= maxTokens) return pruned.trim();

  // Pass 4: hard truncate
  const targetChars = maxTokens * 4;
  pruned = pruned.substring(0, targetChars);
  const lastNewline = pruned.lastIndexOf('\n');
  if (lastNewline > targetChars * 0.8) pruned = pruned.substring(0, lastNewline);
  return pruned.trim() + '\n// ... (truncated to fit token budget)';
}

/**
 * Optimize skeleton layout to minimize BPE token count.
 * Only applies when a targetModel is specified.
 */
export function optimizeLayout(skeleton: string, targetModel?: string): string {
  if (!targetModel) return skeleton;

  let result = skeleton;

  // Pass 1: collapse 3+ blank lines → 1 blank line, strip trailing spaces
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/[ \t]+$/gm, '');

  // Pass 2: compact braces — remove blank line between closing brace and next declaration
  result = result.replace(/\}\n\n(?=\s*(export |public |private |protected |function |class |interface |struct |enum |fn |func |def |async ))/g, '}\n');

  // Pass 3: minify indentation — 4-space/tab → 2-space
  result = result.replace(/^(\t+)/gm, (_m, tabs: string) => '  '.repeat(tabs.length));
  result = result.replace(/^((?:    )+)/gm, (_m, spaces: string) => '  '.repeat(spaces.length / 4));

  // Pass 4: collapse single-line-able multi-line signatures
  result = result.replace(
    /^(\s*(?:export |public |private |protected |static |async |override )*(?:function|func|fn|fun|def|method)\s+\w+)\(\s*\n((?:\s+\w[^,\n]*,?\s*\n){1,5})\s*\)/gm,
    (_match, prefix: string, paramBlock: string) => {
      const params = paramBlock.split('\n').map(l => l.trim()).filter(Boolean).join(' ');
      const collapsed = `${prefix}(${params})`;
      return collapsed.length <= 120 ? collapsed : _match;
    }
  );

  return result;
}

/**
 * Tag pruned body blocks with expandable node IDs.
 * Encodes file path + line range so expand_node can retrieve the full source.
 */
export function tagPrunedNodes(skeleton: string, filePath: string, originalContent: string): string {
  const originalLines = originalContent.split('\n');
  let nodeCounter = 0;

  return skeleton.replace(
    /^(.+?)\s*\{\s*\/\* \.\.\. \*\/\s*\}$/gm,
    (match, signature) => {
      const sigTrimmed = signature.trim();
      for (let i = 0; i < originalLines.length; i++) {
        if (originalLines[i].trim().startsWith(sigTrimmed.substring(0, Math.min(40, sigTrimmed.length)))) {
          let depth = 0;
          let start = i;
          let end = i;
          for (let j = i; j < originalLines.length; j++) {
            depth += (originalLines[j].match(/\{/g) || []).length;
            depth -= (originalLines[j].match(/\}/g) || []).length;
            if (depth <= 0 && j > i) { end = j; break; }
          }
          const nodeId = Buffer.from(`${filePath}:${start + 1}:${end + 1}`).toString('base64url');
          nodeCounter++;
          return `${signature} { /* EXPAND:${nodeId} */ }`;
        }
      }
      return match;
    }
  );
}

/**
 * Expand a node ID back to the full source code.
 */
export function expandNode(nodeId: string): { filePath: string; startLine: number; endLine: number; content: string } | null {
  try {
    const decoded = Buffer.from(nodeId, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    const endLine = parseInt(parts.pop()!, 10);
    const startLine = parseInt(parts.pop()!, 10);
    const filePath = parts.join(':'); // rejoin in case path has colons (Windows)

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const slice = lines.slice(startLine - 1, endLine).join('\n');
    return { filePath, startLine, endLine, content: slice };
  } catch {
    return null;
  }
}

// ─── Feature 2: Cross-File Graph Splicing ───────────────────────────────────

const EXTENSIONS_BY_LANG: Record<string, string[]> = {
  typescript: ['.ts', '.tsx', '.js', '.jsx'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  php: ['.php'],
  ruby: ['.rb'],
  swift: ['.swift'],
};

/**
 * Extract raw import module specifiers from source content.
 */
export function extractImportSpecifiers(content: string, language: string): string[] {
  const specifiers: string[] = [];

  if (language === 'typescript') {
    // ESM: import ... from 'module'  /  import 'module'
    for (const m of content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specifiers.push(m[1]);
    for (const m of content.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) specifiers.push(m[1]);
    // CJS: require('module')
    for (const m of content.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(m[1]);
  } else if (language === 'python') {
    for (const m of content.matchAll(/^\s*from\s+(\S+)\s+import/gm)) specifiers.push(m[1]);
    for (const m of content.matchAll(/^\s*import\s+(\S+)/gm)) specifiers.push(m[1]);
  } else if (language === 'go') {
    // Single: import "pkg"  or grouped import ( "pkg" )
    for (const m of content.matchAll(/["']([^"']+)["']/g)) {
      if (m[1].includes('/') || m[1].includes('.')) specifiers.push(m[1]);
    }
  } else if (language === 'rust') {
    for (const m of content.matchAll(/^\s*use\s+(crate::\S+?);/gm)) specifiers.push(m[1]);
    for (const m of content.matchAll(/^\s*use\s+(super::\S+?);/gm)) specifiers.push(m[1]);
    for (const m of content.matchAll(/^\s*mod\s+(\w+)\s*;/gm)) specifiers.push(`mod::${m[1]}`);
  } else if (language === 'php') {
    for (const m of content.matchAll(/\brequire(?:_once)?\s+['"]([^'"]+)['"]/g)) specifiers.push(m[1]);
    for (const m of content.matchAll(/\binclude(?:_once)?\s+['"]([^'"]+)['"]/g)) specifiers.push(m[1]);
  } else if (language === 'ruby') {
    for (const m of content.matchAll(/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm)) specifiers.push(m[1]);
  } else if (language === 'swift') {
    for (const m of content.matchAll(/^\s*import\s+(\w+)/gm)) specifiers.push(m[1]);
  }

  return [...new Set(specifiers)];
}

/**
 * Resolve an import specifier to an actual file path.
 * Returns null for external/package imports.
 */
export function resolveImport(specifier: string, fromFile: string, language: string): string | null {
  const dir = path.dirname(fromFile);

  if (language === 'typescript') {
    if (!specifier.startsWith('.')) return null;
    const exts = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
    for (const ext of exts) {
      const candidate = path.resolve(dir, specifier + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
    const exact = path.resolve(dir, specifier);
    if (fs.existsSync(exact)) return exact;
    return null;
  }

  if (language === 'python') {
    if (specifier.startsWith('.')) {
      const dots = specifier.match(/^\.+/)?.[0].length ?? 1;
      let base = dir;
      for (let i = 1; i < dots; i++) base = path.dirname(base);
      const rest = specifier.slice(dots).replace(/\./g, '/');
      if (rest) {
        for (const cand of [path.join(base, rest + '.py'), path.join(base, rest, '__init__.py')]) {
          if (fs.existsSync(cand)) return cand;
        }
      }
    } else {
      const parts = specifier.replace(/\./g, '/');
      for (const cand of [path.resolve(dir, parts + '.py'), path.resolve(dir, parts, '__init__.py')]) {
        if (fs.existsSync(cand)) return cand;
      }
    }
    return null;
  }

  if (language === 'rust') {
    if (specifier.startsWith('mod::')) {
      const modName = specifier.slice(5);
      for (const cand of [path.join(dir, modName + '.rs'), path.join(dir, modName, 'mod.rs')]) {
        if (fs.existsSync(cand)) return cand;
      }
    }
    if (specifier.startsWith('crate::') || specifier.startsWith('super::')) {
      const parts = specifier.replace(/^(crate|super)::/, '').split('::');
      let base = specifier.startsWith('super::') ? path.dirname(dir) : findCrateRoot(dir);
      const modPath = parts.slice(0, -1).join('/');
      if (modPath) {
        for (const cand of [path.join(base, modPath + '.rs'), path.join(base, modPath, 'mod.rs')]) {
          if (fs.existsSync(cand)) return cand;
        }
      }
    }
    return null;
  }

  if (language === 'php' || language === 'ruby') {
    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
      const candidate = path.resolve(dir, specifier);
      if (fs.existsSync(candidate)) return candidate;
      const lang = language === 'ruby' ? '.rb' : '.php';
      if (fs.existsSync(candidate + lang)) return candidate + lang;
    }
    return null;
  }

  return null;
}

function findCrateRoot(dir: string): string {
  let current = dir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(current, 'Cargo.toml'))) {
      return path.join(current, 'src');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

/**
 * Build a dependency chain from a seed file via BFS import traversal.
 */
export function buildDependencyChain(seedFile: string, maxDepth: number = 2): ParseResult[] {
  const MAX_FILES = 20;
  const visited = new Set<string>();
  const results: ParseResult[] = [];

  interface QueueItem { filePath: string; depth: number }
  const queue: QueueItem[] = [{ filePath: path.resolve(seedFile), depth: 0 }];

  while (queue.length > 0 && results.length < MAX_FILES) {
    const { filePath, depth } = queue.shift()!;
    const resolved = path.resolve(filePath);
    if (visited.has(resolved)) continue;
    visited.add(resolved);

    const result = analyzeFile(resolved);
    results.push(result);
    if (result.error || depth >= maxDepth) continue;

    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      const language = getLanguage(resolved);
      const specifiers = extractImportSpecifiers(content, language);
      const externals: string[] = [];

      for (const spec of specifiers) {
        const dep = resolveImport(spec, resolved, language);
        if (dep && !visited.has(path.resolve(dep))) {
          queue.push({ filePath: dep, depth: depth + 1 });
        } else if (!dep) {
          externals.push(spec);
        }
      }
    } catch { /* ignore read errors */ }
  }

  return results;
}

// ─── Feature 4: AST-Driven Structural Patching ─────────────────────────────

export interface SkeletonNode {
  nodeId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  kind: 'sig' | 'body' | 'import' | 'decl';
}

/**
 * Tag ALL skeleton elements with node IDs — signatures, declarations, imports,
 * and pruned bodies — so the model can reference any part for patching.
 */
export function tagAllNodes(skeleton: string, filePath: string, originalContent: string): string {
  const originalLines = originalContent.split('\n');
  const skeletonLines = skeleton.split('\n');
  const tagged: string[] = [];

  for (let si = 0; si < skeletonLines.length; si++) {
    const line = skeletonLines[si];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('//') && !trimmed.startsWith('///')) {
      tagged.push(line);
      continue;
    }

    // Already has an EXPAND tag — keep it but also add NODE tag
    if (/\/\* EXPAND:\S+ \*\//.test(line)) {
      const sigMatch = trimmed.match(/^(.+?)\s*\{\s*\/\* EXPAND:(\S+) \*\/\s*\}$/);
      if (sigMatch) {
        tagged.push(line);
        continue;
      }
    }

    const kind = classifyLine(trimmed);
    if (kind) {
      const match = findOriginalLine(trimmed, originalLines);
      if (match) {
        const endLine = kind === 'import' ? match.line + 1 :
                        kind === 'body' ? findBlockEnd(originalLines, match.line) :
                        kind === 'sig' ? findBlockEnd(originalLines, match.line) :
                        match.line + 1;
        const nodeId = Buffer.from(`${filePath}:${match.line + 1}:${endLine}:${kind}`).toString('base64url');
        tagged.push(`${line} /* NODE:${nodeId} */`);
        continue;
      }
    }

    tagged.push(line);
  }

  return tagged.join('\n');
}

function classifyLine(trimmed: string): SkeletonNode['kind'] | null {
  if (trimmed.startsWith('import ') || trimmed.startsWith('from ') ||
      trimmed.startsWith('use ') || trimmed.startsWith('using ') ||
      trimmed.startsWith('require') || trimmed.startsWith('include ') ||
      trimmed.startsWith('package ')) {
    return 'import';
  }
  if (trimmed.match(/\b(class|interface|struct|enum|trait|record|type|module|object|protocol|extension)\s/)) {
    return 'decl';
  }
  if (trimmed.match(/\b(function|func|fn|fun|def|async def|method|init|subscript)\s/) ||
      trimmed.match(/(public|private|protected|static|override|async)\s.*\(/) ||
      trimmed.match(/^\w[\w<>\[\]]*\s+\w+\s*\(/)) {
    return 'sig';
  }
  return null;
}

function findOriginalLine(skeletonTrimmed: string, originalLines: string[]): { line: number } | null {
  const prefix = skeletonTrimmed
    .replace(/\s*\{\s*\/\*.*?\*\/\s*\}\s*$/, '')
    .replace(/\s*\.\.\.\s*$/, '')
    .replace(/\s*\.\.\.\s*end\s*$/, '')
    .trim()
    .substring(0, 50);
  if (!prefix) return null;

  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim().startsWith(prefix)) {
      return { line: i };
    }
  }
  return null;
}

function findBlockEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  for (let j = startIdx; j < lines.length; j++) {
    depth += (lines[j].match(/\{/g) || []).length;
    depth -= (lines[j].match(/\}/g) || []).length;
    if (depth <= 0 && j > startIdx) return j + 1;
  }
  return startIdx + 1;
}

export interface Patch {
  nodeId: string;
  action: 'replace' | 'insert_after' | 'delete';
  content?: string;
}

export interface PatchResult {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  diff: string;
}

/**
 * Decode a node ID (from tagAllNodes or tagPrunedNodes).
 */
export function decodeNodeId(nodeId: string): { filePath: string; startLine: number; endLine: number; kind: string } | null {
  try {
    const decoded = Buffer.from(nodeId, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length < 3) return null;
    const kind = /^(sig|body|import|decl)$/.test(parts[parts.length - 1]) ? parts.pop()! : 'body';
    const endLine = parseInt(parts.pop()!, 10);
    const startLine = parseInt(parts.pop()!, 10);
    const filePath = parts.join(':');
    if (isNaN(startLine) || isNaN(endLine)) return null;
    return { filePath, startLine, endLine, kind };
  } catch {
    return null;
  }
}

/**
 * Apply structural patches to source files.
 * Patches are applied bottom-up to preserve line offsets.
 */
export function applyPatches(patches: Patch[], dryRun: boolean = true): PatchResult[] {
  const MAX_PATCHES = 10;
  const patchList = patches.slice(0, MAX_PATCHES);

  const byFile = new Map<string, { startLine: number; endLine: number; action: string; content?: string }[]>();

  for (const p of patchList) {
    const decoded = decodeNodeId(p.nodeId);
    if (!decoded) continue;
    const list = byFile.get(decoded.filePath) || [];
    list.push({ startLine: decoded.startLine, endLine: decoded.endLine, action: p.action, content: p.content });
    byFile.set(decoded.filePath, list);
  }

  const results: PatchResult[] = [];

  for (const [filePath, ops] of byFile) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const originalContent = content;

    // Validate no overlapping patches
    ops.sort((a, b) => b.startLine - a.startLine);
    let valid = true;
    for (let i = 0; i < ops.length - 1; i++) {
      if (ops[i].startLine < ops[i + 1].endLine) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    for (const op of ops) {
      const start = op.startLine - 1;
      const end = op.endLine;
      if (start < 0 || end > lines.length) continue;

      if (op.action === 'delete') {
        lines.splice(start, end - start);
      } else if (op.action === 'replace' && op.content != null) {
        const newLines = op.content.split('\n');
        lines.splice(start, end - start, ...newLines);
      } else if (op.action === 'insert_after' && op.content != null) {
        const newLines = op.content.split('\n');
        lines.splice(end, 0, ...newLines);
      }
    }

    const patchedContent = lines.join('\n');

    // Generate a simple unified diff
    const diff = generateDiff(filePath, originalContent, patchedContent);

    if (!dryRun) {
      fs.writeFileSync(filePath, patchedContent, 'utf-8');
    }

    results.push({ filePath, originalContent, patchedContent, diff });
  }

  return results;
}

function generateDiff(filePath: string, original: string, patched: string): string {
  const origLines = original.split('\n');
  const patchLines = patched.split('\n');
  const diffLines: string[] = [`--- a/${path.basename(filePath)}`, `+++ b/${path.basename(filePath)}`];

  let i = 0, j = 0;
  while (i < origLines.length || j < patchLines.length) {
    if (i < origLines.length && j < patchLines.length && origLines[i] === patchLines[j]) {
      i++; j++;
      continue;
    }

    const hunkStart = i;
    const hunkStartJ = j;
    // Find the extent of the change
    let origEnd = i;
    let patchEnd = j;

    while (origEnd < origLines.length && (patchEnd >= patchLines.length || origLines[origEnd] !== patchLines[patchEnd])) {
      origEnd++;
    }
    while (patchEnd < patchLines.length && (origEnd >= origLines.length || origLines[origEnd] !== patchLines[patchEnd])) {
      patchEnd++;
    }

    diffLines.push(`@@ -${hunkStart + 1},${origEnd - hunkStart} +${hunkStartJ + 1},${patchEnd - hunkStartJ} @@`);
    for (let k = hunkStart; k < origEnd; k++) diffLines.push(`-${origLines[k]}`);
    for (let k = hunkStartJ; k < patchEnd; k++) diffLines.push(`+${patchLines[k]}`);

    i = origEnd;
    j = patchEnd;
  }

  return diffLines.join('\n');
}

export function analyzeFile(filePath: string): ParseResult {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lang = getLanguage(filePath);
    const originalLines = content.split('\n').length;
    const originalChars = content.length;

    // Never let credentials flow into model context through a skeleton.
    const secrets = scanForSecrets(filePath, content);
    if (secrets.hasSecrets) {
      return {
        filePath,
        originalTokens: 0,
        compactedTokens: 0,
        reductionPercent: 0,
        skeleton: '',
        error: `Excluded: secrets detected (${secrets.reasons.join('; ')})`
      };
    }

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
    } else if (lang === 'html') {
      skeleton = processHtml(content);
    } else if (lang === 'css') {
      skeleton = processCss(content);
    } else if (lang === 'php') {
      skeleton = processPhp(content);
    } else if (lang === 'ruby') {
      skeleton = processRuby(content);
    } else if (lang === 'swift') {
      skeleton = processSwift(content);
    } else if (lang === 'sql') {
      skeleton = processSql(content);
    } else if (lang === 'vue' || lang === 'svelte') {
      skeleton = processVueSvelte(content, lang);
    } else {
      skeleton = processCLike(content, lang);
    }

    // If compaction would inflate the file (common for very small files where
    // `{ /* ... */ }` annotations exceed the saved body), fall back to original.
    if (skeleton.length >= content.length) {
      skeleton = content;
    }

    const skeletonLines = skeleton.split('\n').length;
    const skeletonChars = skeleton.length;

    const originalTokens = tokenize(content);
    const compactedTokens = tokenize(skeleton);
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
