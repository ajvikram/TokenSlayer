import * as vscode from 'vscode';
import { StructuralSymbol, symbolKindToLabel } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Extracts structural symbols from a document using VS Code's built-in LSP.
 * This is a single API call per file — the fastest way to get symbol data.
 */
export class SymbolExtractor {

  /**
   * Extract all symbols from a file URI.
   * Returns a flat + hierarchical list of StructuralSymbol objects.
   */
  async extractFromUri(uri: vscode.Uri): Promise<StructuralSymbol[]> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
      );

      if (!symbols || symbols.length === 0) {
        logger.debug(`No symbols found for ${uri.fsPath}`);
        return [];
      }

      // Get the document text for signature extraction
      const document = await vscode.workspace.openTextDocument(uri);

      return this.convertSymbols(symbols, document);
    } catch (error) {
      logger.error(`Failed to extract symbols from ${uri.fsPath}`, error);
      return [];
    }
  }

  /**
   * Extract symbols from the currently active editor.
   */
  async extractFromActiveEditor(): Promise<StructuralSymbol[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      logger.warn('No active editor');
      return [];
    }
    return this.extractFromUri(editor.document.uri);
  }

  /**
   * Convert VS Code DocumentSymbol[] to our StructuralSymbol[] format.
   */
  private convertSymbols(
    symbols: vscode.DocumentSymbol[],
    document: vscode.TextDocument
  ): StructuralSymbol[] {
    return symbols.map(symbol => this.convertSymbol(symbol, document));
  }

  /**
   * Convert a single DocumentSymbol to StructuralSymbol, recursing into children.
   */
  private convertSymbol(
    symbol: vscode.DocumentSymbol,
    document: vscode.TextDocument
  ): StructuralSymbol {
    // Extract the first line of the symbol as the signature
    const signatureLine = this.extractSignature(symbol, document);

    return {
      name: symbol.name,
      kind: symbol.kind,
      kindLabel: symbolKindToLabel(symbol.kind),
      detail: symbol.detail || '',
      range: {
        startLine: symbol.range.start.line,
        endLine: symbol.range.end.line,
      },
      signatureLine,
      children: symbol.children
        ? this.convertSymbols(symbol.children, document)
        : [],
    };
  }

  /**
   * Extract a clean signature line from a symbol.
   * For functions/methods, this captures the full declaration line.
   * For classes/interfaces, this captures the declaration with extends/implements.
   */
  private extractSignature(
    symbol: vscode.DocumentSymbol,
    document: vscode.TextDocument
  ): string {
    const startLine = symbol.selectionRange.start.line;
    let signature = document.lineAt(startLine).text.trim();

    // For class/interface declarations, the extends/implements may be on the next line
    if (
      (symbol.kind === vscode.SymbolKind.Class ||
        symbol.kind === vscode.SymbolKind.Interface) &&
      !signature.includes('{')
    ) {
      // Check if the next line has extends/implements
      const nextLineNum = startLine + 1;
      if (nextLineNum < document.lineCount) {
        const nextLine = document.lineAt(nextLineNum).text.trim();
        if (nextLine.startsWith('extends') || nextLine.startsWith('implements')) {
          signature += ' ' + nextLine;
        }
      }
    }

    // Remove opening braces and trailing content
    signature = signature
      .replace(/\s*\{.*$/, '')
      .replace(/\s*:\s*$/, '')
      .trim();

    return signature;
  }
}
