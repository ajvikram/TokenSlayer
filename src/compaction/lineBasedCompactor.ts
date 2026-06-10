import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';

/**
 * Line-based compactors for languages that have no document-symbol-driven
 * compactor (PHP, Ruby, Swift, SQL, Vue, Svelte). Ported from the standalone
 * MCP server's parser so both surfaces support the same language set. These
 * ignore the symbol tree and work directly on the text, so they also function
 * when no language extension providing symbols is installed.
 */

// ─── Shared C-like processor (used for Vue/Svelte script blocks) ────────────

function processCLike(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let depth = 0;
  const openContainers: number[] = [];

  const braceDelta = (line: string): { opens: number; closes: number } => ({
    opens: (line.match(/\{/g) || []).length,
    closes: (line.match(/\}/g) || []).length,
  });

  const stripAssignedValue = (line: string): string => {
    const idx = line.search(/(?<![=!<>+\-*/%&|^])=(?![=>])/);
    if (idx < 0) { return line; }
    return `${line.slice(0, idx).trimEnd()};`;
  };

  const isValueDeclaration = (str: string): boolean =>
    /\b(const|let|var|val)\s/.test(str) && !str.includes('=>');

  const isSignature = (str: string): boolean => {
    if (str.startsWith('import ') || str.startsWith('package ') || str.startsWith('using ') || str.startsWith('use ')) { return true; }
    if (str.startsWith('export ') && str.includes(' from ')) { return true; }
    if (str.startsWith('@') || str.startsWith('#[')) { return true; }
    if (str.includes('class ') || str.includes('interface ') || str.includes('enum ') || str.includes('struct ') || str.includes('type ') || str.includes('record ') || str.includes('trait ')) { return true; }
    if (str.match(/(public\s+|private\s+|protected\s+|async\s+)*[\w<>\[\]]+\s+\w+\s*\(/) || str.match(/function\s+\w+\s*\(/) || str.match(/^func\b/) || str.match(/\bfn\s+\w+\s*\(/) || str.match(/\bfun\s+\w+\s*\(/)) { return true; }
    if (str.includes(' { get;') || str.includes(' { get ')) { return true; }
    if ((depth === 0 || depth === 1) && (str.includes('const ') || str.includes('let ') || str.includes('var ') || str.includes('val '))) { return true; }
    return false;
  };

  const isFieldContainer = (str: string): boolean => {
    if (!str.endsWith('{')) { return false; }
    if (/\b(struct|interface|enum)\b/.test(str)) { return true; }
    return /\btype\s+\w+(<[^>]*>)?\s*=\s*\{$/.test(str);
  };

  const isWalkedContainer = (str: string): boolean => {
    if (!str.endsWith('{')) { return false; }
    return /\b(class|namespace|object|trait|impl|record)\b/.test(str);
  };

  const consumeBlock = (start: number, baseDepth: number, emit?: string[]): number => {
    const first = braceDelta(lines[start] || '');
    let d = baseDepth + first.opens - first.closes;
    let i = start;
    while (i + 1 < lines.length && d > baseDepth) {
      i++;
      const inner = lines[i] || '';
      if (emit) { emit.push(inner); }
      const delta = braceDelta(inner);
      d += delta.opens - delta.closes;
    }
    return i;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')) { continue; }

    const { opens, closes } = braceDelta(line);
    const top = openContainers[openContainers.length - 1];
    const inContainerBody = openContainers.length > 0 && depth === (top ?? 0) + 1;

    if (isSignature(trimmed) && depth <= 1) {
      if (isFieldContainer(trimmed)) {
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
        skeleton.push(line + ' /* ... */ }');
        i = consumeBlock(i, depth);
        continue;
      }
      skeleton.push(isValueDeclaration(trimmed) ? stripAssignedValue(line) : line);
      depth += opens - closes;
      if (depth < 0) { depth = 0; }
      continue;
    }

    if (inContainerBody) {
      if (trimmed.endsWith('{') && trimmed.includes('(')) {
        skeleton.push(line + ' /* ... */ }');
        i = consumeBlock(i, depth);
        continue;
      }
      if (/^[A-Za-z_@#[]/.test(trimmed) && (trimmed.endsWith(';') || trimmed.endsWith('(') || /\)\s*:?\s*\w*$/.test(trimmed))) {
        skeleton.push(trimmed.endsWith(';') ? stripAssignedValue(line) : line);
        depth = Math.max(0, depth + opens - closes);
        continue;
      }
    }

    const newDepth = Math.max(0, depth + opens - closes);
    if (closes > opens && openContainers.length > 0 && newDepth <= (openContainers[openContainers.length - 1] ?? 0)) {
      openContainers.pop();
      skeleton.push(line);
    }
    depth = newDepth;
  }

  return skeleton.join('\n');
}

// ─── Symbol-less fallbacks ──────────────────────────────────────────────────
// Used when a language server provides no document symbols (not installed, or
// still indexing) so AST-driven compactors would emit an imports-only skeleton.

function processPythonLines(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('import ') || trimmed.startsWith('from ') || trimmed.startsWith('@')) {
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
    if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.includes('=') &&
        !trimmed.startsWith('if ') && !trimmed.startsWith('for ') && !trimmed.startsWith('#')) {
      skeleton.push(line);
    }
  }
  return skeleton.join('\n');
}

/**
 * Build a line-based skeleton for a language whose AST compactor got no
 * symbols. Returns the skeleton body (no header).
 */
export function fallbackSkeleton(languageId: string, content: string): string {
  if (languageId === 'python') {
    return processPythonLines(content);
  }
  return processCLike(content);
}

// ─── HTML / CSS helpers (for Vue/Svelte blocks) ─────────────────────────────

function processHtmlLines(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let inComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === '') { continue; }

    if (inComment) {
      if (line.includes('-->')) { inComment = false; }
      continue;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) { inComment = true; }
      continue;
    }

    if (line.includes('<')) {
      const PRESERVE_TEXT_TAGS = /^(title|h[1-6]|label|button|a|li|option|summary|caption|legend|th|td)$/i;
      const compacted = raw.replace(
        /<([A-Za-z][\w-]*)((?:\s[^>]*)?)>([^<>]{12,})<\/\1>/g,
        (_match, tag, attrs, text) => {
          if (PRESERVE_TEXT_TAGS.test(tag)) { return `<${tag}${attrs}>${text}</${tag}>`; }
          return `<${tag}${attrs}>…</${tag}>`;
        }
      );
      skeleton.push(compacted);
    }
  }
  return skeleton.join('\n');
}

function processCssLines(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let inBlockComment = false;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === '') { continue; }

    if (inBlockComment) {
      if (line.includes('*/')) { inBlockComment = false; }
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) { inBlockComment = true; }
      continue;
    }
    if (line.startsWith('//')) { continue; }

    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    if (line.startsWith('@') || line.endsWith('{') || line.endsWith(',')) {
      skeleton.push(raw);
      depth += opens - closes;
      continue;
    }
    if (line.startsWith('}')) {
      skeleton.push(raw);
      depth -= closes;
      if (depth < 0) { depth = 0; }
      continue;
    }
    if (depth <= 1 && /^--[\w-]+\s*:/.test(line)) {
      skeleton.push(raw);
    }
  }
  return skeleton.join('\n');
}

// ─── Language processors ────────────────────────────────────────────────────

function processPhp(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('#') || line.startsWith('/*') || line.startsWith('*')) { continue; }

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

    if (line.startsWith('}') && depth === 1) {
      skeleton.push(raw);
    }

    depth += opens - closes;
    if (depth < 0) { depth = 0; }
  }
  return skeleton.join('\n');
}

function processRuby(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) { continue; }

    const isBlockOpen = /\b(class|module|def|do|if|unless|case|begin|while|until|for)\b/.test(line) && !line.includes(' end');
    const isBlockClose = line === 'end' || line.startsWith('end ');

    if (line.startsWith('require') || line.startsWith('include ') || line.startsWith('extend ') ||
        line.startsWith('attr_') || line.startsWith('module ') || line.startsWith('class ')) {
      skeleton.push(raw);
      if (isBlockOpen) { depth++; }
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
      if (depth <= 1) { skeleton.push(raw); }
      continue;
    }

    if (isBlockOpen) { depth++; }
  }
  return skeleton.join('\n');
}

function processSwift(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) { continue; }

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
        } else if (line.endsWith('{')) {
          skeleton.push(raw + ' /* ... */ }');
        } else {
          skeleton.push(raw);
        }
        depth += opens - closes;
        continue;
      }
    }

    if (line.startsWith('}') && depth === 1) {
      skeleton.push(raw);
    }

    depth += opens - closes;
    if (depth < 0) { depth = 0; }
  }
  return skeleton.join('\n');
}

function processSql(content: string): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('--')) { continue; }

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

function processVueSvelte(content: string): string {
  const skeleton: string[] = [];
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/gi);
  const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);

  if (templateMatch) {
    for (const block of templateMatch) {
      const tag = block.match(/<template[^>]*>/i)?.[0] ?? '<template>';
      skeleton.push(tag);
      const inner = block.replace(/<\/?template[^>]*>/gi, '').trim();
      if (inner) { skeleton.push(processHtmlLines(inner)); }
      skeleton.push('</template>');
    }
  }

  if (scriptMatch) {
    for (const block of scriptMatch) {
      const tag = block.match(/<script[^>]*>/i)?.[0] ?? '<script>';
      skeleton.push(tag);
      const inner = block.replace(/<\/?script[^>]*>/gi, '').trim();
      if (inner) { skeleton.push(processCLike(inner)); }
      skeleton.push('</script>');
    }
  }

  // Svelte: top-level markup lives outside any wrapper tag.
  if (!templateMatch && !scriptMatch && !styleMatch) {
    skeleton.push(processHtmlLines(content));
  } else if (!templateMatch) {
    const markup = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .trim();
    if (markup) { skeleton.push(processHtmlLines(markup)); }
  }

  if (styleMatch) {
    for (const block of styleMatch) {
      const tag = block.match(/<style[^>]*>/i)?.[0] ?? '<style>';
      skeleton.push(tag);
      const inner = block.replace(/<\/?style[^>]*>/gi, '').trim();
      if (inner) { skeleton.push(processCssLines(inner)); }
      skeleton.push('</style>');
    }
  }

  return skeleton.join('\n');
}

// ─── Compactor classes ──────────────────────────────────────────────────────

abstract class LineBasedCompactor implements ICompactor {
  abstract languageIds: string[];

  protected abstract process(content: string): string;

  compact(_symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;
    let skeleton = this.process(fileContent);
    // Small files: annotations can exceed the saved body.
    if (skeleton.length >= fileContent.length) {
      skeleton = fileContent;
    }
    const skeletonLines = skeleton.split('\n').filter(l => l.trim().length > 0).length;
    const header = `// ${fileName} (${totalLines} lines → ${skeletonLines}-line skeleton)`;
    return [header, '', skeleton].join('\n');
  }
}

export class PhpCompactor extends LineBasedCompactor {
  languageIds = ['php'];
  protected process(content: string): string { return processPhp(content); }
}

export class RubyCompactor extends LineBasedCompactor {
  languageIds = ['ruby'];
  protected process(content: string): string { return processRuby(content); }
}

export class SwiftCompactor extends LineBasedCompactor {
  languageIds = ['swift'];
  protected process(content: string): string { return processSwift(content); }
}

export class SqlCompactor extends LineBasedCompactor {
  languageIds = ['sql'];
  protected process(content: string): string { return processSql(content); }
}

export class VueSvelteCompactor extends LineBasedCompactor {
  languageIds = ['vue', 'svelte'];
  protected process(content: string): string { return processVueSvelte(content); }
}
