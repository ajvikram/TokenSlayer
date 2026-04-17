import * as vscode from 'vscode';
import { CacheManager } from '../cache/cacheManager';

/**
 * CodeLens provider that shows inline token reduction stats
 * above classes, functions, and interfaces in the editor.
 */
export class TokenSlayerCodeLensProvider implements vscode.CodeLensProvider {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(private cacheManager: CacheManager) {}

  /**
   * Notify that CodeLenses need refreshing.
   */
  refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    // Only show for supported file types
    const supportedLanguages = new Set([
      'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
      'python', 'go', 'java', 'rust',
    ]);
    if (!supportedLanguages.has(document.languageId)) {
      return lenses;
    }

    const result = this.cacheManager.getFileResult(document.uri.fsPath);
    if (!result) {
      return lenses;
    }

    // Show a CodeLens at the top of the file with overall stats
    const topRange = new vscode.Range(0, 0, 0, 0);
    lenses.push(
      new vscode.CodeLens(topRange, {
        title: `⚡ ${result.reductionPercent}% reducible — ${result.originalTokens.toLocaleString()} → ${result.compactedTokens.toLocaleString()} tokens`,
        command: 'tokenslayer.showSkeleton',
        tooltip: 'Click to preview the structural skeleton',
      })
    );

    // Get document symbols and add CodeLens to top-level symbols
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      );

      if (symbols) {
        for (const symbol of symbols) {
          // Only annotate classes, interfaces, functions (not variables/constants)
          if (
            symbol.kind === vscode.SymbolKind.Class ||
            symbol.kind === vscode.SymbolKind.Interface ||
            symbol.kind === vscode.SymbolKind.Function ||
            symbol.kind === vscode.SymbolKind.Module ||
            symbol.kind === vscode.SymbolKind.Enum
          ) {
            const lineCount = symbol.range.end.line - symbol.range.start.line + 1;
            const originalTokens = Math.round(lineCount * 10); // ~10 tokens per line estimate
            const compactedTokens = Math.round(originalTokens * (1 - result.reductionPercent / 100));

            lenses.push(
              new vscode.CodeLens(symbol.range, {
                title: `⚡ ~${lineCount} lines → ~${Math.max(1, Math.round(lineCount * (1 - result.reductionPercent / 100)))} lines skeleton`,
                command: 'tokenslayer.showSkeleton',
                tooltip: `${symbol.name}: approximately ${result.reductionPercent}% reducible`,
              })
            );
          }
        }
      }
    } catch {
      // Symbol provider not available — just show file-level CodeLens
    }

    return lenses;
  }
}
