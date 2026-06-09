import * as vscode from 'vscode';
import { CacheManager } from './cache/cacheManager';
import { StructuralSummaryTool } from './tools/structuralSummaryTool';
import { PatchTool } from './tools/patchTool';
import { DashboardProvider } from './views/dashboardProvider';
import { SkeletonPreviewProvider } from './views/skeletonPreviewProvider';
import { TokenSlayerCodeLensProvider } from './views/codeLensProvider';
import { TokenSlayerFileDecorationProvider } from './views/fileDecorationProvider';
import { TokenSlayerChatParticipant } from './chat/chatParticipant';
import { LocalServer } from './server/localServer';
import { wireUpCopilot } from './copilot/wireUp';
import { wireUpTool, SUPPORTED_TOOLS } from './copilot/wireUpAll';
import { SymbolExtractor } from './extraction/symbolExtractor';
import { SkeletonBuilder } from './extraction/skeletonBuilder';
import { CompactorFactory } from './compaction/compactor';
import { TokenEstimator } from './utils/tokenEstimator';
import { buildDependencyChain } from './utils/importResolver';
import { applyPatches, Patch } from './utils/structuralPatch';
import { Logger } from './utils/logger';
import { Verbosity } from './types';

const logger = Logger.getInstance();

let statusBarItem: vscode.StatusBarItem;
let cacheManager: CacheManager;
let dashboardProvider: DashboardProvider;
let localServer: LocalServer;

/**
 * Extension activation entry point.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info('TokenSlayer activating...');

  // ─── 1. Initialize Cache ────────────────────────────────────────────────
  cacheManager = new CacheManager(context);
  await cacheManager.initialize();

  // ─── 1b. Initialize tokenizer in background (non-blocking) ──────────
  TokenEstimator.initAsync();

  // ─── 2. Register LM Tool ───────────────────────────────────────────────
  const structuralSummaryTool = new StructuralSummaryTool(cacheManager);
  context.subscriptions.push(
    vscode.lm.registerTool('tokenslayer-structural-summary', structuralSummaryTool)
  );
  logger.info('Registered LM tool: tokenslayer-structural-summary');

  const patchTool = new PatchTool();
  context.subscriptions.push(
    vscode.lm.registerTool('tokenslayer-apply-patch', patchTool)
  );
  logger.info('Registered LM tool: tokenslayer-apply-patch');

  // ─── 2b. Start Local Server (API) ─────────────────────────────────────────
  localServer = new LocalServer(cacheManager);
  localServer.start();
  context.subscriptions.push({
    dispose: () => localServer.stop()
  });

  // ─── 3. Register Dashboard View ─────────────────────────────────────────
  dashboardProvider = new DashboardProvider(context.extensionUri, cacheManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardProvider.viewType,
      dashboardProvider
    )
  );

  // ─── 4. Register Skeleton Preview Provider ──────────────────────────────
  const skeletonPreviewProvider = new SkeletonPreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      SkeletonPreviewProvider.scheme,
      skeletonPreviewProvider
    )
  );

  // ─── 5. Register Commands ──────────────────────────────────────────────

  // Analyze Workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.analyzeWorkspace', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'TokenSlayer: Analyzing workspace...',
          cancellable: true,
        },
        async (progress, token) => {
          const tool = new StructuralSummaryTool(cacheManager);
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
          }

          const config = vscode.workspace.getConfiguration('tokenslayer');
          const verbosity: Verbosity = config.get<Verbosity>('verbosity', 'standard');

          // Find all supported files
          const files = await vscode.workspace.findFiles(
            '**/*.{ts,tsx,js,jsx,py,go,java,rs,cs,kt,html,htm,css,scss,sass,less}',
            `{${config.get<string[]>('ignoredPaths', []).join(',')}}`,
            200
          );

          let analyzed = 0;
          for (const file of files) {
            if (token.isCancellationRequested) { break; }
            progress.report({
              message: `${analyzed}/${files.length} files...`,
              increment: (1 / files.length) * 100,
            });

            await tool.analyzeFile(file.fsPath, verbosity, token);
            analyzed++;
          }

          const savings = cacheManager.getSavings();
          updateStatusBar(savings.totalSaved);
          dashboardProvider.updateDashboard();

          vscode.window.showInformationMessage(
            `TokenSlayer: Analyzed ${analyzed} files — ${TokenEstimator.formatCount(savings.totalSaved)} tokens saved (${savings.reductionPercent}% reduction)`
          );
        }
      );
    })
  );

  // Analyze Current File
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.analyzeFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const tool = new StructuralSummaryTool(cacheManager);
      const config = vscode.workspace.getConfiguration('tokenslayer');
      const verbosity: Verbosity = config.get<Verbosity>('verbosity', 'standard');

      const tokenSource = new vscode.CancellationTokenSource();
      const skeleton = await tool.analyzeFile(
        editor.document.uri.fsPath,
        verbosity,
        tokenSource.token
      );
      tokenSource.dispose();

      const savings = cacheManager.getSavings();
      updateStatusBar(savings.totalSaved);
      dashboardProvider.updateDashboard();

      const fileName = editor.document.uri.fsPath.split(/[/\\]/).pop();
      vscode.window.showInformationMessage(
        `TokenSlayer: ${fileName} analyzed — ${savings.reductionPercent}% token reduction`
      );
    })
  );

  // Show Dashboard
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.showDashboard', () => {
      vscode.commands.executeCommand('tokenslayer.dashboardView.focus');
    })
  );

  // Clear Cache
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.clearCache', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all cached structural summaries?',
        { modal: true },
        'Clear'
      );
      if (confirm === 'Clear') {
        cacheManager.clear();
        updateStatusBar(0);
        dashboardProvider.updateDashboard();
        vscode.window.showInformationMessage('TokenSlayer: Cache cleared');
      }
    })
  );

  // Show Skeleton Preview
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.showSkeleton', async () => {
      await SkeletonPreviewProvider.showPreview();
    })
  );

  // Export Report
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.exportReport', async () => {
      const savings = cacheManager.getSavings();
      const langStats = cacheManager.getLanguageStats();
      const topSavers = cacheManager.getTopSavers(10);
      const excludedCount = cacheManager.getExcludedCount();
      const excludedFiles = cacheManager.getExcludedFiles();

      let report = `# ⚡ TokenSlayer Report\n\n`;
      report += `**Generated:** ${new Date().toLocaleString()}\n\n`;
      report += `## Summary\n\n`;
      report += `| Metric | Value |\n|---|---|\n`;
      report += `| Tokens Saved | ${savings.totalSaved.toLocaleString()} |\n`;
      report += `| Reduction | ${savings.reductionPercent}% |\n`;
      report += `| Est. Cost Saved | ${savings.estimatedCost.label} |\n`;
      report += `| Tokens Processed | ${savings.totalOriginalTokens.toLocaleString()} |\n`;
      report += `| Avg Saved / File | ${savings.avgSavedPerFile.toLocaleString()} |\n`;
      report += `| Files Analyzed | ${savings.filesAnalyzed} |\n`;
      report += `| Cache Hit Rate | ${cacheManager.getStats().hitRate}% |\n`;
      report += `| Excluded Files | ${excludedCount} |\n\n`;

      if (langStats.length > 0) {
        report += `## Language Breakdown\n\n`;
        report += `| Language | Files | Tokens Saved | Reduction |\n|---|---|---|---|\n`;
        for (const l of langStats) {
          report += `| ${l.language} | ${l.files} | ${l.savedTokens.toLocaleString()} | ${l.reductionPercent}% |\n`;
        }
        report += `\n`;
      }

      if (topSavers.length > 0) {
        report += `## Top Savers\n\n`;
        report += `| Rank | File | Original | Compacted | Saved |\n|---|---|---|---|---|\n`;
        topSavers.forEach((s, i) => {
          report += `| ${i + 1} | ${s.fileName} | ${s.originalTokens.toLocaleString()} | ${s.compactedTokens.toLocaleString()} | ${(s.originalTokens - s.compactedTokens).toLocaleString()} |\n`;
        });
        report += `\n`;
      }

      if (excludedFiles.length > 0) {
        report += `## 🛡️ Excluded Files (Secrets Detected)\n\n`;
        report += `| File | Severity | Reasons |\n|---|---|---|\n`;
        for (const f of excludedFiles) {
          report += `| ${f.fileName} | ${f.severity.toUpperCase()} | ${f.reasons.join(', ')} |\n`;
        }
      }

      const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('TokenSlayer: Report generated!');
    })
  );

  // Wire Up Copilot — writes .github/copilot-instructions.md + .vscode/mcp.json
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.wireUpCopilot', async () => {
      await wireUpCopilot(context);
    })
  );

  // Wire Up AI Tool — QuickPick for all supported tools (Copilot + third-party)
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.wireUpTool', async () => {
      const items: { label: string; id: string; description: string }[] = [
        { label: 'Copilot', id: 'copilot', description: '.vscode/mcp.json + .github/copilot-instructions.md' },
        ...SUPPORTED_TOOLS.map(t => ({ label: t.label, id: t.id, description: t.configPath })),
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an AI tool to wire up with TokenSlayer',
        title: 'TokenSlayer: Wire Up AI Tool',
      });
      if (!picked) { return; }

      if (picked.id === 'copilot') {
        await wireUpCopilot(context);
      } else {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showWarningMessage('TokenSlayer: open a workspace folder first.');
          return;
        }
        await wireUpTool(picked.id, workspaceFolder.uri.fsPath);
      }
    })
  );

  // Analyze Dependency Chain — follow local imports from a seed file
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.analyzeDependencyChain', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor — open a file first');
        return;
      }

      const config = vscode.workspace.getConfiguration('tokenslayer');
      const maxDepth = config.get<number>('dependencyChainDepth', 2);
      const verbosity: Verbosity = config.get<Verbosity>('verbosity', 'standard');

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'TokenSlayer: Analyzing dependency chain...',
          cancellable: true,
        },
        async (_progress, token) => {
          const doc = editor.document;
          const chain = buildDependencyChain(doc.uri.fsPath, doc.languageId, maxDepth);

          const tool = new StructuralSummaryTool(cacheManager);
          const results: string[] = [];

          for (const fp of chain) {
            if (token.isCancellationRequested) break;
            const result = await tool.analyzeFile(fp, verbosity, token);
            if (result.length > 0) results.push(result);
          }

          const combined = results.join('\n\n---\n\n');
          const previewDoc = await vscode.workspace.openTextDocument({
            content: combined,
            language: doc.languageId,
          });
          await vscode.window.showTextDocument(previewDoc, { preview: true });

          const savings = cacheManager.getSavings();
          updateStatusBar(savings.totalSaved);
          dashboardProvider.updateDashboard();

          vscode.window.showInformationMessage(
            `TokenSlayer: Dependency chain — ${chain.length} file(s) analyzed`
          );
        }
      );
    })
  );

  // Apply Structural Patch — reads JSON patch from clipboard and previews diff
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenslayer.applyPatch', async () => {
      const clipText = await vscode.env.clipboard.readText();
      let patches: Patch[];

      try {
        const parsed = JSON.parse(clipText);
        patches = Array.isArray(parsed) ? parsed : parsed.patches || [parsed];
      } catch {
        const input = await vscode.window.showInputBox({
          prompt: 'Paste a JSON patch array (or copy one to the clipboard first)',
          placeHolder: '[{"nodeId": "...", "action": "replace", "content": "..."}]',
        });
        if (!input) return;
        try {
          const parsed = JSON.parse(input);
          patches = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          vscode.window.showErrorMessage('TokenSlayer: Invalid JSON patch');
          return;
        }
      }

      const results = applyPatches(patches, true);
      if (results.length === 0) {
        vscode.window.showWarningMessage('TokenSlayer: No patches could be applied');
        return;
      }

      const diffOutput = results.map(r => `// ${r.filePath}\n${r.diff}`).join('\n\n');
      const doc = await vscode.workspace.openTextDocument({
        content: diffOutput,
        language: 'diff',
      });
      await vscode.window.showTextDocument(doc, { preview: true });

      const apply = await vscode.window.showInformationMessage(
        `TokenSlayer: Preview ${results.length} patch diff(s). Apply changes?`,
        'Apply',
        'Cancel'
      );

      if (apply === 'Apply') {
        applyPatches(patches, false);
        vscode.window.showInformationMessage('TokenSlayer: Patches applied successfully');
      }
    })
  );

  // ─── 5b. Register CodeLens Provider ────────────────────────────────────
  const codeLensProvider = new TokenSlayerCodeLensProvider(cacheManager);
  const codeLensSelector = [
    { language: 'typescript' }, { language: 'javascript' },
    { language: 'typescriptreact' }, { language: 'javascriptreact' },
    { language: 'python' }, { language: 'go' },
    { language: 'java' }, { language: 'rust' },
    { language: 'csharp' }, { language: 'kotlin' },
    { language: 'html' }, { language: 'css' },
    { language: 'scss' }, { language: 'less' },
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(codeLensSelector, codeLensProvider)
  );

  // ─── 5c. Register File Decoration Provider ────────────────────────────
  const fileDecorationProvider = new TokenSlayerFileDecorationProvider(cacheManager);
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileDecorationProvider)
  );

  // ─── 6. Auto-Analyze on File Open/Save ──────────────────────────────────
  const supportedLanguages = new Set([
    'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
    'python', 'go', 'java', 'rust', 'csharp', 'kotlin',
    'html', 'css', 'scss', 'sass', 'less',
  ]);

  // Helper: analyze a document and update UI
  async function analyzeDocument(document: vscode.TextDocument): Promise<void> {
    if (!supportedLanguages.has(document.languageId)) {
      return;
    }
    // Skip very small files (< 10 lines) or untitled files
    if (document.lineCount < 10 || document.uri.scheme !== 'file') {
      return;
    }

    logger.info(`Auto-analyzing: ${document.uri.fsPath} (${document.languageId}, ${document.lineCount} lines)`);

    const tool = new StructuralSummaryTool(cacheManager);
    const config = vscode.workspace.getConfiguration('tokenslayer');
    const verbosity: Verbosity = config.get<Verbosity>('verbosity', 'standard');

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      await tool.analyzeFile(document.uri.fsPath, verbosity, tokenSource.token);
      const savings = cacheManager.getSavings();
      updateStatusBar(savings.totalSaved);
      dashboardProvider.updateDashboard();
      codeLensProvider.refresh();
      fileDecorationProvider.refresh();
      logger.info(`Auto-analysis complete: ${savings.totalSaved} total tokens saved`);
    } catch (error) {
      logger.error(`Auto-analysis failed for ${document.uri.fsPath}`, error);
    } finally {
      tokenSource.dispose();
    }
  }

  // Auto-analyze when a file is opened
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor) {
        logger.debug(`Editor changed: ${editor.document.uri.fsPath}`);
        // Small delay to let language server initialize for the file
        setTimeout(() => analyzeDocument(editor.document), 1500);
      }
    })
  );

  // Auto-analyze when a file is saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      cacheManager.invalidateFile(document.uri.fsPath);
      await analyzeDocument(document);
    })
  );

  // ─── 5d. Register Chat Participant ────────────────────────────────────
  const chatParticipant = new TokenSlayerChatParticipant(cacheManager);
  chatParticipant.register(context);

  // Analyze the currently active editor on activation
  if (vscode.window.activeTextEditor) {
    setTimeout(() => {
      if (vscode.window.activeTextEditor) {
        analyzeDocument(vscode.window.activeTextEditor.document);
      }
    }, 3000); // Wait 3s for language servers to initialize
  }

  // ─── 8. Workspace Pre-warming ────────────────────────────────────────────
  // Background scan all supported files so the cache is hot before Copilot asks
  setTimeout(async () => {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const pattern = new vscode.RelativePattern(
        workspaceFolder,
        '**/*.{ts,tsx,js,jsx,py,go,java,rs,cs,kt}'
      );
      const config = vscode.workspace.getConfiguration('tokenslayer');
      const ignoredPaths = config.get<string[]>('ignoredPaths', [
        'node_modules', 'dist', 'out', '.git', 'coverage', '__pycache__', 'vendor',
      ]);
      const files = await vscode.workspace.findFiles(
        pattern,
        `{${ignoredPaths.map(p => `**/${p}/**`).join(',')}}`,
        200 // Cap at 200 files for pre-warming
      );

      logger.info(`Pre-warming: found ${files.length} supported files`);

      const tool = new StructuralSummaryTool(cacheManager);
      const tokenSource = new vscode.CancellationTokenSource();
      let warmed = 0;

      for (const file of files) {
        // Skip if already cached
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          if (!supportedLanguages.has(doc.languageId) || doc.lineCount < 10) continue;

          const content = doc.getText();
          const key = cacheManager.generateKey(file.fsPath, content);
          if (cacheManager.get(key)) continue; // Already cached

          await tool.analyzeFile(file.fsPath, 'standard', tokenSource.token);
          warmed++;
        } catch {
          // Skip files that can't be opened
        }
      }

      if (warmed > 0) {
        const savings = cacheManager.getSavings();
        updateStatusBar(savings.totalSaved);
        dashboardProvider.updateDashboard();
        codeLensProvider.refresh();
        fileDecorationProvider.refresh();
        logger.info(`Pre-warming complete: ${warmed} files cached, ${savings.totalSaved} total tokens saved`);
      }

      tokenSource.dispose();
    } catch (error) {
      logger.error('Pre-warming failed', error);
    }
  }, 8000); // Wait 8s for all language servers to fully initialize

  // ─── 7. File Watchers (Cache Invalidation) ──────────────────────────────
  const fileWatcher = vscode.workspace.onDidChangeTextDocument((event) => {
    // Invalidate cache when file content changes
    if (event.contentChanges.length > 0) {
      cacheManager.invalidateFile(event.document.uri.fsPath);
    }
  });
  context.subscriptions.push(fileWatcher);

  // Also watch for file deletions
  const deleteWatcher = vscode.workspace.onDidDeleteFiles((event) => {
    for (const file of event.files) {
      cacheManager.invalidateFile(file.fsPath);
    }
  });
  context.subscriptions.push(deleteWatcher);

  // ─── 8. Status Bar ────────────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'tokenslayer.showDashboard';
  statusBarItem.tooltip = 'TokenSlayer — Click to open dashboard';
  updateStatusBar(cacheManager.getSavings().totalSaved);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ─── 9. Auto-persist cache periodically ──────────────────────────────
  const persistInterval = setInterval(() => {
    cacheManager.persist();
  }, 60_000); // Every 60 seconds

  context.subscriptions.push({
    dispose: () => clearInterval(persistInterval),
  });

  logger.info('TokenSlayer activated successfully ✓');
  logger.show(); // Show the output channel so user can see activity
}

/**
 * Extension deactivation.
 */
export async function deactivate(): Promise<void> {
  logger.info('TokenSlayer deactivating...');
  if (cacheManager) {
    await cacheManager.persist();
  }
  logger.dispose();
}

/**
 * Update the status bar item with current savings.
 */
function updateStatusBar(tokensSaved: number): void {
  if (statusBarItem) {
    if (tokensSaved > 0) {
      statusBarItem.text = `⚡ ${TokenEstimator.formatCount(tokensSaved)} tokens saved`;
    } else {
      statusBarItem.text = '⚡ TokenSlayer';
    }
  }
}
