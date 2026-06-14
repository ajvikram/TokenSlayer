import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RotSignals } from '../types';
import { claudeProjectDir } from '../usage/llmUsageTracker';

/**
 * Reads the active Claude Code session transcript and extracts the raw signals
 * needed to compute a Context Rot Score.
 *
 * "Active session" = the most recently modified .jsonl file in the workspace's
 * Claude project directory. We re-read only the tail on each poll (file grows
 * append-only), so 10s polling stays cheap even on large sessions.
 */

export interface TurnRecord {
  /** Epoch ms from the transcript timestamp field. */
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  /** Tool names called in this turn, e.g. ["Read", "Bash"]. */
  toolCalls: string[];
  /** Files touched in this turn (from Read / Write / Edit tool inputs). */
  filesRead: string[];
  /** Raw user message text (first 200 chars), used for complexity hints. */
  userMessage: string;
  model: string;
}

export interface ActiveSession {
  sessionFile: string;
  turns: TurnRecord[];
}

// ─── Transcript parsing ───────────────────────────────────────────────────

/**
 * Find the most recently modified .jsonl transcript for the workspace.
 * Returns null if no transcripts exist yet.
 */
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

/**
 * Extract tool names from a tool_use block array in a message.
 */
function extractToolNames(content: unknown[]): string[] {
  const names: string[] = [];
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_use' && typeof b.name === 'string') {
      names.push(b.name);
    }
  }
  return names;
}

/**
 * Extract file paths from tool_use inputs (Read, Write, Edit tools).
 */
function extractFilePaths(content: unknown[]): string[] {
  const paths: string[] = [];
  const fileTools = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_use' && typeof b.name === 'string' && fileTools.has(b.name)) {
      const input = b.input as Record<string, unknown> | undefined;
      const p = input?.file_path ?? input?.path;
      if (typeof p === 'string') { paths.push(p); }
    }
  }
  return paths;
}

/**
 * Parse a transcript file into an array of TurnRecords.
 * Each assistant message with a usage block = one turn.
 */
export function parseTranscriptIntoTurns(filePath: string): TurnRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = text.split('\n').filter(l => l.trim());
  const turns: TurnRecord[] = [];
  let pendingUserMessage = '';

  for (const line of lines) {
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }

    const msg = entry?.message;
    if (!msg) { continue; }

    // Capture user message text for complexity hints
    if (msg.role === 'user') {
      const content = msg.content;
      if (typeof content === 'string') {
        pendingUserMessage = content.slice(0, 200);
      } else if (Array.isArray(content)) {
        const textBlock = content.find((b: any) => b.type === 'text');
        pendingUserMessage = typeof textBlock?.text === 'string'
          ? textBlock.text.slice(0, 200)
          : '';
      }
    }

    // Assistant message with usage = a billable turn
    if (msg.role === 'assistant' && msg.usage) {
      const content: unknown[] = Array.isArray(msg.content) ? msg.content : [];
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : Date.now();

      turns.push({
        timestamp: isNaN(ts) ? Date.now() : ts,
        inputTokens: (msg.usage.input_tokens ?? 0) +
          (msg.usage.cache_read_input_tokens ?? 0) +
          (msg.usage.cache_creation_input_tokens ?? 0),
        outputTokens: msg.usage.output_tokens ?? 0,
        toolCalls: extractToolNames(content),
        filesRead: extractFilePaths(content),
        userMessage: pendingUserMessage,
        model: typeof msg.model === 'string' ? msg.model : 'unknown',
      });
      pendingUserMessage = '';
    }
  }

  return turns;
}

// ─── Signal computation ───────────────────────────────────────────────────

/**
 * Compute raw rot signals from the parsed turns of the active session.
 * Each signal is 0–100 where 100 = maximum rot contribution.
 */
export function computeRotSignals(turns: TurnRecord[]): RotSignals {
  const n = turns.length;

  // Signal 1: Turn depth (weight 30%)
  // Compliance degrades sharply after turn 10; saturates at 17+
  const depthScore = Math.min(100, Math.round(n * 6));

  // Signal 2: Redundant file reads (weight 25%)
  const allFiles = turns.flatMap(t => t.filesRead);
  const uniqueFiles = new Set(allFiles);
  const redundancyScore = allFiles.length === 0
    ? 0
    : Math.min(100, Math.round(
        ((allFiles.length - uniqueFiles.size) / allFiles.length) * 100
      ));

  // Signal 3: Token growth rate (weight 20%)
  // Compare avg tokens of first 3 turns vs last 3 turns
  let growthScore = 0;
  if (n >= 6) {
    const firstAvg = avg(turns.slice(0, 3).map(t => t.inputTokens + t.outputTokens));
    const lastAvg = avg(turns.slice(-3).map(t => t.inputTokens + t.outputTokens));
    const rate = firstAvg > 0 ? lastAvg / firstAvg : 1;
    growthScore = Math.min(100, Math.round(Math.max(0, rate - 1.0) * 50));
  } else if (n >= 2) {
    // Simpler: compare first vs last turn
    const first = turns[0].inputTokens + turns[0].outputTokens;
    const last = turns[n - 1].inputTokens + turns[n - 1].outputTokens;
    const rate = first > 0 ? last / first : 1;
    growthScore = Math.min(100, Math.round(Math.max(0, rate - 1.0) * 50));
  }

  // Signal 4: Tool looping (weight 15%)
  // Low tool diversity = the agent is repeating the same calls (often a sign of
  // being stuck). High value = high repetition = more rot. (Named "looping",
  // not "entropy": high entropy would mean high *diversity*, i.e. healthy — the
  // opposite of what this measures.)
  const allTools = turns.flatMap(t => t.toolCalls);
  let loopingScore = 0;
  if (allTools.length > 0) {
    const uniqueTools = new Set(allTools).size;
    loopingScore = Math.min(100, Math.round(
      Math.max(0, 1 - (uniqueTools / allTools.length)) * 100
    ));
  }

  // Signal 5: Output verbosity ratio (weight 10%)
  // Rising output vs input signals model overexplaining
  const totalInput = turns.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutput = turns.reduce((s, t) => s + t.outputTokens, 0);
  const verbosityScore = totalInput === 0
    ? 0
    : Math.min(100, Math.round((totalOutput / totalInput) * 50));

  return {
    turnCount: n,
    depthScore,
    redundancyScore,
    growthScore,
    loopingScore,
    verbosityScore,
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) { return 0; }
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// ─── Task complexity detection ────────────────────────────────────────────

const SIMPLE_KEYWORDS = /\b(where is|what is|find|show me|grep|list|which file|locate|search)\b/i;
const COMPLEX_KEYWORDS = /\b(refactor|redesign|implement|architecture|migrate|rewrite|restructure|overhaul)\b/i;

export function detectTaskComplexity(turns: TurnRecord[]): 'simple' | 'moderate' | 'complex' {
  if (turns.length === 0) { return 'moderate'; }

  const lastTurn = turns[turns.length - 1];
  const msg = lastTurn.userMessage;

  if (COMPLEX_KEYWORDS.test(msg)) { return 'complex'; }
  if (lastTurn.filesRead.length > 3) { return 'complex'; }
  if (lastTurn.outputTokens > 800) { return 'complex'; }

  if (SIMPLE_KEYWORDS.test(msg)) { return 'simple'; }
  if (msg.length < 50) { return 'simple'; }

  return 'moderate';
}

// ─── Main entry point ─────────────────────────────────────────────────────

export interface AnalysisResult {
  signals: RotSignals;
  complexity: 'simple' | 'moderate' | 'complex';
  currentModel: string;
  totalTokens: number;
  sessionFile: string;
  /** All parsed turns (oldest→newest) so the engine can replay the trajectory. */
  turns: TurnRecord[];
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
    const totalTokens = turns.reduce(
      (s, t) => s + t.inputTokens + t.outputTokens, 0
    );

    return { signals, complexity, currentModel, totalTokens, sessionFile: path.basename(sessionFile), turns };
  }
}
