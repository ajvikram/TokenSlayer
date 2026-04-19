import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';
import * as vscode from 'vscode';

/**
 * C#-specific compactor.
 * Keeps class/interface/struct/record declarations, method signatures,
 * properties, and important attributes. Strips method bodies.
 */
export class CSharpCompactor implements ICompactor {
  languageIds = ['csharp'];

  compact(symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const lines: string[] = [];
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;
    const fileLines = fileContent.split('\n');

    // Extract using directives
    const usings = this.extractUsings(fileLines);
    if (usings.length > 0) {
      lines.push('// Usings');
      for (const using of usings) {
        lines.push(using);
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
      case vscode.SymbolKind.Namespace:
        lines.push(`${indent}${symbol.signatureLine}`);
        lines.push(`${indent}{`);
        for (const child of symbol.children) {
          this.processSymbol(child, lines, depth + 1, fileLines);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Class:
      case vscode.SymbolKind.Interface:
      case vscode.SymbolKind.Struct:
        const classAttributes = this.extractAttributes(fileLines, symbol.range.startLine);
        for (const attr of classAttributes) {
          lines.push(`${indent}${attr}`);
        }
        lines.push(`${indent}${symbol.signatureLine}`);
        lines.push(`${indent}{`);
        for (const child of symbol.children) {
          this.processSymbol(child, lines, depth + 1, fileLines);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Enum:
        lines.push(`${indent}enum ${symbol.name}`);
        lines.push(`${indent}{`);
        for (const child of symbol.children) {
          lines.push(`${indent}    ${child.name},`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Method:
      case vscode.SymbolKind.Constructor:
        const methodAttributes = this.extractAttributes(fileLines, symbol.range.startLine);
        for (const attr of methodAttributes) {
          lines.push(`${indent}${attr}`);
        }
        lines.push(`${indent}${symbol.signatureLine} { /* ... */ }`);
        break;

      case vscode.SymbolKind.Property:
      case vscode.SymbolKind.Field:
      case vscode.SymbolKind.Event:
        lines.push(`${indent}${symbol.signatureLine};`);
        break;

      case vscode.SymbolKind.Constant:
        lines.push(`${indent}${symbol.signatureLine};`);
        break;

      default:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;
    }
  }

  /**
   * Extract C# using statements.
   */
  private extractUsings(fileLines: string[]): string[] {
    const usings: string[] = [];

    for (const line of fileLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('using ')) {
        usings.push(trimmed);
      }
      // Stop scanning when we hit a namespace or class
      if (
        trimmed.startsWith('namespace ') ||
        trimmed.includes(' class ') ||
        trimmed.includes(' interface ')
      ) {
        break;
      }
    }

    return usings;
  }

  /**
   * Extract attributes above a symbol (e.g., [ApiController], [Route("...")]).
   */
  private extractAttributes(fileLines: string[], symbolStartLine: number): string[] {
    const attributes: string[] = [];
    let lineIdx = symbolStartLine - 1;

    while (lineIdx >= 0) {
      const line = fileLines[lineIdx]?.trim() || '';
      if (line.startsWith('[')) {
        attributes.unshift(line);
        lineIdx--;
      } else if (line === '' || line.startsWith('//') || line.startsWith('/*')) {
        lineIdx--;
      } else {
        break;
      }
    }

    // Filter to important architectural/routing attributes
    return attributes.filter(a =>
      a.includes('Route') ||
      a.includes('ApiController') ||
      a.includes('HttpGet') ||
      a.includes('HttpPost') ||
      a.includes('HttpPut') ||
      a.includes('HttpDelete') ||
      a.includes('HttpPatch') ||
      a.includes('Authorize') ||
      a.includes('AllowAnonymous') ||
      a.includes('Fact') ||
      a.includes('Theory') ||
      a.includes('Test') ||
      a.includes('Obsolete') ||
      a.includes('Serializable') ||
      a.includes('Table') ||
      a.includes('Column') ||
      a.includes('Key')
    );
  }
}
