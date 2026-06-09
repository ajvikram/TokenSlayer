import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';
import * as vscode from 'vscode';
import { extractLineDocComment } from './docCommentExtractor';

/**
 * Go-specific compactor.
 * Keeps type/func signatures, struct fields, and interface methods.
 * Strips function bodies.
 */
export class GoCompactor implements ICompactor {
  languageIds = ['go'];

  compact(symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const lines: string[] = [];
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;
    const fileLines = fileContent.split('\n');

    // Extract package declaration
    const packageLine = fileLines.find(l => l.trim().startsWith('package '));
    if (packageLine) {
      lines.push(packageLine.trim());
      lines.push('');
    }

    // Extract imports (compacted)
    const imports = this.extractImports(fileLines);
    if (imports.length > 0) {
      lines.push('// Imports');
      for (const imp of imports) {
        lines.push(imp);
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
    const indent = '\t'.repeat(depth);

    // Go convention: doc comments are `//` lines immediately above the symbol.
    const doc = extractLineDocComment(fileLines, symbol.range.startLine, '//');

    switch (symbol.kind) {
      case vscode.SymbolKind.Struct:
        if (doc) { lines.push(`${indent}// ${doc}`); }
        lines.push(`${indent}type ${symbol.name} struct {`);
        for (const child of symbol.children) {
          lines.push(`${indent}\t${child.signatureLine}`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Interface:
        if (doc) { lines.push(`${indent}// ${doc}`); }
        lines.push(`${indent}type ${symbol.name} interface {`);
        for (const child of symbol.children) {
          lines.push(`${indent}\t${child.signatureLine}`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Function:
      case vscode.SymbolKind.Method:
        if (doc) { lines.push(`${indent}// ${doc}`); }
        lines.push(`${indent}${symbol.signatureLine} { /* ... */ }`);
        break;

      case vscode.SymbolKind.Constant:
      case vscode.SymbolKind.Variable:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;

      case vscode.SymbolKind.Class:
        if (doc) { lines.push(`${indent}// ${doc}`); }
        // Go uses 'type X struct' — sometimes LSP reports classes
        lines.push(`${indent}type ${symbol.name} struct {`);
        for (const child of symbol.children) {
          lines.push(`${indent}\t${child.signatureLine}`);
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
   * Extract Go import statements.
   */
  private extractImports(fileLines: string[]): string[] {
    const imports: string[] = [];
    let inImportBlock = false;

    for (const line of fileLines) {
      const trimmed = line.trim();

      if (trimmed === 'import (') {
        inImportBlock = true;
        continue;
      }

      if (inImportBlock) {
        if (trimmed === ')') {
          inImportBlock = false;
          break;
        }
        if (trimmed.length > 0) {
          imports.push(`import ${trimmed}`);
        }
        continue;
      }

      if (trimmed.startsWith('import "') || trimmed.startsWith('import `')) {
        imports.push(trimmed);
      }
    }

    return imports;
  }
}
