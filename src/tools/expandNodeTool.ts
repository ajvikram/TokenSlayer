import * as vscode from 'vscode';
import { decodeNodeId } from '../utils/structuralPatch';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export interface ExpandNodeInput {
  nodeId: string;
}

/**
 * Language Model Tool that expands a skeleton node ID back to full source.
 * Skeletons from tokenslayer-structural-summary tag every element with
 * `NODE:<id>` markers; this tool lets the model drill into one collapsed
 * body without re-reading the whole file.
 */
export class ExpandNodeTool implements vscode.LanguageModelTool<ExpandNodeInput> {

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ExpandNodeInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const decoded = decodeNodeId(options.input.nodeId);
    const target = decoded
      ? `${decoded.filePath}:${decoded.startLine}-${decoded.endLine}`
      : 'node';
    return { invocationMessage: `Expanding ${target}` };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ExpandNodeInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const decoded = decodeNodeId(options.input.nodeId);
    if (!decoded) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart('Invalid nodeId — use an id from a NODE:<id> or EXPAND:<id> marker in a structural summary.'),
      ]);
    }

    try {
      const uri = vscode.Uri.file(decoded.filePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const lines = Buffer.from(bytes).toString('utf8').split('\n');
      const start = Math.max(1, decoded.startLine);
      const end = Math.min(lines.length, decoded.endLine);
      const slice = lines.slice(start - 1, end).join('\n');

      logger.info(`Expanded node ${decoded.filePath}:${start}-${end} (${end - start + 1} lines)`);

      const header = `// ${decoded.filePath} — lines ${start}-${end}\n\n`;
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(header + slice),
      ]);
    } catch (error) {
      logger.error('expand-node failed', error);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error expanding node: ${error}`),
      ]);
    }
  }
}
