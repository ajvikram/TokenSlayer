import * as vscode from 'vscode';
import { SymbolExtractor } from '../extraction/symbolExtractor';
import { SkeletonBuilder } from '../extraction/skeletonBuilder';
import { CompactorFactory } from '../compaction/compactor';
import { TokenEstimator } from '../utils/tokenEstimator';
import { Verbosity } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Virtual document provider for previewing structural skeletons.
 * Opens a read-only document showing the compact skeleton of any file.
 */
export class SkeletonPreviewProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'tokenslayer-skeleton';

  private symbolExtractor = new SymbolExtractor();
  private skeletonBuilder = new SkeletonBuilder();

  // Event to notify VS Code when content changes
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      // The original file URI is encoded in the query parameter
      const originalPath = decodeURIComponent(uri.query);
      const originalUri = vscode.Uri.file(originalPath);

      // Open the original document
      const document = await vscode.workspace.openTextDocument(originalUri);
      const content = document.getText();

      // Extract symbols
      const symbols = await this.symbolExtractor.extractFromUri(originalUri);

      // Get verbosity from settings
      const config = vscode.workspace.getConfiguration('tokenslayer');
      const verbosity: Verbosity = config.get<Verbosity>('verbosity', 'standard');

      // Build skeleton (use compactor if available, otherwise generic)
      const genericSkeleton = this.skeletonBuilder.build(
        symbols,
        originalUri.fsPath,
        document.lineCount,
        verbosity
      );

      const result = CompactorFactory.compact(
        symbols,
        content,
        originalUri.fsPath,
        document.languageId,
        genericSkeleton
      );

      // Build header with stats
      const header = [
        `// ═══════════════════════════════════════════════════════`,
        `// TokenSlayer Skeleton Preview`,
        `// ═══════════════════════════════════════════════════════`,
        `// Source:     ${originalUri.fsPath}`,
        `// Language:   ${document.languageId}`,
        `// Original:   ${document.lineCount} lines | ${TokenEstimator.formatCount(result.originalTokens)} tokens`,
        `// Skeleton:   ${result.skeleton.split('\n').length} lines | ${TokenEstimator.formatCount(result.compactedTokens)} tokens`,
        `// Reduction:  ${result.reductionPercent}% fewer tokens`,
        `// Symbols:    ${result.symbolCount} structural elements`,
        `// ═══════════════════════════════════════════════════════`,
        '',
      ].join('\n');

      return header + result.skeleton;
    } catch (error) {
      logger.error('Failed to generate skeleton preview', error);
      return `// Error generating skeleton preview: ${error}`;
    }
  }

  /**
   * Open a skeleton preview for the given file URI.
   */
  static async showPreview(fileUri?: vscode.Uri): Promise<void> {
    const targetUri = fileUri || vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      vscode.window.showWarningMessage('TokenSlayer: No file to preview');
      return;
    }

    const previewUri = vscode.Uri.parse(
      `${SkeletonPreviewProvider.scheme}:Skeleton — ${targetUri.fsPath.split(/[/\\]/).pop()}?${encodeURIComponent(targetUri.fsPath)}`
    );

    const doc = await vscode.workspace.openTextDocument(previewUri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
      preserveFocus: true,
    });
  }
}
