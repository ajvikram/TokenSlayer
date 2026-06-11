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

export interface LlmUsage extends LlmUsageTotals {
  /** Sum of all four categories. */
  totalTokens: number;
  byModel: ModelUsage[];
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
  lastActivity: number | null;
}

function emptyTotals(): LlmUsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 0 };
}

/**
 * Claude Code names the per-project transcript directory by replacing every
 * non-alphanumeric character of the absolute workspace path with '-'.
 */
export function claudeProjectDir(workspaceRoot: string, claudeHome?: string): string {
  const slug = workspaceRoot.replace(/[^A-Za-z0-9-]/g, '-');
  return path.join(claudeHome ?? path.join(os.homedir(), '.claude'), 'projects', slug);
}

/**
 * Parse one transcript's JSONL text into per-model usage totals.
 * Exposed for tests.
 */
export function parseTranscriptText(text: string): {
  perModel: Map<string, LlmUsageTotals>;
  lastActivity: number | null;
} {
  const perModel = new Map<string, LlmUsageTotals>();
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
    totals.inputTokens += usage.input_tokens ?? 0;
    totals.outputTokens += usage.output_tokens ?? 0;
    totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    totals.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    totals.requests += 1;
    perModel.set(model, totals);

    if (entry.timestamp) {
      const ts = Date.parse(entry.timestamp);
      if (!Number.isNaN(ts) && (lastActivity === null || ts > lastActivity)) {
        lastActivity = ts;
      }
    }
  }

  return { perModel, lastActivity };
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
        acc.inputTokens += totals.inputTokens;
        acc.outputTokens += totals.outputTokens;
        acc.cacheReadTokens += totals.cacheReadTokens;
        acc.cacheCreationTokens += totals.cacheCreationTokens;
        acc.requests += totals.requests;
        merged.set(model, acc);
      }
    }

    const sum = emptyTotals();
    const byModel: ModelUsage[] = [];
    for (const [model, totals] of merged) {
      sum.inputTokens += totals.inputTokens;
      sum.outputTokens += totals.outputTokens;
      sum.cacheReadTokens += totals.cacheReadTokens;
      sum.cacheCreationTokens += totals.cacheCreationTokens;
      sum.requests += totals.requests;
      byModel.push({
        model,
        ...totals,
        totalTokens:
          totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens,
      });
    }
    byModel.sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      ...sum,
      totalTokens: sum.inputTokens + sum.outputTokens + sum.cacheReadTokens + sum.cacheCreationTokens,
      byModel,
      sessionCount,
      lastActivity,
      available: true,
    };
  }
}
