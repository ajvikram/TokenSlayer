import * as vscode from 'vscode';
import { applyPatches, Patch } from '../utils/structuralPatch';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export interface PatchToolInput {
  patches: { nodeId: string; action: 'replace' | 'insert_after' | 'delete'; content?: string }[];
  dryRun?: boolean;
}

/**
 * Language Model Tool for applying structural patches via node IDs.
 * Registered as 'tokenslayer-apply-patch'.
 */
export class PatchTool implements vscode.LanguageModelTool<PatchToolInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<PatchToolInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const count = options.input.patches?.length ?? 0;
    const mode = options.input.dryRun !== false ? 'dry-run' : 'APPLY';
    return {
      invocationMessage: `Applying ${count} structural patch(es) (${mode})`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<PatchToolInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { patches: rawPatches, dryRun } = options.input;

    if (!Array.isArray(rawPatches) || rawPatches.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart('Error: patches array is required and must not be empty.'),
      ]);
    }

    const isDryRun = dryRun !== false;

    logger.info(`PatchTool invoked: ${rawPatches.length} patches, dryRun=${isDryRun}`);

    try {
      const patches: Patch[] = rawPatches.map(p => ({
        nodeId: p.nodeId,
        action: p.action,
        content: p.content,
      }));

      const results = applyPatches(patches, isDryRun);

      if (results.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('No patches could be applied — node IDs may be invalid or files may have changed.'),
        ]);
      }

      const output = results.map(r => {
        const header = isDryRun
          ? `// DRY RUN — ${r.filePath} (no files modified)`
          : `// APPLIED — ${r.filePath}`;
        return `${header}\n\n${r.diff}`;
      }).join('\n\n---\n\n');

      if (!isDryRun) {
        for (const r of results) {
          const uri = vscode.Uri.file(r.filePath);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
        }
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(output),
      ]);
    } catch (error) {
      logger.error('PatchTool failed', error);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error applying patches: ${error}`),
      ]);
    }
  }
}
