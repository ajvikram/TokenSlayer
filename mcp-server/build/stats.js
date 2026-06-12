import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const STATS_DIR = path.join(os.homedir(), '.tokenslayer');
const STATS_FILE = path.join(STATS_DIR, 'stats.jsonl');
export function recordStats(records, tool) {
    if (records.length === 0)
        return;
    try {
        fs.mkdirSync(STATS_DIR, { recursive: true });
        const timestamp = new Date().toISOString();
        const lines = records
            .map(r => JSON.stringify({ ...r, tool, timestamp }))
            .join('\n') + '\n';
        fs.appendFileSync(STATS_FILE, lines);
    }
    catch {
        // Never fail an MCP call due to stats persistence
    }
}
export function readStats() {
    try {
        if (!fs.existsSync(STATS_FILE))
            return [];
        const content = fs.readFileSync(STATS_FILE, 'utf-8');
        return content
            .split('\n')
            .filter(l => l.trim())
            .map(l => {
            try {
                return JSON.parse(l);
            }
            catch {
                return null;
            }
        })
            .filter((r) => r !== null);
    }
    catch {
        return [];
    }
}
export function clearStats() {
    try {
        if (fs.existsSync(STATS_FILE))
            fs.unlinkSync(STATS_FILE);
    }
    catch {
        // ignore
    }
}
export function getStatsFilePath() {
    return STATS_FILE;
}
/** Optional cap on MCP analyses per calendar month (0 = disabled). */
export function getMonthlyAnalysisBudget() {
    const raw = process.env.TOKENSLAYER_MONTHLY_ANALYSIS_BUDGET;
    if (!raw)
        return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}
function attachMonthOverMonthDeltas(byMonth) {
    for (let i = 0; i < byMonth.length; i++) {
        const prev = byMonth[i + 1];
        if (!prev)
            continue;
        byMonth[i].momSavedDelta = byMonth[i].saved - prev.saved;
        byMonth[i].momSavedPercent = prev.saved > 0
            ? Math.round(((byMonth[i].saved - prev.saved) / prev.saved) * 100)
            : null;
        byMonth[i].momAnalysesDelta = byMonth[i].analyses - prev.analyses;
    }
}
export function formatMomDelta(delta, percent) {
    if (delta === 0)
        return '→ flat';
    const arrow = delta > 0 ? '↑' : '↓';
    const abs = Math.abs(delta).toLocaleString('en-US');
    if (percent != null)
        return `${arrow} ${abs} (${percent > 0 ? '+' : ''}${percent}%)`;
    return `${arrow} ${abs}`;
}
const COST_PER_MILLION_INPUT = {
    gpt4o: 2.50,
    claudeSonnet: 3.00,
};
function estimateCost(tokensSaved) {
    const m = tokensSaved / 1_000_000;
    const gpt4o = Math.round(m * COST_PER_MILLION_INPUT.gpt4o * 100) / 100;
    const claudeSonnet = Math.round(m * COST_PER_MILLION_INPUT.claudeSonnet * 100) / 100;
    const best = Math.max(gpt4o, claudeSonnet);
    const label = best < 0.01 ? '<$0.01' : `~$${best.toFixed(2)}`;
    return { gpt4o, claudeSonnet, label };
}
/** Extract a UTC `YYYY-MM` month key from an ISO timestamp, or null. */
export function monthKeyOf(isoTimestamp) {
    // ISO timestamps start with YYYY-MM-DD; slice avoids a Date allocation.
    if (/^\d{4}-\d{2}/.test(isoTimestamp))
        return isoTimestamp.slice(0, 7);
    const t = Date.parse(isoTimestamp);
    if (Number.isNaN(t))
        return null;
    return new Date(t).toISOString().slice(0, 7);
}
export function aggregate(records) {
    const byLanguage = {};
    const fileMap = new Map();
    const callTimestamps = new Set();
    const monthBuckets = new Map();
    let totalOriginal = 0;
    let totalCompacted = 0;
    // Group records by timestamp for timeline
    const timelineBuckets = new Map();
    for (const r of records) {
        totalOriginal += r.originalTokens;
        totalCompacted += r.compactedTokens;
        callTimestamps.add(r.timestamp);
        const saved = r.originalTokens - r.compactedTokens;
        timelineBuckets.set(r.timestamp, (timelineBuckets.get(r.timestamp) ?? 0) + saved);
        if (!byLanguage[r.language]) {
            byLanguage[r.language] = { files: 0, original: 0, compacted: 0, saved: 0, reductionPercent: 0 };
        }
        const lang = byLanguage[r.language];
        lang.files += 1;
        lang.original += r.originalTokens;
        lang.compacted += r.compactedTokens;
        lang.saved += saved;
        const mk = monthKeyOf(r.timestamp);
        if (mk) {
            const bucket = monthBuckets.get(mk) ?? {
                analyses: 0, calls: new Set(), files: new Set(), original: 0, compacted: 0,
            };
            bucket.analyses += 1;
            bucket.calls.add(r.timestamp);
            bucket.files.add(r.filePath);
            bucket.original += r.originalTokens;
            bucket.compacted += r.compactedTokens;
            monthBuckets.set(mk, bucket);
        }
        const existing = fileMap.get(r.filePath);
        if (existing) {
            existing.saved = saved;
            existing.original = r.originalTokens;
            existing.compacted = r.compactedTokens;
        }
        else {
            fileMap.set(r.filePath, { saved, original: r.originalTokens, compacted: r.compactedTokens, language: r.language });
        }
    }
    for (const lang of Object.values(byLanguage)) {
        lang.reductionPercent = lang.original > 0
            ? Math.round(((lang.original - lang.compacted) / lang.original) * 100)
            : 0;
    }
    const topSavers = Array.from(fileMap.entries())
        .map(([filePath, v]) => ({
        filePath,
        saved: v.saved,
        reductionPercent: v.original > 0 ? Math.round(((v.original - v.compacted) / v.original) * 100) : 0,
        language: v.language,
    }))
        .sort((a, b) => b.saved - a.saved)
        .slice(0, 10);
    const recentActivity = records.slice(-20).reverse();
    const sortedTimestamps = Array.from(callTimestamps).sort();
    // Build timeline: one point per MCP call, capped at last 50
    let cumulative = 0;
    const timeline = [];
    for (const ts of sortedTimestamps) {
        const saved = timelineBuckets.get(ts) ?? 0;
        cumulative += saved;
        timeline.push({ timestamp: ts, tokensSaved: saved, totalSavedCumulative: cumulative });
    }
    const timelineSlice = timeline.slice(-50);
    const totalSaved = totalOriginal - totalCompacted;
    // Newest month first.
    const byMonth = Array.from(monthBuckets.entries())
        .map(([month, b]) => {
        const saved = b.original - b.compacted;
        return {
            month,
            analyses: b.analyses,
            calls: b.calls.size,
            uniqueFiles: b.files.size,
            original: b.original,
            compacted: b.compacted,
            saved,
            reductionPercent: b.original > 0 ? Math.round((saved / b.original) * 100) : 0,
            estimatedCost: estimateCost(saved),
        };
    })
        .sort((a, b) => b.month.localeCompare(a.month));
    attachMonthOverMonthDeltas(byMonth);
    return {
        totalCalls: callTimestamps.size,
        totalAnalyses: records.length,
        uniqueFiles: fileMap.size,
        totalOriginalTokens: totalOriginal,
        totalCompactedTokens: totalCompacted,
        totalSaved,
        reductionPercent: totalOriginal > 0
            ? Math.round(((totalOriginal - totalCompacted) / totalOriginal) * 100)
            : 0,
        avgSavedPerFile: fileMap.size > 0 ? Math.round(totalSaved / fileMap.size) : 0,
        estimatedCost: estimateCost(totalSaved),
        timeline: timelineSlice,
        byLanguage,
        byMonth,
        topSavers,
        recentActivity,
        firstCall: sortedTimestamps[0] ?? null,
        lastCall: sortedTimestamps[sortedTimestamps.length - 1] ?? null,
        monthlyAnalysisBudget: getMonthlyAnalysisBudget(),
    };
}
function shortPath(p, maxLen = 60) {
    if (p.length <= maxLen)
        return p;
    const parts = p.split('/');
    if (parts.length <= 2)
        return '...' + p.slice(-(maxLen - 3));
    return '.../' + parts.slice(-3).join('/');
}
function fmtNum(n) {
    return n.toLocaleString('en-US');
}
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonth(key) {
    const [y, m] = key.split('-');
    const idx = parseInt(m, 10) - 1;
    return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${y}` : key;
}
function fmtRelTime(iso) {
    if (!iso)
        return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)
        return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)
        return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}
export function formatMarkdown(agg) {
    if (agg.totalAnalyses === 0) {
        return `# ⚡ TokenSlayer Stats\n\nNo analyses recorded yet. Use the \`analyze_files\` or \`analyze_workspace\` tool to start tracking savings.`;
    }
    const lines = [];
    lines.push('# ⚡ TokenSlayer Stats');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|---|---|');
    lines.push(`| **Tokens Saved** | ${fmtNum(agg.totalSaved)} |`);
    lines.push(`| **Reduction** | ${agg.reductionPercent}% |`);
    lines.push(`| **Est. Cost Saved** | ${agg.estimatedCost.label} |`);
    lines.push(`| Total Tokens Processed | ${fmtNum(agg.totalOriginalTokens)} |`);
    lines.push(`| Compacted Tokens | ${fmtNum(agg.totalCompactedTokens)} |`);
    lines.push(`| Avg Saved / File | ${fmtNum(agg.avgSavedPerFile)} |`);
    lines.push(`| Total Analyses | ${fmtNum(agg.totalAnalyses)} |`);
    lines.push(`| Unique Files | ${fmtNum(agg.uniqueFiles)} |`);
    lines.push(`| MCP Calls | ${fmtNum(agg.totalCalls)} |`);
    lines.push(`| First Call | ${fmtRelTime(agg.firstCall)} |`);
    lines.push(`| Last Call | ${fmtRelTime(agg.lastCall)} |`);
    if (agg.byMonth.length > 0) {
        lines.push('');
        lines.push('## By Month');
        lines.push('');
        lines.push('| Month | Analyses | Calls | Tokens Saved | Reduction | Est. Cost Saved | vs Prev Month |');
        lines.push('|---|---|---|---|---|---|---|');
        for (const m of agg.byMonth.slice(0, 12)) {
            const mom = m.momSavedDelta != null ? formatMomDelta(m.momSavedDelta, m.momSavedPercent) : '—';
            lines.push(`| ${fmtMonth(m.month)} | ${fmtNum(m.analyses)} | ${fmtNum(m.calls)} | ${fmtNum(m.saved)} | ${m.reductionPercent}% | ${m.estimatedCost.label} | ${mom} |`);
        }
    }
    const langs = Object.entries(agg.byLanguage).sort((a, b) => b[1].saved - a[1].saved);
    if (langs.length > 0) {
        lines.push('');
        lines.push('## By Language');
        lines.push('');
        lines.push('| Language | Files | Tokens Saved | Reduction |');
        lines.push('|---|---|---|---|');
        for (const [name, s] of langs) {
            lines.push(`| ${name} | ${fmtNum(s.files)} | ${fmtNum(s.saved)} | ${s.reductionPercent}% |`);
        }
    }
    if (agg.topSavers.length > 0) {
        lines.push('');
        lines.push('## Top Savers');
        lines.push('');
        lines.push('| File | Tokens Saved | Reduction |');
        lines.push('|---|---|---|');
        for (const t of agg.topSavers.slice(0, 5)) {
            lines.push(`| \`${shortPath(t.filePath)}\` | ${fmtNum(t.saved)} | ${t.reductionPercent}% |`);
        }
    }
    return lines.join('\n');
}
export function formatTerminal(agg) {
    const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
    const green = (s) => `\x1b[32m${s}\x1b[0m`;
    const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
    const bold = (s) => `\x1b[1m${s}\x1b[0m`;
    const dim = (s) => `\x1b[2m${s}\x1b[0m`;
    const lines = [];
    const bar = '━'.repeat(58);
    lines.push('');
    lines.push(cyan(bar));
    lines.push(cyan('  ⚡ TokenSlayer — Savings Dashboard'));
    lines.push(cyan(bar));
    if (agg.totalAnalyses === 0) {
        lines.push('');
        lines.push(dim('  No analyses recorded yet.'));
        lines.push(dim('  Run analyze_files or analyze_workspace to start tracking.'));
        lines.push('');
        return lines.join('\n');
    }
    lines.push('');
    lines.push(`  ${bold('Tokens Saved')}      ${green(fmtNum(agg.totalSaved))}`);
    lines.push(`  ${bold('Reduction')}         ${green(agg.reductionPercent + '%')}`);
    lines.push(`  ${bold('Est. Cost Saved')}   ${green(agg.estimatedCost.label)}`);
    lines.push(`  ${dim('Tokens Processed')}  ${fmtNum(agg.totalOriginalTokens)}`);
    lines.push(`  ${dim('Compacted')}         ${fmtNum(agg.totalCompactedTokens)}`);
    lines.push(`  ${dim('Avg Saved/File')}    ${fmtNum(agg.avgSavedPerFile)}`);
    lines.push('');
    lines.push(`  ${dim('Analyses')}          ${fmtNum(agg.totalAnalyses)}`);
    lines.push(`  ${dim('Unique Files')}      ${fmtNum(agg.uniqueFiles)}`);
    lines.push(`  ${dim('MCP Calls')}         ${fmtNum(agg.totalCalls)}`);
    lines.push(`  ${dim('Last Call')}         ${fmtRelTime(agg.lastCall)}`);
    if (agg.byMonth.length > 0) {
        lines.push('');
        lines.push(cyan('  By Month'));
        lines.push(cyan('  ' + '─'.repeat(56)));
        for (const m of agg.byMonth.slice(0, 6)) {
            const label = fmtMonth(m.month).padEnd(10);
            const analyses = String(m.analyses).padStart(5);
            const saved = fmtNum(m.saved).padStart(10);
            const pct = (m.reductionPercent + '%').padStart(5);
            const mom = m.momSavedDelta != null
                ? formatMomDelta(m.momSavedDelta, m.momSavedPercent)
                : '—';
            lines.push(`  ${bold(label)} ${dim('analyses=')}${analyses}  ${dim('saved=')}${green(saved)}  ${yellow(pct)}  ${dim(m.estimatedCost.label)}  ${dim(mom)}`);
        }
    }
    const langs = Object.entries(agg.byLanguage).sort((a, b) => b[1].saved - a[1].saved);
    if (langs.length > 0) {
        lines.push('');
        lines.push(cyan('  By Language'));
        lines.push(cyan('  ' + '─'.repeat(56)));
        for (const [name, s] of langs) {
            const langName = name.padEnd(14);
            const files = String(s.files).padStart(4);
            const saved = fmtNum(s.saved).padStart(10);
            const pct = (s.reductionPercent + '%').padStart(5);
            lines.push(`  ${langName} ${dim('files=')}${files}  ${dim('saved=')}${green(saved)}  ${yellow(pct)}`);
        }
    }
    if (agg.topSavers.length > 0) {
        lines.push('');
        lines.push(cyan('  Top Savers'));
        lines.push(cyan('  ' + '─'.repeat(56)));
        for (const t of agg.topSavers.slice(0, 5)) {
            const file = shortPath(t.filePath, 38).padEnd(38);
            const saved = fmtNum(t.saved).padStart(8);
            const pct = (t.reductionPercent + '%').padStart(5);
            lines.push(`  ${file}  ${green(saved)}  ${yellow(pct)}`);
        }
    }
    lines.push('');
    lines.push(dim(`  Stats file: ${getStatsFilePath()}`));
    lines.push('');
    return lines.join('\n');
}
/** CSV export of monthly breakdown (for spreadsheets / billing reviews). */
export function formatMonthlyCsv(agg) {
    const header = [
        'month',
        'analyses',
        'calls',
        'unique_files',
        'original_tokens',
        'compacted_tokens',
        'tokens_saved',
        'reduction_percent',
        'est_cost_gpt4o_usd',
        'est_cost_claude_usd',
        'mom_saved_delta',
        'mom_saved_percent',
        'mom_analyses_delta',
    ].join(',');
    if (agg.byMonth.length === 0) {
        return header + '\n';
    }
    const rows = agg.byMonth.map(m => [
        m.month,
        m.analyses,
        m.calls,
        m.uniqueFiles,
        m.original,
        m.compacted,
        m.saved,
        m.reductionPercent,
        m.estimatedCost.gpt4o.toFixed(2),
        m.estimatedCost.claudeSonnet.toFixed(2),
        m.momSavedDelta ?? '',
        m.momSavedPercent ?? '',
        m.momAnalysesDelta ?? '',
    ].join(','));
    return [header, ...rows].join('\n') + '\n';
}
