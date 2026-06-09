import * as fs from 'fs';
import * as path from 'path';

/**
 * Extract raw import module specifiers from source content.
 */
export function extractImportSpecifiers(content: string, language: string): string[] {
  const specifiers: string[] = [];

  if (language === 'typescript' || language === 'javascript' ||
      language === 'typescriptreact' || language === 'javascriptreact') {
    for (const m of content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specifiers.push(m[1]);
    for (const m of content.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) specifiers.push(m[1]);
    for (const m of content.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(m[1]);
  } else if (language === 'python') {
    for (const m of content.matchAll(/^\s*from\s+(\S+)\s+import/gm)) specifiers.push(m[1]);
    for (const m of content.matchAll(/^\s*import\s+(\S+)/gm)) specifiers.push(m[1]);
  } else if (language === 'go') {
    for (const m of content.matchAll(/["']([^"']+)["']/g)) {
      if (m[1].includes('/') || m[1].includes('.')) specifiers.push(m[1]);
    }
  } else if (language === 'rust') {
    for (const m of content.matchAll(/^\s*use\s+(crate::\S+?);/gm)) specifiers.push(m[1]);
    for (const m of content.matchAll(/^\s*use\s+(super::\S+?);/gm)) specifiers.push(m[1]);
    for (const m of content.matchAll(/^\s*mod\s+(\w+)\s*;/gm)) specifiers.push(`mod::${m[1]}`);
  } else if (language === 'csharp' || language === 'kotlin' || language === 'java') {
    // Namespace-based — can't reliably resolve to files without a build system
  }

  return [...new Set(specifiers)];
}

/**
 * Resolve an import specifier to an actual file path.
 * Returns null for external/package imports.
 */
export function resolveImport(specifier: string, fromFile: string, language: string): string | null {
  const dir = path.dirname(fromFile);

  if (language === 'typescript' || language === 'javascript' ||
      language === 'typescriptreact' || language === 'javascriptreact') {
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
 * Map a VS Code languageId to the simplified language key used by the resolver.
 */
function normalizeLanguage(languageId: string): string {
  if (['typescriptreact', 'javascriptreact'].includes(languageId)) return languageId;
  return languageId;
}

/**
 * Build a dependency chain from a seed file via BFS import traversal.
 * Returns an ordered list of resolved file paths (seed first).
 */
export function buildDependencyChain(seedFile: string, languageId: string, maxDepth: number = 2): string[] {
  const MAX_FILES = 20;
  const visited = new Set<string>();
  const resultPaths: string[] = [];

  interface QueueItem { filePath: string; depth: number }
  const queue: QueueItem[] = [{ filePath: path.resolve(seedFile), depth: 0 }];

  while (queue.length > 0 && resultPaths.length < MAX_FILES) {
    const { filePath, depth } = queue.shift()!;
    const resolved = path.resolve(filePath);
    if (visited.has(resolved)) continue;
    visited.add(resolved);

    resultPaths.push(resolved);
    if (depth >= maxDepth) continue;

    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      const lang = normalizeLanguage(languageId);
      const specifiers = extractImportSpecifiers(content, lang);

      for (const spec of specifiers) {
        const dep = resolveImport(spec, resolved, lang);
        if (dep && !visited.has(path.resolve(dep))) {
          queue.push({ filePath: dep, depth: depth + 1 });
        }
      }
    } catch { /* ignore read errors */ }
  }

  return resultPaths;
}
