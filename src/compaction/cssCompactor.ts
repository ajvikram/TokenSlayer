import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';

/**
 * CSS / SCSS / Less / Sass compactor.
 *
 * Keeps:
 *   - Selectors (lines ending in `{` or `,`)
 *   - At-rules: @media, @keyframes, @import, @charset, @font-face, @supports, @page
 *   - Closing braces (preserves nested structure)
 *   - CSS custom-property declarations (`--name: value;`) at top level —
 *     they are the design tokens and carry real signal.
 *
 * Strips: property:value declarations inside rule bodies; block + line comments.
 *
 * Operates on text directly because the CSS LSP symbol tree is shallow and
 * a line-based scan preserves more meaningful structure.
 */
export class CssCompactor implements ICompactor {
  languageIds = ['css', 'scss', 'sass', 'less'];

  compact(_symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;
    const skeleton = this.processLines(fileContent.split('\n'));
    const header = `/* ${fileName} (${totalLines} lines → ${skeleton.length}-line skeleton) */`;
    return [header, '', ...skeleton].join('\n');
  }

  private processLines(lines: string[]): string[] {
    const out: string[] = [];
    let inBlockComment = false;
    let depth = 0;

    for (const raw of lines) {
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

      if (line.startsWith('@')) {
        out.push(raw);
        depth += opens - closes;
        if (depth < 0) { depth = 0; }
        continue;
      }

      if (line.endsWith('{') || line.endsWith(',')) {
        out.push(raw);
        depth += opens - closes;
        if (depth < 0) { depth = 0; }
        continue;
      }

      if (line.startsWith('}')) {
        out.push(raw);
        depth -= closes;
        if (depth < 0) { depth = 0; }
        continue;
      }

      // Top-level custom properties (design tokens) — keep.
      if (depth <= 1 && /^--[\w-]+\s*:/.test(line)) {
        out.push(raw);
        continue;
      }

      // Property:value inside a rule body — drop.
    }
    return out;
  }
}
