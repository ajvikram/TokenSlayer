/**
 * Reads the active Claude Code session transcript and extracts rot signals.
 * Pure Node.js — no vscode dependency. Shared logic with the VS Code extension.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// ─── Claude project directory ─────────────────────────────────────────────────
/**
 * Claude Code names the transcript dir by replacing every non-alphanumeric
 * character of the workspace path with '-'.
 */
function claudeProjectDir(workspaceRoot, claudeHome) {
    const slug = workspaceRoot.replace(/[^A-Za-z0-9-]/g, '-');
    return path.join(claudeHome ?? path.join(os.homedir(), '.claude'), 'projects', slug);
}
// ─── Transcript scanning ──────────────────────────────────────────────────────
export function findActiveSessionFile(workspaceRoot, claudeHome) {
    const dir = claudeProjectDir(workspaceRoot, claudeHome);
    let names;
    try {
        names = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl'));
    }
    catch {
        return null;
    }
    if (names.length === 0) {
        return null;
    }
    let latest = { name: '', mtime: 0 };
    for (const name of names) {
        try {
            const stat = fs.statSync(path.join(dir, name));
            if (stat.mtimeMs > latest.mtime) {
                latest = { name, mtime: stat.mtimeMs };
            }
        }
        catch { /* skip */ }
    }
    return latest.name ? path.join(dir, latest.name) : null;
}
function extractToolNames(content) {
    const names = [];
    for (const block of content) {
        const b = block;
        if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
            names.push(b['name']);
        }
    }
    return names;
}
function extractFilePaths(content) {
    const paths = [];
    const fileTools = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);
    for (const block of content) {
        const b = block;
        if (b['type'] === 'tool_use' && typeof b['name'] === 'string' && fileTools.has(b['name'])) {
            const input = b['input'];
            const p = input?.['file_path'] ?? input?.['path'];
            if (typeof p === 'string') {
                paths.push(p);
            }
        }
    }
    return paths;
}
export function parseTranscriptIntoTurns(filePath) {
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    }
    catch {
        return [];
    }
    const lines = text.split('\n').filter(l => l.trim());
    const turns = [];
    let pendingUserMessage = '';
    for (const line of lines) {
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch {
            continue;
        }
        const msg = entry?.['message'];
        if (!msg) {
            continue;
        }
        if (msg['role'] === 'user') {
            const content = msg['content'];
            if (typeof content === 'string') {
                pendingUserMessage = content.slice(0, 200);
            }
            else if (Array.isArray(content)) {
                const tb = content.find((b) => b['type'] === 'text');
                pendingUserMessage = typeof tb?.['text'] === 'string' ? tb['text'].slice(0, 200) : '';
            }
        }
        if (msg['role'] === 'assistant' && msg['usage']) {
            const content = Array.isArray(msg['content']) ? msg['content'] : [];
            const tsStr = entry?.['timestamp'];
            const ts = typeof tsStr === 'string' ? Date.parse(tsStr) : Date.now();
            const usage = msg['usage'];
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
export function computeRotSignals(turns) {
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
    }
    else if (n >= 2) {
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
function avg(nums) {
    if (nums.length === 0) {
        return 0;
    }
    return nums.reduce((s, n) => s + n, 0) / nums.length;
}
// ─── Task complexity ──────────────────────────────────────────────────────────
const SIMPLE_KEYWORDS = /\b(where is|what is|find|show me|grep|list|which file|locate|search)\b/i;
const COMPLEX_KEYWORDS = /\b(refactor|redesign|implement|architecture|migrate|rewrite|restructure|overhaul)\b/i;
export function detectTaskComplexity(turns) {
    if (turns.length === 0) {
        return 'moderate';
    }
    const last = turns[turns.length - 1];
    const msg = last.userMessage;
    if (COMPLEX_KEYWORDS.test(msg)) {
        return 'complex';
    }
    if (last.filesRead.length > 3) {
        return 'complex';
    }
    if (last.outputTokens > 800) {
        return 'complex';
    }
    if (SIMPLE_KEYWORDS.test(msg)) {
        return 'simple';
    }
    if (msg.length < 50) {
        return 'simple';
    }
    return 'moderate';
}
export class ContextRotAnalyzer {
    analyze(workspaceRoot, claudeHome) {
        const sessionFile = findActiveSessionFile(workspaceRoot, claudeHome);
        if (!sessionFile) {
            return null;
        }
        const turns = parseTranscriptIntoTurns(sessionFile);
        if (turns.length === 0) {
            return null;
        }
        const signals = computeRotSignals(turns);
        const complexity = detectTaskComplexity(turns);
        const currentModel = turns[turns.length - 1].model;
        const totalTokens = turns.reduce((s, t) => s + t.inputTokens + t.outputTokens, 0);
        return { signals, complexity, currentModel, totalTokens, sessionFile: path.basename(sessionFile) };
    }
}
