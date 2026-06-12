import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Aggregates real LLM token usage for the current workspace from Claude Code
 * session transcripts (~/.claude/projects/<workspace-slug>/*.jsonl). Each
 * assistant message there carries a `usage` block with actual billed tokens.
 *
 * Note: VS Code exposes no API for Copilot's internal token usage, so this is
 * the only real usage signal available to an extension; Copilot requests are
 * not included.
 */

export interface LlmUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Number of API requests (assistant messages carrying a usage block). */
  requests: number;
}

export interface ModelUsage extends LlmUsageTotals {
  model: string;
  totalTokens: number;
}

export interface MonthlyModelUsage {
  model: string;
  totalTokens: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface MonthlyUsage extends LlmUsageTotals {
  /** Calendar month in `YYYY-MM` format (local time). */
  month: string;
  totalTokens: number;
  /** Models used this month, sorted by token volume. */
  models: MonthlyModelUsage[];
}

export interface LlmUsage extends LlmUsageTotals {
  /** Sum of all four categories. */
  totalTokens: number;
  byModel: ModelUsage[];
  /** Newest month first. Subscriptions roll monthly, so this is the budget view. */
  byMonth: MonthlyUsage[];
  sessionCount: number;
  /** Epoch ms of the most recent usage record, or null. */
  lastActivity: number | null;
  /** False when no Claude Code transcript directory exists for the workspace. */
  available: boolean;
}

interface FileCacheEntry {
  size: number;
  mtimeMs: number;
  perModel: Map<string, LlmUsageTotals>;
  perMonth: Map<string, LlmUsageTotals>;
  perMonthModel: Map<string, Map<string, LlmUsageTotals>>;
  lastActivity: number | null;
}

function emptyTotals(): LlmUsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 0 };
}

function mergeTotals(target: LlmUsageTotals, src: LlmUsageTotals): void {
  target.inputTokens += src.inputTokens;
  target.outputTokens += src.outputTokens;
  target.cacheReadTokens += src.cacheReadTokens;
  target.cacheCreationTokens += src.cacheCreationTokens;
  target.requests += src.requests;
}

/**
 * Claude Code names the per-project transcript directory by replacing every
 * non-alphanumeric character of the absolute workspace path with '-'.
 */
export function claudeProjectDir(workspaceRoot: string, claudeHome?: string): string {
  const slug = workspaceRoot.replace(/[^A-Za-z0-9-]/g, '-');
  return path.join(claudeHome ?? path.join(os.homedir(), '.claude'), 'projects', slug);
}

/** Format an epoch-ms timestamp as a local `YYYY-MM` month key. */
export function monthKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addUsage(target: LlmUsageTotals, usage: any): void {
  target.inputTokens += usage.input_tokens ?? 0;
  target.outputTokens += usage.output_tokens ?? 0;
  target.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  target.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
  target.requests += 1;
}

/**
 * Parse one transcript's JSONL text into per-model and per-month usage totals.
 * Exposed for tests.
 */
export function parseTranscriptText(text: string): {
  perModel: Map<string, LlmUsageTotals>;
  perMonth: Map<string, LlmUsageTotals>;
  perMonthModel: Map<string, Map<string, LlmUsageTotals>>;
  lastActivity: number | null;
} {
  const perModel = new Map<string, LlmUsageTotals>();
  const perMonth = new Map<string, LlmUsageTotals>();
  const perMonthModel = new Map<string, Map<string, LlmUsageTotals>>();
  let lastActivity: number | null = null;

  for (const line of text.split('\n')) {
    if (!line) { continue; }
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = entry?.message;
    const usage = msg?.usage;
    const model: string | undefined = msg?.model;
    if (!usage || !model) { continue; }
    // Skip placeholder ids like `<synthetic>` emitted for system-level turns.
    if (model.startsWith('<')) { continue; }

    const totals = perModel.get(model) ?? emptyTotals();
    addUsage(totals, usage);
    perModel.set(model, totals);

    if (entry.timestamp) {
      const ts = Date.parse(entry.timestamp);
      if (!Number.isNaN(ts)) {
        if (lastActivity === null || ts > lastActivity) {
          lastActivity = ts;
        }
        const mk = monthKey(ts);
        const monthTotals = perMonth.get(mk) ?? emptyTotals();
        addUsage(monthTotals, usage);
        perMonth.set(mk, monthTotals);

        const monthModels = perMonthModel.get(mk) ?? new Map<string, LlmUsageTotals>();
        const modelTotals = monthModels.get(model) ?? emptyTotals();
        addUsage(modelTotals, usage);
        monthModels.set(model, modelTotals);
        perMonthModel.set(mk, monthModels);
      }
    }
  }

  return { perModel, perMonth, perMonthModel, lastActivity };
}

export class LlmUsageTracker {
  private fileCache = new Map<string, FileCacheEntry>();

  /**
   * Aggregate usage across every session transcript for the workspace.
   * Re-parses only files whose size/mtime changed, so frequent refreshes
   * (the dashboard polls every 5s) stay cheap.
   */
  getUsage(workspaceRoot: string, claudeHome?: string): LlmUsage {
    const dir = claudeProjectDir(workspaceRoot, claudeHome);
    const merged = new Map<string, LlmUsageTotals>();
    const mergedMonths = new Map<string, LlmUsageTotals>();
    const mergedMonthModels = new Map<string, Map<string, LlmUsageTotals>>();
    let lastActivity: number | null = null;
    let sessionCount = 0;

    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
    } catch {
      return {
        ...emptyTotals(),
        totalTokens: 0,
        byModel: [],
        byMonth: [],
        sessionCount: 0,
        lastActivity: null,
        available: false,
      };
    }

    for (const name of names) {
      const filePath = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      let entry = this.fileCache.get(filePath);
      if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
        let text: string;
        try {
          text = fs.readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }
        const parsed = parseTranscriptText(text);
        entry = {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          perModel: parsed.perModel,
          perMonth: parsed.perMonth,
          perMonthModel: parsed.perMonthModel,
          lastActivity: parsed.lastActivity,
        };
        this.fileCache.set(filePath, entry);
      }

      if (entry.perModel.size > 0) { sessionCount++; }
      if (entry.lastActivity !== null && (lastActivity === null || entry.lastActivity > lastActivity)) {
        lastActivity = entry.lastActivity;
      }
      for (const [model, totals] of entry.perModel) {
        const acc = merged.get(model) ?? emptyTotals();
        mergeTotals(acc, totals);
        merged.set(model, acc);
      }
      for (const [month, totals] of entry.perMonth ?? new Map()) {
        const acc = mergedMonths.get(month) ?? emptyTotals();
        mergeTotals(acc, totals);
        mergedMonths.set(month, acc);
      }
      for (const [month, models] of entry.perMonthModel ?? new Map()) {
        const accModels = mergedMonthModels.get(month) ?? new Map<string, LlmUsageTotals>();
        for (const [model, totals] of models) {
          const acc = accModels.get(model) ?? emptyTotals();
          mergeTotals(acc, totals);
          accModels.set(model, acc);
        }
        mergedMonthModels.set(month, accModels);
      }
    }

    const sum = emptyTotals();
    const byModel: ModelUsage[] = [];
    for (const [model, totals] of merged) {
      mergeTotals(sum, totals);
      byModel.push({
        model,
        ...totals,
        totalTokens:
          totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens,
      });
    }
    byModel.sort((a, b) => b.totalTokens - a.totalTokens);

    const byMonth: MonthlyUsage[] = [];
    for (const [month, totals] of mergedMonths) {
      const models: MonthlyModelUsage[] = [];
      const monthModels = mergedMonthModels.get(month);
      if (monthModels) {
        for (const [model, mt] of monthModels) {
          models.push({
            model,
            ...mt,
            totalTokens: mt.inputTokens + mt.outputTokens + mt.cacheReadTokens + mt.cacheCreationTokens,
          });
        }
        models.sort((a, b) => b.totalTokens - a.totalTokens);
      }
      byMonth.push({
        month,
        ...totals,
        totalTokens:
          totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens,
        models,
      });
    }
    // Newest month first.
    byMonth.sort((a, b) => b.month.localeCompare(a.month));

    return {
      ...sum,
      totalTokens: sum.inputTokens + sum.outputTokens + sum.cacheReadTokens + sum.cacheCreationTokens,
      byModel,
      byMonth,
      sessionCount,
      lastActivity,
      available: true,
    };
  }
}
