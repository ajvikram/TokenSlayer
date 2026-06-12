import * as vscode from 'vscode';
import * as path from 'path';
import {
  CallNode,
  CallEdgeSource,
  transitiveCallers,
  formatCallers,
  formatCallees,
  formatImpact,
} from '../graph/callGraph';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export interface CallGraphInput {
  symbol: string;
  filePath?: string;
  direction?: 'callers' | 'callees' | 'impact';
  depth?: number;
}

const MAX_IMPACT_DEPTH = 5;

/**
 * Language Model Tool: deterministic call-graph queries.
 *
 *   callers  — who calls this symbol (incoming edges)
 *   callees  — what this symbol calls (outgoing edges)
 *   impact   — transitive callers, what could break if you change it
 *
 * Backed by VS Code's call-hierarchy provider (the same engine as "Show Call
 * Hierarchy"), so results are the real call graph, not a text search. Zero LLM
 * tokens to compute; the answer is a compact list that fits any context window.
 */
export class CallGraphTool implements vscode.LanguageModelTool<CallGraphInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<CallGraphInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const dir = options.input.direction || 'callers';
    const verb = dir === 'callees' ? 'Finding callees of' : dir === 'impact' ? 'Tracing impact of' : 'Finding callers of';
    return { invocationMessage: `${verb} ${options.input.symbol}` };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CallGraphInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { symbol, filePath } = options.input;
    const direction = options.input.direction || 'callers';

    if (!symbol || typeof symbol !== 'string') {
      return text('A symbol name is required.');
    }

    try {
      const item = await this.resolveSymbol(symbol, filePath, token);
      if (!item) {
        return text(
          `Could not locate a symbol named "${symbol}"${filePath ? ` in ${filePath}` : ''}. ` +
          `Check the spelling, or open the file so its language server is active.`,
        );
      }

      const root = this.toNode(item);
      const items = new Map<string, vscode.CallHierarchyItem>([[nodeKey(root), item]]);
      const source = this.edgeSource(items, token);

      if (direction === 'callees') {
        const callees = await source.outgoing(root);
        return text(formatCallees(root, callees));
      }
      if (direction === 'impact') {
        const depth = clampDepth(options.input.depth);
        const ranked = await transitiveCallers(root, source, depth);
        return text(formatImpact(root, ranked));
      }
      const callers = await source.incoming(root);
      return text(formatCallers(root, callers));
    } catch (error) {
      logger.error('call-graph tool failed', error);
      return text(`Error computing call graph: ${error}`);
    }
  }

  /** Resolve a symbol name to a call-hierarchy item via workspace symbols. */
  private async resolveSymbol(
    symbol: string,
    filePath: string | undefined,
    token: vscode.CancellationToken,
  ): Promise<vscode.CallHierarchyItem | undefined> {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      symbol,
    );
    if (token.isCancellationRequested || !symbols?.length) { return undefined; }

    const exact = symbols.filter((s) => s.name === symbol);
    const pool = exact.length ? exact : symbols;

    // Prefer a match in the requested file, if any.
    const preferred = filePath
      ? pool.find((s) => s.location.uri.fsPath.replace(/\\/g, '/').includes(filePath.replace(/\\/g, '/')))
      : undefined;
    const chosen = preferred ?? pool[0];

    const prepared = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
      'vscode.prepareCallHierarchy',
      chosen.location.uri,
      chosen.location.range.start,
    );
    return prepared?.[0];
  }

  /** Adapt VS Code incoming/outgoing call providers to the pure CallEdgeSource. */
  private edgeSource(
    items: Map<string, vscode.CallHierarchyItem>,
    token: vscode.CancellationToken,
  ): CallEdgeSource {
    const remember = (item: vscode.CallHierarchyItem): CallNode => {
      const node = this.toNode(item);
      items.set(nodeKey(node), item);
      return node;
    };
    const lookup = (node: CallNode) => items.get(nodeKey(node));

    return {
      incoming: async (node) => {
        if (token.isCancellationRequested) { return []; }
        const item = lookup(node);
        if (!item) { return []; }
        const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
          'vscode.provideIncomingCalls', item,
        );
        return (calls ?? []).map((c) => remember(c.from));
      },
      outgoing: async (node) => {
        if (token.isCancellationRequested) { return []; }
        const item = lookup(node);
        if (!item) { return []; }
        const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
          'vscode.provideOutgoingCalls', item,
        );
        return (calls ?? []).map((c) => remember(c.to));
      },
    };
  }

  private toNode(item: vscode.CallHierarchyItem): CallNode {
    const root = vscode.workspace.getWorkspaceFolder(item.uri)?.uri.fsPath;
    const abs = item.uri.fsPath;
    const file = root && abs.startsWith(root) ? path.relative(root, abs) : abs;
    return { name: item.name, file, line: item.selectionRange.start.line + 1 };
  }
}

function nodeKey(n: CallNode): string {
  return `${n.file}:${n.line}:${n.name}`;
}

function clampDepth(depth: number | undefined): number {
  if (!depth || depth < 1) { return 2; }
  return Math.min(depth, MAX_IMPACT_DEPTH);
}

function text(s: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(s)]);
}
