import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';

/**
 * HTML compactor.
 *
 * Keeps the structural skeleton (tags, attributes, ids, classes, ARIA, data-*)
 * while eliding long text nodes inside generic containers (<p>, <div>, <span>...).
 * Text inside structural label tags (<title>, <h1>..<h6>, <label>, <button>,
 * <a>, etc.) is preserved — that text IS the signal a reader needs.
 *
 * Operates on text directly; the LSP symbol tree for HTML is sparse and the
 * line-based approach yields a more useful skeleton.
 */
export class HtmlCompactor implements ICompactor {
  languageIds = ['html'];

  private static readonly PRESERVE_TEXT_TAGS =
    /^(title|h[1-6]|label|button|a|li|option|summary|caption|legend|th|td)$/i;

  compact(_symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;
    const skeletonLines = this.processLines(fileContent.split('\n'));
    const header = `<!-- ${fileName} (${totalLines} lines → ${skeletonLines.length}-line skeleton) -->`;
    return [header, '', ...skeletonLines].join('\n');
  }

  private processLines(lines: string[]): string[] {
    const out: string[] = [];
    let inComment = false;
    let inScript = false;
    let inStyle = false;

    for (const raw of lines) {
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

      if (inScript) {
        if (/<\/script\s*>/i.test(line)) { inScript = false; out.push(raw); }
        continue;
      }
      if (inStyle) {
        if (/<\/style\s*>/i.test(line)) { inStyle = false; out.push(raw); }
        continue;
      }
      if (/<script\b/i.test(line) && !/<\/script\s*>/i.test(line)) {
        out.push(raw); inScript = true; continue;
      }
      if (/<style\b/i.test(line) && !/<\/style\s*>/i.test(line)) {
        out.push(raw); inStyle = true; continue;
      }

      if (/^<!doctype/i.test(line)) { out.push(raw); continue; }

      if (line.includes('<')) {
        const compacted = raw.replace(
          /<([A-Za-z][\w-]*)((?:\s[^>]*)?)>([^<>]{12,})<\/\1>/g,
          (_m, tag, attrs, text) =>
            HtmlCompactor.PRESERVE_TEXT_TAGS.test(tag)
              ? `<${tag}${attrs}>${text}</${tag}>`
              : `<${tag}${attrs}>…</${tag}>`
        );
        out.push(compacted);
        continue;
      }
      // Pure text content with no tags — drop.
    }
    return out;
  }
}
