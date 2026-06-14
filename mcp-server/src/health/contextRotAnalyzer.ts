/**
 * Reads the active Claude Code session transcript and extracts rot signals.
 * Pure Node.js — no vscode dependency. Shared logic with the VS Code extension.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RotSignals } from './types.js';

// ─── Claude project directory ─────────────────────────────────────────────────

/**
 * Claude Code names the transcript dir by replacing every non-alphanumeric
 * character of the workspace path with '-'.
 */
function claudeProjectDir(workspaceRoot: string, claudeHome?: string): string {
  const slug = workspaceRoot.replace(/[^A-Za-z0-9-]/g, '-');
  return path.join(claudeHome ?? path.join(os.homedir(), '.claude'), 'projects', slug);
}

// ─── Turn record ──────────────────────────────────────────────────────────────

interface TurnRecord {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: string[];
  filesRead: string[];
  userMessage: string;
  model: string;
}

// ─── Transcript scanning ──────────────────────────────────────────────────────

export function findActiveSessionFile(workspaceRoot: string, claudeHome?: string): string | null {
  const dir = claudeProjectDir(workspaceRoot, claudeHome);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl'));
  } catch {
    return null;
  }
  if (names.length === 0) { return null; }

  let latest = { name: '', mtime: 0 };
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (stat.mtimeMs > latest.mtime) {
        latest = { name, mtime: stat.mtimeMs };
      }
    } catch { /* skip */ }
  }
  return latest.name ? path.join(dir, latest.name) : null;
}

function extractToolNames(content: unknown[]): string[] {
  const names: string[] = [];
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
      names.push(b['name']);
    }
  }
  return names;
}

function extractFilePaths(content: unknown[]): string[] {
  const paths: string[] = [];
  const fileTools = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b['type'] === 'tool_use' && typeof b['name'] === 'string' && fileTools.has(b['name'])) {
      const input = b['input'] as Record<string, unknown> | undefined;
      const p = input?.['file_path'] ?? input?.['path'];
      if (typeof p === 'string') { paths.push(p); }
    }
  }
  return paths;
}

export function parseTranscriptIntoTurns(filePath: string): TurnRecord[] {
  let text: string;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return []; }

  const lines = text.split('\n').filter(l => l.trim());
  const turns: TurnRecord[] = [];
  let pendingUserMessage = '';

  for (const line of lines) {
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }

    const msg = (entry as Record<string, unknown>)?.['message'] as Record<string, unknown> | undefined;
    if (!msg) { continue; }

    if (msg['role'] === 'user') {
      const content = msg['content'];
      if (typeof content === 'string') {
        pendingUserMessage = content.slice(0, 200);
      } else if (Array.isArray(content)) {
        const tb = (content as unknown[]).find((b: unknown) => (b as Record<string, unknown>)['type'] === 'text') as Record<string, unknown> | undefined;
        pendingUserMessage = typeof tb?.['text'] === 'string' ? (tb['text'] as string).slice(0, 200) : '';
      }
    }

    if (msg['role'] === 'assistant' && msg['usage']) {
      const content: unknown[] = Array.isArray(msg['content']) ? msg['content'] as unknown[] : [];
      const tsStr = (entry as Record<string, unknown>)?.['timestamp'];
      const ts = typeof tsStr === 'string' ? Date.parse(tsStr) : Date.now();
      const usage = msg['usage'] as Record<string, number>;

      turns.push({
        timestamp: isNaN(ts) ? Date.now() : ts,
        inputTokens: (usage['input_tokens'] ?? 0) +
          (usage['cache_read_input_tokens'] ?? 0) +
          (usage['cache_creation_input_tokens'] ?? 0),
        outputTokens: usage['output_tokens'] ?? 0,
        toolCalls: extractToolNames(content),
        filesRead: extractFilePaths(content),
        userMessage: pendingUserMessage,
        model: typeof msg['model'] === 'string' ? msg['model'] : 'unknown',
      });
      pendingUserMessage = '';
    }
  }
  return turns;
}

// ─── Signal computation ───────────────────────────────────────────────────────

export function computeRotSignals(turns: TurnRecord[]): RotSignals {
  const n = turns.length;

  const depthScore = Math.min(100, Math.round(n * 6));

  const allFiles = turns.flatMap(t => t.filesRead);
  const uniqueFiles = new Set(allFiles);
  const redundancyScore = allFiles.length === 0
    ? 0
    : Math.min(100, Math.round(((allFiles.length - uniqueFiles.size) / allFiles.length) * 100));

  let growthScore = 0;
  if (n >= 6) {
    const firstAvg = avg(turns.slice(0, 3).map(t => t.inputTokens + t.outputTokens));
    const lastAvg = avg(turns.slice(-3).map(t => t.inputTokens + t.outputTokens));
    const rate = firstAvg > 0 ? lastAvg / firstAvg : 1;
    growthScore = Math.min(100, Math.round(Math.max(0, rate - 1.0) * 50));
  } else if (n >= 2) {
    const first = turns[0].inputTokens + turns[0].outputTokens;
    const last = turns[n - 1].inputTokens + turns[n - 1].outputTokens;
    const rate = first > 0 ? last / first : 1;
    growthScore = Math.min(100, Math.round(Math.max(0, rate - 1.0) * 50));
  }

  const allTools = turns.flatMap(t => t.toolCalls);
  let entropyScore = 0;
  if (allTools.length > 0) {
    const uniqueTools = new Set(allTools).size;
    entropyScore = Math.min(100, Math.round(Math.max(0, 1 - (uniqueTools / allTools.length)) * 100));
  }

  const totalInput = turns.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutput = turns.reduce((s, t) => s + t.outputTokens, 0);
  const verbosityScore = totalInput === 0
    ? 0
    : Math.min(100, Math.round((totalOutput / totalInput) * 50));

  return { turnCount: n, depthScore, redundancyScore, growthScore, entropyScore, verbosityScore };
}

function avg(nums: number[]): number {
  if (nums.length === 0) { return 0; }
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// ─── Task complexity ──────────────────────────────────────────────────────────

const SIMPLE_KEYWORDS = /\b(where is|what is|find|show me|grep|list|which file|locate|search)\b/i;
const COMPLEX_KEYWORDS = /\b(refactor|redesign|implement|architecture|migrate|rewrite|restructure|overhaul)\b/i;

export function detectTaskComplexity(turns: TurnRecord[]): 'simple' | 'moderate' | 'complex' {
  if (turns.length === 0) { return 'moderate'; }
  const last = turns[turns.length - 1];
  const msg = last.userMessage;
  if (COMPLEX_KEYWORDS.test(msg)) { return 'complex'; }
  if (last.filesRead.length > 3) { return 'complex'; }
  if (last.outputTokens > 800) { return 'complex'; }
  if (SIMPLE_KEYWORDS.test(msg)) { return 'simple'; }
  if (msg.length < 50) { return 'simple'; }
  return 'moderate';
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface AnalysisResult {
  signals: RotSignals;
  complexity: 'simple' | 'moderate' | 'complex';
  currentModel: string;
  totalTokens: number;
  sessionFile: string;
}

export class ContextRotAnalyzer {
  analyze(workspaceRoot: string, claudeHome?: string): AnalysisResult | null {
    const sessionFile = findActiveSessionFile(workspaceRoot, claudeHome);
    if (!sessionFile) { return null; }

    const turns = parseTranscriptIntoTurns(sessionFile);
    if (turns.length === 0) { return null; }

    const signals = computeRotSignals(turns);
    const complexity = detectTaskComplexity(turns);
    const currentModel = turns[turns.length - 1].model;
    const totalTokens = turns.reduce((s, t) => s + t.inputTokens + t.outputTokens, 0);

    return { signals, complexity, currentModel, totalTokens, sessionFile: path.basename(sessionFile) };
  }
}
