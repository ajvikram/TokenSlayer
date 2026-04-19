import * as vscode from 'vscode';
import { StructuralSummaryTool } from '../tools/structuralSummaryTool';
import { CacheManager } from '../cache/cacheManager';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Chat Participant for TokenSlayer.
 * Allows users to explicitly type @tokenslayer in Copilot Chat
 * to get structural analysis instead of raw file reading.
 *
 * Usage:
 *   @tokenslayer How is authentication structured?
 *   @tokenslayer Analyze server.py
 *   @tokenslayer What classes are in this project?
 */
export class TokenSlayerChatParticipant {
  static readonly PARTICIPANT_ID = 'tokenslayer.chat';

  private tool: StructuralSummaryTool;
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
    this.tool = new StructuralSummaryTool(cacheManager);
  }

  /**
   * Register the chat participant.
   */
  register(context: vscode.ExtensionContext): void {
    const participant = vscode.chat.createChatParticipant(
      TokenSlayerChatParticipant.PARTICIPANT_ID,
      this.handleChat.bind(this)
    );

    participant.iconPath = new vscode.ThemeIcon('zap');

    context.subscriptions.push(participant);
    logger.info('Registered chat participant: @tokenslayer');
  }

  /**
   * Handle incoming chat messages.
   */
  private async handleChat(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    const prompt = request.prompt.trim().toLowerCase();

    logger.info(`Chat request: "${request.prompt}"`);

    // Check if there are file references in the chat context
    const fileRefs = this.extractFileReferences(request);

    try {
      if (fileRefs.length > 0) {
        // User referenced specific files — analyze those
        await this.analyzeSpecificFiles(fileRefs, request.prompt, stream, token);
      } else if (prompt.includes('workspace') || prompt.includes('project') || prompt.includes('all files')) {
        // Workspace-level analysis
        await this.analyzeWorkspaceContext(request.prompt, stream, token);
      } else {
        // Analyze active file or answer structural question
        await this.analyzeActiveContext(request.prompt, stream, token);
      }
    } catch (error) {
      logger.error('Chat participant error', error);
      stream.markdown(`⚠️ Error: ${error}`);
    }
  }

  /**
   * Analyze specifically referenced files.
   */
  private async analyzeSpecificFiles(
    fileRefs: string[],
    userPrompt: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    stream.markdown(`⚡ **TokenSlayer** — Analyzing ${fileRefs.length} file(s)...\n\n`);

    const skeletons: string[] = [];
    for (const filePath of fileRefs) {
      if (token.isCancellationRequested) break;
      const skeleton = await this.tool.analyzeFile(filePath, 'standard', token);
      if (skeleton.length > 0) {
        skeletons.push(skeleton);
      }
    }

    if (skeletons.length === 0) {
      stream.markdown('No structural data available for the referenced files.');
      return;
    }

    const savings = this.cacheManager.getSavings();
    const combined = skeletons.join('\n\n---\n\n');

    stream.markdown(`### Structural Summary\n\n`);
    stream.markdown(`\`\`\`\n${combined}\n\`\`\`\n\n`);
    stream.markdown(`---\n📊 **Session Total:** ${savings.totalSaved.toLocaleString()} tokens saved (${savings.reductionPercent}% reduction)\n\n`);

    if (userPrompt.length > 20) {
      // User asked a question along with the files — provide the skeleton as context
      stream.markdown(`> The structural skeletons above contain the architecture of the referenced files. ` +
        `Use them to answer: *${userPrompt}*\n`);
    }
  }

  /**
   * Analyze the active editor file.
   */
  private async analyzeActiveContext(
    userPrompt: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      stream.markdown('No active file. Open a file or reference one with `#file` to analyze.');
      return;
    }

    const fileName = editor.document.uri.fsPath.split(/[/\\]/).pop();
    stream.markdown(`⚡ **TokenSlayer** — Analyzing \`${fileName}\`...\n\n`);

    const skeleton = await this.tool.analyzeFile(editor.document.uri.fsPath, 'standard', token);

    if (skeleton.length === 0) {
      stream.markdown('Could not extract structural data from this file.');
      return;
    }

    const savings = this.cacheManager.getSavings();

    stream.markdown(`### Structural Skeleton of \`${fileName}\`\n\n`);
    stream.markdown(`\`\`\`\n${skeleton}\n\`\`\`\n\n`);
    stream.markdown(`---\n📊 **Session Total:** ${savings.totalSaved.toLocaleString()} tokens saved | **${savings.filesAnalyzed}** files analyzed\n\n`);

    if (userPrompt && !userPrompt.match(/^(analyze|scan|skeleton|structure)$/i)) {
      stream.markdown(`> Use the skeleton above to answer: *${userPrompt}*\n`);
    }
  }

  /**
   * Analyze the entire workspace.
   */
  private async analyzeWorkspaceContext(
    userPrompt: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    stream.markdown(`⚡ **TokenSlayer** — Scanning workspace...\n\n`);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      stream.markdown('No workspace folder open.');
      return;
    }

    // Find all supported files
    const pattern = new vscode.RelativePattern(
      workspaceFolder,
      '**/*.{ts,tsx,js,jsx,py,go,java,rs,cs,kt}'
    );
    const config = vscode.workspace.getConfiguration('tokenslayer');
    const ignoredPaths = config.get<string[]>('ignoredPaths', []);
    const files = await vscode.workspace.findFiles(
      pattern,
      `{${ignoredPaths.join(',')}}`,
      100
    );

    stream.markdown(`Found **${files.length}** supported files. Generating structural map...\n\n`);

    const skeletons: string[] = [];
    let analyzed = 0;

    for (const file of files) {
      if (token.isCancellationRequested) break;
      const skeleton = await this.tool.analyzeFile(file.fsPath, 'minimal', token);
      if (skeleton.length > 0) {
        skeletons.push(skeleton);
        analyzed++;
      }
      // Progress update every 10 files
      if (analyzed % 10 === 0 && analyzed > 0) {
        stream.markdown(`_...analyzed ${analyzed}/${files.length} files_\n`);
      }
    }

    const savings = this.cacheManager.getSavings();
    const combined = skeletons.join('\n\n---\n\n');

    stream.markdown(`### Workspace Structural Map (${analyzed} files)\n\n`);
    stream.markdown(`\`\`\`\n${combined}\n\`\`\`\n\n`);
    stream.markdown(`---\n📊 **Total:** ${savings.totalSaved.toLocaleString()} tokens saved (${savings.reductionPercent}% reduction across ${savings.filesAnalyzed} files)\n\n`);

    if (userPrompt && !userPrompt.match(/^(workspace|project|all files)$/i)) {
      stream.markdown(`> Use the workspace map above to answer: *${userPrompt}*\n`);
    }
  }

  /**
   * Extract file references from the chat request.
   */
  private extractFileReferences(request: vscode.ChatRequest): string[] {
    const files: string[] = [];

    // Check for #file references in the request
    for (const ref of request.references) {
      if (ref.value instanceof vscode.Uri) {
        files.push(ref.value.fsPath);
      } else if (ref.value && typeof ref.value === 'object' && 'uri' in ref.value) {
        const loc = ref.value as vscode.Location;
        files.push(loc.uri.fsPath);
      }
    }

    return files;
  }
}
