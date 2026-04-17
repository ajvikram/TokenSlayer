import * as vscode from 'vscode';
import { CacheManager } from '../cache/cacheManager';

/**
 * File decoration provider that adds color-coded badges to files
 * in the Explorer panel:
 *   🟢 Green  — file analyzed & cached
 *   🔴 Red    — file excluded (secrets detected)
 *   ⚪ No badge — not yet analyzed
 */
export class TokenSlayerFileDecorationProvider implements vscode.FileDecorationProvider {
  private onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event;

  constructor(private cacheManager: CacheManager) {}

  /**
   * Trigger a refresh of file decorations.
   */
  refresh(): void {
    this.onDidChangeFileDecorationsEmitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Only decorate file: scheme URIs
    if (uri.scheme !== 'file') {
      return undefined;
    }

    const filePath = uri.fsPath;

    // Check if file is excluded (secrets)
    if (this.cacheManager.isFileExcluded(filePath)) {
      return {
        badge: '🔒',
        color: new vscode.ThemeColor('errorForeground'),
        tooltip: 'TokenSlayer: Excluded — contains secrets',
        propagate: false,
      };
    }

    // Check if file is analyzed & cached
    if (this.cacheManager.isFileAnalyzed(filePath)) {
      const result = this.cacheManager.getFileResult(filePath);
      if (result) {
        return {
          badge: '⚡',
          color: new vscode.ThemeColor('charts.green'),
          tooltip: `TokenSlayer: ${result.reductionPercent}% reducible (${result.originalTokens} → ${result.compactedTokens} tokens)`,
          propagate: false,
        };
      }
    }

    return undefined;
  }
}
