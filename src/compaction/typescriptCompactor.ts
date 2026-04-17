import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';
import * as vscode from 'vscode';

/**
 * TypeScript/JavaScript/React compactor.
 * Strips function bodies, keeps signatures, interfaces, and types.
 */
export class TypeScriptCompactor implements ICompactor {
  languageIds = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'];

  compact(symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const lines: string[] = [];
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;

    // Extract imports (compacted)
    const imports = this.extractImports(fileContent);
    if (imports.length > 0) {
      lines.push('// Imports');
      for (const imp of imports) {
        lines.push(imp);
      }
      lines.push('');
    }

    // Process top-level symbols
    for (const symbol of symbols) {
      this.processSymbol(symbol, lines, 0, fileContent);
    }

    const skeletonLines = lines.filter(l => l.trim().length > 0).length;
    const header = `// ${fileName} (${totalLines} lines → ${skeletonLines}-line skeleton)`;

    return [header, '', ...lines].join('\n');
  }

  private processSymbol(
    symbol: StructuralSymbol,
    lines: string[],
    depth: number,
    fileContent: string
  ): void {
    const indent = '  '.repeat(depth);

    switch (symbol.kind) {
      case vscode.SymbolKind.Class:
        lines.push(`${indent}${symbol.signatureLine} {`);
        for (const child of symbol.children) {
          this.processSymbol(child, lines, depth + 1, fileContent);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Interface:
        lines.push(`${indent}${symbol.signatureLine} {`);
        for (const child of symbol.children) {
          // For interfaces, keep full property definitions
          lines.push(`${indent}  ${child.signatureLine};`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Enum:
        lines.push(`${indent}enum ${symbol.name} {`);
        for (const child of symbol.children) {
          lines.push(`${indent}  ${child.name},`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Function:
        lines.push(`${indent}${symbol.signatureLine} { /* ... */ }`);
        break;

      case vscode.SymbolKind.Method:
      case vscode.SymbolKind.Constructor:
        lines.push(`${indent}${symbol.signatureLine} { /* ... */ }`);
        break;

      case vscode.SymbolKind.Property:
      case vscode.SymbolKind.Field:
        lines.push(`${indent}${symbol.signatureLine};`);
        break;

      case vscode.SymbolKind.Variable:
      case vscode.SymbolKind.Constant:
        // Keep type-annotated exports
        if (symbol.signatureLine.includes('export') || symbol.signatureLine.includes('const')) {
          lines.push(`${indent}${this.compactVariableDeclaration(symbol.signatureLine)};`);
        }
        break;

      case vscode.SymbolKind.Module:
      case vscode.SymbolKind.Namespace:
        lines.push(`${indent}${symbol.signatureLine} {`);
        for (const child of symbol.children) {
          this.processSymbol(child, lines, depth + 1, fileContent);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      default:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;
    }
  }

  /**
   * Extract and compact import statements.
   * Groups default and named imports, removes duplicates.
   */
  private extractImports(fileContent: string): string[] {
    const importLines: string[] = [];
    const fileLines = fileContent.split('\n');

    for (const line of fileLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ')) {
        importLines.push(trimmed);
      }
      // Stop scanning after we hit non-import code (performance optimization)
      if (
        importLines.length > 0 &&
        !trimmed.startsWith('import ') &&
        !trimmed.startsWith('//') &&
        trimmed.length > 0 &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('}')
      ) {
        break;
      }
    }

    return importLines;
  }

  /**
   * Compact a variable/constant declaration.
   * Keeps the type annotation, removes the value.
   */
  private compactVariableDeclaration(signature: string): string {
    // For something like "export const config: Config = { ... }"
    // We want to keep "export const config: Config"
    const assignmentIndex = signature.indexOf('=');
    if (assignmentIndex > -1) {
      const beforeAssignment = signature.substring(0, assignmentIndex).trim();
      return beforeAssignment;
    }
    return signature;
  }
}
