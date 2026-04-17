import * as vscode from 'vscode';
import { StructuralSymbol, Verbosity } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Builds a compact textual skeleton from extracted symbols.
 * Produces a human-readable tree structure that captures
 * architecture without implementation details.
 */
export class SkeletonBuilder {

  /**
   * Build a skeleton string from symbols.
   */
  build(
    symbols: StructuralSymbol[],
    filePath: string,
    totalLines: number,
    verbosity: Verbosity = 'standard'
  ): string {
    if (symbols.length === 0) {
      return `// ${this.basename(filePath)} — no symbols found`;
    }

    const lines: string[] = [];

    // Header
    const skeletonLineCount = this.estimateSkeletonLines(symbols);
    lines.push(
      `// ${this.basename(filePath)} (${totalLines} lines → ${skeletonLineCount}-line skeleton)`
    );
    lines.push('');

    // Build each top-level symbol
    for (const symbol of symbols) {
      this.buildSymbolLines(symbol, lines, 0, verbosity);
    }

    return lines.join('\n');
  }

  /**
   * Recursively build lines for a symbol and its children.
   */
  private buildSymbolLines(
    symbol: StructuralSymbol,
    lines: string[],
    depth: number,
    verbosity: Verbosity
  ): void {
    const indent = '  '.repeat(depth);

    // Decide what to render based on symbol kind
    switch (symbol.kind) {
      case vscode.SymbolKind.Class:
      case vscode.SymbolKind.Struct:
        lines.push(`${indent}${symbol.signatureLine}`);
        this.buildChildrenLines(symbol.children, lines, depth + 1, verbosity);
        lines.push('');
        break;

      case vscode.SymbolKind.Interface:
        lines.push(`${indent}${symbol.signatureLine}`);
        if (verbosity !== 'minimal') {
          this.buildChildrenLines(symbol.children, lines, depth + 1, verbosity);
        }
        lines.push('');
        break;

      case vscode.SymbolKind.Enum:
        lines.push(`${indent}enum ${symbol.name}`);
        if (verbosity !== 'minimal') {
          for (const member of symbol.children) {
            lines.push(`${indent}  ${member.name}`);
          }
        } else {
          lines.push(`${indent}  (${symbol.children.length} members)`);
        }
        lines.push('');
        break;

      case vscode.SymbolKind.Function:
      case vscode.SymbolKind.Method:
      case vscode.SymbolKind.Constructor:
        const prefix = this.getTreePrefix(symbol, depth);
        lines.push(`${indent}${prefix}${symbol.signatureLine}`);
        break;

      case vscode.SymbolKind.Property:
      case vscode.SymbolKind.Field:
        if (verbosity !== 'minimal') {
          const propPrefix = this.getTreePrefix(symbol, depth);
          lines.push(`${indent}${propPrefix}${symbol.signatureLine}`);
        }
        break;

      case vscode.SymbolKind.Variable:
      case vscode.SymbolKind.Constant:
        if (verbosity === 'detailed') {
          lines.push(`${indent}${symbol.signatureLine}`);
        }
        break;

      case vscode.SymbolKind.Module:
      case vscode.SymbolKind.Namespace:
        lines.push(`${indent}${symbol.signatureLine}`);
        this.buildChildrenLines(symbol.children, lines, depth + 1, verbosity);
        lines.push('');
        break;

      default:
        if (verbosity === 'detailed') {
          lines.push(`${indent}${symbol.signatureLine}`);
        }
        break;
    }
  }

  /**
   * Build lines for child symbols with tree connectors.
   */
  private buildChildrenLines(
    children: StructuralSymbol[],
    lines: string[],
    depth: number,
    verbosity: Verbosity
  ): void {
    for (const child of children) {
      this.buildSymbolLines(child, lines, depth, verbosity);
    }
  }

  /**
   * Get a tree-drawing prefix for nested symbols.
   */
  private getTreePrefix(symbol: StructuralSymbol, depth: number): string {
    if (depth === 0) {
      return '';
    }
    return '├─ ';
  }

  /**
   * Get the basename of a file path.
   */
  private basename(filePath: string): string {
    return filePath.split(/[/\\]/).pop() || filePath;
  }

  /**
   * Estimate how many lines the skeleton will produce.
   */
  private estimateSkeletonLines(symbols: StructuralSymbol[]): number {
    let count = 0;
    for (const symbol of symbols) {
      count += 1; // The symbol itself
      if (symbol.children.length > 0) {
        count += this.estimateSkeletonLines(symbol.children);
      }
    }
    return count;
  }
}
