import * as vscode from 'vscode';
import { StructuralSummaryInput, Verbosity } from '../types';
import { SymbolExtractor } from '../extraction/symbolExtractor';
import { SkeletonBuilder } from '../extraction/skeletonBuilder';
import { CompactorFactory } from '../compaction/compactor';
import { CacheManager } from '../cache/cacheManager';
import { TokenEstimator } from '../utils/tokenEstimator';
import { SecretsDetector } from '../utils/secretsDetector';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Language Model Tool implementation for TokenSlayer.
 * Registered as 'tokenslayer-structural-summary' so Copilot
 * can call it to get compact structural context.
 */
export class StructuralSummaryTool implements vscode.LanguageModelTool<StructuralSummaryInput> {
  private symbolExtractor: SymbolExtractor;
  private skeletonBuilder: SkeletonBuilder;
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.symbolExtractor = new SymbolExtractor();
    this.skeletonBuilder = new SkeletonBuilder();
    this.cacheManager = cacheManager;
  }

  /**
   * Called before invocation to show the user what will happen.
   */
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<StructuralSummaryInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const input = options.input;
    const scope = input.scope || 'file';
    const targetPath = input.filePath || 'active editor';

    return {
      invocationMessage: `Analyzing ${scope} structure: ${targetPath}`,
    };
  }

  /**
   * Core tool invocation — extract, compact, cache, return.
   */
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<StructuralSummaryInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const input = options.input;
    const scope = input.scope || 'file';
    const verbosity: Verbosity = input.verbosity || this.getDefaultVerbosity();

    logger.info(`Tool invoked: scope=${scope}, verbosity=${verbosity}, path=${input.filePath}`);

    try {
      let results: string[];

      switch (scope) {
        case 'file':
          results = [await this.analyzeFile(input.filePath, verbosity, token)];
          break;
        case 'directory':
          results = await this.analyzeDirectory(input.filePath, verbosity, token);
          break;
        case 'workspace':
          results = await this.analyzeWorkspace(verbosity, token);
          break;
        default:
          results = [await this.analyzeFile(input.filePath, verbosity, token)];
      }

      const combined = results.filter(r => r.length > 0).join('\n\n---\n\n');

      if (combined.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('No structural information available for the requested scope.'),
        ]);
      }

      // Add summary header
      const savings = this.cacheManager.getSavings();
      const header = `[TokenSlayer] ${results.length} file(s) analyzed | ${TokenEstimator.formatCount(savings.totalSaved)} tokens saved this session\n\n`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(header + combined),
      ]);

    } catch (error) {
      logger.error('Tool invocation failed', error);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error analyzing structure: ${error}`),
      ]);
    }
  }

  /**
   * Analyze a single file.
   */
  async analyzeFile(
    filePath: string | undefined,
    verbosity: Verbosity,
    token: vscode.CancellationToken
  ): Promise<string> {
    let uri: vscode.Uri;

    if (filePath) {
      // Resolve the path
      if (filePath.startsWith('/') || filePath.includes(':')) {
        uri = vscode.Uri.file(filePath);
      } else {
        // Workspace-relative
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          return 'No workspace folder open';
        }
        uri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
      }
    } else {
      // Use active editor
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return 'No active editor and no filePath specified';
      }
      uri = editor.document.uri;
    }

    if (token.isCancellationRequested) { return ''; }

    // Check file size limit
    const config = vscode.workspace.getConfiguration('tokenslayer');
    const maxSizeKB = config.get<number>('maxFileSizeKB', 500);

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > maxSizeKB * 1024) {
        logger.debug(`Skipping ${uri.fsPath} — exceeds max size (${Math.round(stat.size / 1024)}KB)`);
        return `// ${uri.fsPath} — skipped (${Math.round(stat.size / 1024)}KB exceeds ${maxSizeKB}KB limit)`;
      }
    } catch {
      return `// ${uri.fsPath} — file not found`;
    }

    // Read file content for cache key + compaction
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();

    // ── Secrets Detection ──────────────────────────────────────────────
    const secretsScan = SecretsDetector.scan(uri.fsPath, content);
    if (secretsScan.hasSecrets) {
      this.cacheManager.addExcludedFile(uri.fsPath, secretsScan.reasons, secretsScan.severity);
      const fileName = uri.fsPath.split(/[/\\]/).pop();
      logger.warn(`BLOCKED: ${fileName} contains secrets (${secretsScan.reasons.join(', ')})`);
      return `// ${fileName} — EXCLUDED (contains ${secretsScan.severity}-severity secrets)`;
    }

    const cacheKey = this.cacheManager.generateKey(uri.fsPath, content);

    // Check cache
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for ${uri.fsPath}`);
      return cached.skeleton;
    }

    if (token.isCancellationRequested) { return ''; }

    // Extract symbols
    const symbols = await this.symbolExtractor.extractFromUri(uri);

    // Build generic skeleton
    const genericSkeleton = this.skeletonBuilder.build(
      symbols,
      uri.fsPath,
      document.lineCount,
      verbosity
    );

    // Run domain-specific compaction
    const result = CompactorFactory.compact(
      symbols,
      content,
      uri.fsPath,
      document.languageId,
      genericSkeleton
    );

    // Cache the result
    const contentHash = cacheKey.split('::')[1];
    this.cacheManager.set(cacheKey, uri.fsPath, contentHash, result);

    logger.info(
      `Analyzed ${uri.fsPath}: ${result.originalTokens} → ${result.compactedTokens} tokens (${result.reductionPercent}% reduction)`
    );

    return result.skeleton;
  }

  /**
   * Analyze all supported files in a directory.
   */
  private async analyzeDirectory(
    dirPath: string | undefined,
    verbosity: Verbosity,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    let dirUri: vscode.Uri;

    if (dirPath) {
      dirUri = vscode.Uri.file(dirPath);
    } else {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) { return ['No workspace folder open']; }
      dirUri = workspaceFolder.uri;
    }

    const files = await this.findSupportedFiles(dirUri);
    const results: string[] = [];

    for (const file of files.slice(0, 50)) { // Cap at 50 files
      if (token.isCancellationRequested) { break; }
      const result = await this.analyzeFile(file.fsPath, verbosity, token);
      if (result.length > 0) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Analyze the entire workspace.
   */
  private async analyzeWorkspace(
    verbosity: Verbosity,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return ['No workspace folder open']; }
    return this.analyzeDirectory(workspaceFolder.uri.fsPath, verbosity, token);
  }

  /**
   * Find supported files in a directory (non-recursive for speed).
   */
  private async findSupportedFiles(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
    const supportedExtensions = [
      '.ts', '.tsx', '.js', '.jsx',
      '.py',
      '.go',
      '.java',
      '.rs',
    ];

    const config = vscode.workspace.getConfiguration('tokenslayer');
    const ignoredPaths = config.get<string[]>('ignoredPaths', []);

    const pattern = new vscode.RelativePattern(dirUri, '**/*.{ts,tsx,js,jsx,py,go,java,rs}');
    const files = await vscode.workspace.findFiles(pattern, `{${ignoredPaths.join(',')}}`, 100);

    return files.filter(f => {
      const ext = '.' + f.fsPath.split('.').pop();
      return supportedExtensions.includes(ext);
    });
  }

  /**
   * Get the default verbosity from settings.
   */
  private getDefaultVerbosity(): Verbosity {
    const config = vscode.workspace.getConfiguration('tokenslayer');
    return config.get<Verbosity>('verbosity', 'standard');
  }
}
