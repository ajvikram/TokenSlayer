import * as fs from 'fs';
import * as path from 'path';

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

    if (!trimmed || (trimmed.startsWith('//') && !trimmed.startsWith('///'))) {
      tagged.push(line);
      continue;
    }

    if (/\/\* EXPAND:\S+ \*\//.test(line)) {
      tagged.push(line);
      continue;
    }

    const kind = classifyLine(trimmed);
    if (kind) {
      const match = findOriginalLine(trimmed, originalLines);
      if (match) {
        const endLine = kind === 'import' ? match.line + 1 :
                        findBlockEnd(originalLines, match.line);
        const nodeId = Buffer.from(`${filePath}:${match.line + 1}:${endLine}:${kind}`).toString('base64url');
        tagged.push(`${line} /* NODE:${nodeId} */`);
        continue;
      }
    }

    tagged.push(line);
  }

  return tagged.join('\n');
}

type NodeKind = 'sig' | 'body' | 'import' | 'decl';

function classifyLine(trimmed: string): NodeKind | null {
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

/**
 * Decode a node ID to its file path, line range, and kind.
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
