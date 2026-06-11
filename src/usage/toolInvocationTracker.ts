import * as vscode from 'vscode';

/**
 * Per-workspace take-up counter for the extension's Language Model Tools.
 *
 * Take-up — "does Copilot actually call our tools unprompted?" — is the first
 * effectiveness question for the extension, and VS Code exposes no Copilot-side
 * signal for it. Counting our own invocations is the ground truth: if these
 * numbers stay at zero, tool descriptions / picker enablement are the problem,
 * not skeleton quality.
 */

export interface ToolInvocations {
  [toolName: string]: number;
}

const STATE_KEY = 'tokenslayer.toolInvocations';

export class ToolInvocationTracker {
  constructor(private readonly state: vscode.Memento) {}

  record(toolName: string): void {
    const counts = this.state.get<ToolInvocations>(STATE_KEY, {});
    counts[toolName] = (counts[toolName] ?? 0) + 1;
    void this.state.update(STATE_KEY, counts);
  }

  get(): ToolInvocations {
    return this.state.get<ToolInvocations>(STATE_KEY, {});
  }
}

/**
 * Wrap an LM tool so every invocation increments the take-up counter before
 * delegating. Keeps counting out of the tool implementations themselves.
 */
export function withTakeup<T>(
  tracker: ToolInvocationTracker,
  name: string,
  tool: vscode.LanguageModelTool<T>,
): vscode.LanguageModelTool<T> {
  return {
    invoke: (options, token) => {
      tracker.record(name);
      return tool.invoke(options, token);
    },
    prepareInvocation: tool.prepareInvocation
      ? tool.prepareInvocation.bind(tool)
      : undefined,
  };
}
