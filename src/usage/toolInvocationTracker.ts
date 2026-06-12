import * as vscode from 'vscode';

/**
 * Per-workspace take-up counter for the extension's Language Model Tools.
 *
 * Take-up — "does Copilot actually call our tools unprompted?" — is the first
 * effectiveness question for the extension, and VS Code exposes no Copilot-side
 * signal for it. Counting our own invocations is the ground truth: if these
 * numbers stay at zero, tool descriptions / picker enablement are the problem,
 * not skeleton quality.
 *
 * Counts are kept all-time and per calendar month (`YYYY-MM`), since Copilot
 * subscriptions and premium-request budgets roll monthly.
 */

export interface ToolInvocations {
  [toolName: string]: number;
}

/** Month key (`YYYY-MM`) → tool name → count. */
export interface MonthlyToolInvocations {
  [month: string]: ToolInvocations;
}

const STATE_KEY = 'tokenslayer.toolInvocations';
const MONTHLY_STATE_KEY = 'tokenslayer.toolInvocationsByMonth';
/** Keep at most this many months of history. */
const MAX_MONTHS = 12;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export class ToolInvocationTracker {
  constructor(private readonly state: vscode.Memento) {}

  record(toolName: string): void {
    const counts = this.state.get<ToolInvocations>(STATE_KEY, {});
    counts[toolName] = (counts[toolName] ?? 0) + 1;
    void this.state.update(STATE_KEY, counts);

    const monthly = this.state.get<MonthlyToolInvocations>(MONTHLY_STATE_KEY, {});
    const month = currentMonthKey();
    const bucket = monthly[month] ?? {};
    bucket[toolName] = (bucket[toolName] ?? 0) + 1;
    monthly[month] = bucket;

    // Prune to the newest MAX_MONTHS buckets.
    const months = Object.keys(monthly).sort();
    while (months.length > MAX_MONTHS) {
      delete monthly[months.shift()!];
    }
    void this.state.update(MONTHLY_STATE_KEY, monthly);
  }

  get(): ToolInvocations {
    return this.state.get<ToolInvocations>(STATE_KEY, {});
  }

  /** All recorded months, newest first. */
  getByMonth(): MonthlyToolInvocations {
    return this.state.get<MonthlyToolInvocations>(MONTHLY_STATE_KEY, {});
  }

  /** Counts for the current calendar month only. */
  getCurrentMonth(): ToolInvocations {
    return this.getByMonth()[currentMonthKey()] ?? {};
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
