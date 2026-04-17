import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';
import * as vscode from 'vscode';

/**
 * Rust-specific compactor.
 * Keeps struct/enum/trait/impl declarations, function signatures,
 * type aliases, and important attributes. Strips function bodies.
 */
export class RustCompactor implements ICompactor {
  languageIds = ['rust'];

  compact(symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const lines: string[] = [];
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;
    const fileLines = fileContent.split('\n');

    // Extract use statements (compacted)
    const uses = this.extractUseStatements(fileLines);
    if (uses.length > 0) {
      lines.push('// Use statements');
      for (const u of uses) {
        lines.push(u);
      }
      lines.push('');
    }

    // Extract mod declarations
    const mods = fileLines.filter(l => l.trim().startsWith('mod ') && !l.trim().startsWith('mod test'));
    if (mods.length > 0) {
      for (const m of mods) {
        lines.push(m.trim());
      }
      lines.push('');
    }

    // Process top-level symbols
    for (const symbol of symbols) {
      this.processSymbol(symbol, lines, 0, fileLines);
    }

    const skeletonLines = lines.filter(l => l.trim().length > 0).length;
    const header = `// ${fileName} (${totalLines} lines → ${skeletonLines}-line skeleton)`;

    return [header, '', ...lines].join('\n');
  }

  private processSymbol(
    symbol: StructuralSymbol,
    lines: string[],
    depth: number,
    fileLines: string[]
  ): void {
    const indent = '    '.repeat(depth);

    switch (symbol.kind) {
      case vscode.SymbolKind.Struct:
      case vscode.SymbolKind.Class:
        // Check for derive macros
        const structAttrs = this.extractAttributes(fileLines, symbol.range.startLine);
        for (const attr of structAttrs) {
          lines.push(`${indent}${attr}`);
        }
        lines.push(`${indent}${symbol.signatureLine} {`);
        for (const child of symbol.children) {
          lines.push(`${indent}    ${child.signatureLine},`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Enum:
        const enumAttrs = this.extractAttributes(fileLines, symbol.range.startLine);
        for (const attr of enumAttrs) {
          lines.push(`${indent}${attr}`);
        }
        lines.push(`${indent}enum ${symbol.name} {`);
        for (const child of symbol.children) {
          lines.push(`${indent}    ${child.signatureLine},`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Interface:
        // Rust traits
        lines.push(`${indent}${symbol.signatureLine} {`);
        for (const child of symbol.children) {
          if (child.kind === vscode.SymbolKind.Method || child.kind === vscode.SymbolKind.Function) {
            lines.push(`${indent}    ${child.signatureLine};`);
          } else {
            lines.push(`${indent}    ${child.signatureLine}`);
          }
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Module:
        // impl blocks
        lines.push(`${indent}${symbol.signatureLine} {`);
        for (const child of symbol.children) {
          this.processSymbol(child, lines, depth + 1, fileLines);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Function:
      case vscode.SymbolKind.Method:
        const fnAttrs = this.extractAttributes(fileLines, symbol.range.startLine);
        for (const attr of fnAttrs) {
          lines.push(`${indent}${attr}`);
        }
        lines.push(`${indent}${symbol.signatureLine} { /* ... */ }`);
        break;

      case vscode.SymbolKind.Constant:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;

      case vscode.SymbolKind.TypeParameter:
      case vscode.SymbolKind.Variable:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;

      default:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;
    }
  }

  /**
   * Extract `use` statements from the top of the file.
   */
  private extractUseStatements(fileLines: string[]): string[] {
    const uses: string[] = [];

    for (const line of fileLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('use ')) {
        uses.push(trimmed);
      }
      // Stop after use section (but skip empty lines, comments, mods)
      if (
        uses.length > 0 &&
        !trimmed.startsWith('use ') &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('mod ') &&
        !trimmed.startsWith('#') &&
        trimmed.length > 0
      ) {
        break;
      }
    }

    return uses;
  }

  /**
   * Extract Rust attributes above a symbol (#[derive(...)], #[test], #[cfg(...)], etc.)
   */
  private extractAttributes(fileLines: string[], symbolStartLine: number): string[] {
    const attributes: string[] = [];
    let lineIdx = symbolStartLine - 1;

    while (lineIdx >= 0) {
      const line = fileLines[lineIdx]?.trim() || '';
      if (line.startsWith('#[') || line.startsWith('#![')) {
        attributes.unshift(line);
        lineIdx--;
      } else if (line === '' || line.startsWith('//')) {
        lineIdx--;
      } else {
        break;
      }
    }

    // Keep important attributes
    return attributes.filter(a =>
      a.includes('derive') ||
      a.includes('cfg') ||
      a.includes('test') ||
      a.includes('async_trait') ||
      a.includes('serde') ||
      a.includes('tokio') ||
      a.includes('allow') ||
      a.includes('deny') ||
      a.includes('macro_export') ||
      a.includes('repr') ||
      a.includes('inline')
    );
  }
}
