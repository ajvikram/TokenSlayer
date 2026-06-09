/**
 * Shared doc-comment extractor.
 *
 * Each compactor uses this to pull a one-line summary from the JSDoc/Javadoc/
 * KDoc/Rustdoc/CSDoc/Go-comment that precedes a symbol. We keep ONE line —
 * enough to convey intent without inflating the skeleton.
 */

const MAX_DOC_LEN = 120;

/**
 * Pull the first meaningful line out of a `/** ... *​/` block doc-comment
 * immediately above the symbol. Works for JSDoc, Javadoc, KDoc.
 *
 * Returns null if no doc-comment is found.
 */
export function extractBlockDocComment(
  fileLines: string[],
  symbolStartLine: number
): string | null {
  // Walk backwards over blank lines and decorators/annotations to find the
  // end of a `*​/` block, if any.
  let idx = symbolStartLine - 1;
  while (idx >= 0) {
    const line = fileLines[idx]?.trim() ?? '';
    if (line === '' || line.startsWith('@')) { idx--; continue; }
    if (line.endsWith('*/')) { break; }
    return null;
  }
  if (idx < 0) { return null; }

  // Find the matching `/**` start.
  let start = idx;
  while (start >= 0 && !fileLines[start].includes('/**')) { start--; }
  if (start < 0) { return null; }

  // First non-empty line of doc content.
  for (let j = start; j <= idx; j++) {
    const raw = fileLines[j].trim();
    const cleaned = raw
      .replace(/^\/\*\*+/, '')
      .replace(/\*+\/\s*$/, '')
      .replace(/^\*+\s?/, '')
      .trim();
    if (cleaned && !cleaned.startsWith('@')) {
      return clamp(cleaned);
    }
  }
  return null;
}

/**
 * Pull the first meaningful line out of consecutive line-style doc-comments
 * immediately above the symbol (`///` for Rust/C#, `//` for Go).
 *
 * The marker is matched exactly at the start (after trimming) — `//` will NOT
 * match `///`, so caller must pass the exact prefix.
 */
export function extractLineDocComment(
  fileLines: string[],
  symbolStartLine: number,
  marker: '///' | '//'
): string | null {
  let idx = symbolStartLine - 1;
  // Skip blanks and decorators/attributes.
  while (idx >= 0) {
    const t = fileLines[idx]?.trim() ?? '';
    if (t === '' || t.startsWith('#[') || t.startsWith('[') || t.startsWith('@')) {
      idx--; continue;
    }
    break;
  }

  const collected: string[] = [];
  while (idx >= 0) {
    const t = fileLines[idx]?.trim() ?? '';
    // Match the marker but reject longer markers (// must not match ///).
    if (t.startsWith(marker) && (marker === '///' || !t.startsWith('///'))) {
      collected.unshift(stripMarker(t, marker));
      idx--;
    } else {
      break;
    }
  }

  if (collected.length === 0) { return null; }

  // For C# XML doc-comments, prefer the <summary> contents if present.
  if (marker === '///') {
    const joined = collected.join(' ');
    const summaryMatch = joined.match(/<summary>\s*(.*?)\s*<\/summary>/i);
    if (summaryMatch && summaryMatch[1]) {
      return clamp(summaryMatch[1].trim());
    }
  }

  // First non-empty content line.
  for (const line of collected) {
    const cleaned = line.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '').trim();
    if (cleaned) { return clamp(cleaned); }
  }
  return null;
}

function stripMarker(line: string, marker: string): string {
  return line.slice(marker.length).replace(/^\s/, '').trim();
}

function clamp(s: string): string {
  if (s.length <= MAX_DOC_LEN) { return s; }
  return s.slice(0, MAX_DOC_LEN - 1).trimEnd() + '…';
}
