import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Redirect stats to an isolated dir BEFORE importing the module.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenslayer-stats-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome; // Windows fallback

const { recordStats, readStats, aggregate, clearStats, getStatsFilePath, monthKeyOf, formatMarkdown, formatTerminal, formatMonthlyCsv, formatMomDelta, getMonthlyAnalysisBudget } = await import('../build/stats.js');

after(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

beforeEach(() => clearStats());

// ---- file path is honored -------------------------------------------------

describe('stats file location', () => {
  test('writes under the home directory', () => {
    const p = getStatsFilePath();
    assert.ok(p.startsWith(tmpHome), `${p} should be inside ${tmpHome}`);
    assert.ok(p.endsWith('stats.jsonl'));
  });
});

// ---- recordStats / readStats round-trip -----------------------------------

describe('recordStats + readStats round-trip', () => {
  test('empty array writes nothing', () => {
    recordStats([], 'analyze_files');
    assert.equal(readStats().length, 0);
  });

  test('single record persists and reads back', () => {
    recordStats([{
      filePath: '/a/b.ts',
      language: 'typescript',
      originalTokens: 100,
      compactedTokens: 20,
    }], 'analyze_files');
    const rows = readStats();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].filePath, '/a/b.ts');
    assert.equal(rows[0].language, 'typescript');
    assert.equal(rows[0].tool, 'analyze_files');
    assert.equal(rows[0].originalTokens, 100);
    assert.equal(rows[0].compactedTokens, 20);
    assert.ok(rows[0].timestamp, 'timestamp set');
  });

  test('appends across calls (no overwrite)', () => {
    recordStats([{ filePath: '/a.ts', language: 'typescript', originalTokens: 100, compactedTokens: 20 }], 'analyze_files');
    recordStats([{ filePath: '/b.ts', language: 'typescript', originalTokens: 200, compactedTokens: 50 }], 'analyze_workspace');
    const rows = readStats();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].tool, 'analyze_files');
    assert.equal(rows[1].tool, 'analyze_workspace');
  });

  test('survives a malformed line in the stats file', () => {
    recordStats([{ filePath: '/a.ts', language: 'typescript', originalTokens: 100, compactedTokens: 20 }], 'analyze_files');
    fs.appendFileSync(getStatsFilePath(), 'this is not json\n');
    recordStats([{ filePath: '/b.ts', language: 'typescript', originalTokens: 200, compactedTokens: 50 }], 'analyze_files');
    const rows = readStats();
    assert.equal(rows.length, 2, 'should skip the bad line, return the two valid ones');
  });
});

// ---- aggregate ------------------------------------------------------------

describe('aggregate', () => {
  test('empty state', () => {
    const a = aggregate([]);
    assert.equal(a.totalAnalyses, 0);
    assert.equal(a.totalSaved, 0);
    assert.equal(a.reductionPercent, 0);
    assert.equal(a.avgSavedPerFile, 0);
    assert.equal(a.estimatedCost.gpt4o, 0);
    assert.equal(a.estimatedCost.claudeSonnet, 0);
    assert.equal(a.estimatedCost.label, '<$0.01');
    assert.deepEqual(a.timeline, []);
    assert.equal(a.firstCall, null);
    assert.equal(a.lastCall, null);
    assert.deepEqual(a.byLanguage, {});
    assert.deepEqual(a.topSavers, []);
  });

  test('totals across multiple records', () => {
    recordStats([
      { filePath: '/a.ts', language: 'typescript', originalTokens: 1000, compactedTokens: 100 },
      { filePath: '/b.ts', language: 'typescript', originalTokens: 500, compactedTokens: 200 },
      { filePath: '/c.py', language: 'python', originalTokens: 800, compactedTokens: 400 },
    ], 'analyze_files');
    const a = aggregate(readStats());
    assert.equal(a.totalAnalyses, 3);
    assert.equal(a.uniqueFiles, 3);
    assert.equal(a.totalOriginalTokens, 2300);
    assert.equal(a.totalCompactedTokens, 700);
    assert.equal(a.totalSaved, 1600);
    assert.equal(a.reductionPercent, Math.round(((2300 - 700) / 2300) * 100));
  });

  test('language breakdown is correct', () => {
    recordStats([
      { filePath: '/a.ts', language: 'typescript', originalTokens: 1000, compactedTokens: 100 },
      { filePath: '/b.ts', language: 'typescript', originalTokens: 500, compactedTokens: 200 },
      { filePath: '/c.py', language: 'python', originalTokens: 800, compactedTokens: 400 },
    ], 'analyze_files');
    const a = aggregate(readStats());
    assert.equal(a.byLanguage.typescript.files, 2);
    assert.equal(a.byLanguage.typescript.original, 1500);
    assert.equal(a.byLanguage.typescript.compacted, 300);
    assert.equal(a.byLanguage.typescript.saved, 1200);
    assert.equal(a.byLanguage.typescript.reductionPercent, 80);
    assert.equal(a.byLanguage.python.files, 1);
    assert.equal(a.byLanguage.python.saved, 400);
    assert.equal(a.byLanguage.python.reductionPercent, 50);
  });

  test('top savers are sorted by absolute tokens saved, capped at 10', () => {
    const records = [];
    for (let i = 0; i < 15; i++) {
      records.push({
        filePath: `/file${i}.ts`,
        language: 'typescript',
        originalTokens: 1000 + i * 10,
        compactedTokens: 100,
      });
    }
    recordStats(records, 'analyze_files');
    const a = aggregate(readStats());
    assert.equal(a.topSavers.length, 10);
    // file14 saves the most (1140 - 100 = 1040)
    assert.equal(a.topSavers[0].filePath, '/file14.ts');
    assert.equal(a.topSavers[0].saved, 1040);
    // monotonically decreasing
    for (let i = 1; i < a.topSavers.length; i++) {
      assert.ok(
        a.topSavers[i - 1].saved >= a.topSavers[i].saved,
        `topSavers[${i - 1}].saved (${a.topSavers[i - 1].saved}) >= topSavers[${i}].saved (${a.topSavers[i].saved})`
      );
    }
  });

  test('repeated analysis of the same file keeps the latest result (not duplicates)', () => {
    recordStats([{ filePath: '/a.ts', language: 'typescript', originalTokens: 1000, compactedTokens: 100 }], 'analyze_files');
    recordStats([{ filePath: '/a.ts', language: 'typescript', originalTokens: 1200, compactedTokens: 200 }], 'analyze_files');
    const a = aggregate(readStats());
    assert.equal(a.totalAnalyses, 2, 'history keeps both rows');
    assert.equal(a.uniqueFiles, 1, 'but unique file count collapses');
    assert.equal(a.topSavers.length, 1);
    assert.equal(a.topSavers[0].saved, 1000, 'latest result wins (1200 - 200 = 1000)');
  });

  test('recentActivity is reverse-chronological, capped at 20', () => {
    const records = [];
    for (let i = 0; i < 25; i++) {
      records.push({
        filePath: `/file${i}.ts`,
        language: 'typescript',
        originalTokens: 100,
        compactedTokens: 20,
      });
    }
    recordStats(records, 'analyze_files');
    const a = aggregate(readStats());
    assert.equal(a.recentActivity.length, 20);
    // most recent first
    assert.equal(a.recentActivity[0].filePath, '/file24.ts');
  });

  test('avgSavedPerFile is totalSaved / uniqueFiles', () => {
    recordStats([
      { filePath: '/a.ts', language: 'typescript', originalTokens: 1000, compactedTokens: 200 },
      { filePath: '/b.ts', language: 'typescript', originalTokens: 600, compactedTokens: 200 },
    ], 'analyze_files');
    const a = aggregate(readStats());
    // total saved = 1200, unique files = 2
    assert.equal(a.avgSavedPerFile, 600);
  });

  test('estimatedCost scales with tokens saved', () => {
    recordStats([
      { filePath: '/a.ts', language: 'typescript', originalTokens: 1_000_000, compactedTokens: 0 },
    ], 'analyze_files');
    const a = aggregate(readStats());
    // 1M tokens saved → GPT-4o $2.50, Sonnet $3.00
    assert.equal(a.estimatedCost.gpt4o, 2.50);
    assert.equal(a.estimatedCost.claudeSonnet, 3.00);
    assert.equal(a.estimatedCost.label, '~$3.00');
  });

  test('estimatedCost shows <$0.01 for small savings', () => {
    recordStats([
      { filePath: '/a.ts', language: 'typescript', originalTokens: 100, compactedTokens: 90 },
    ], 'analyze_files');
    const a = aggregate(readStats());
    assert.equal(a.estimatedCost.label, '<$0.01');
  });

  test('timeline has one point per call timestamp', () => {
    recordStats([
      { filePath: '/a.ts', language: 'typescript', originalTokens: 500, compactedTokens: 100 },
      { filePath: '/b.ts', language: 'typescript', originalTokens: 300, compactedTokens: 100 },
    ], 'analyze_files');
    const a = aggregate(readStats());
    // All records in the same call share a timestamp → 1 timeline point
    assert.equal(a.timeline.length, 1);
    assert.equal(a.timeline[0].tokensSaved, 600); // (500-100) + (300-100)
    assert.equal(a.timeline[0].totalSavedCumulative, 600);
  });

  test('timeline accumulates across multiple calls', () => {
    recordStats([
      { filePath: '/a.ts', language: 'typescript', originalTokens: 500, compactedTokens: 100 },
    ], 'analyze_files');

    // Slight delay to ensure different timestamp
    const records = readStats();
    const fakeTs = new Date(Date.now() + 1000).toISOString();
    const extraRecord = { timestamp: fakeTs, tool: 'analyze_files', filePath: '/b.ts', language: 'typescript', originalTokens: 300, compactedTokens: 100 };
    records.push(extraRecord);

    const a = aggregate(records);
    assert.equal(a.timeline.length, 2);
    assert.equal(a.timeline[0].tokensSaved, 400);
    assert.equal(a.timeline[0].totalSavedCumulative, 400);
    assert.equal(a.timeline[1].tokensSaved, 200);
    assert.equal(a.timeline[1].totalSavedCumulative, 600);
  });

  test('timeline is capped at 50 points', () => {
    // Create 60 separate calls with unique timestamps
    const records = [];
    for (let i = 0; i < 60; i++) {
      records.push({
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        tool: 'analyze_files',
        filePath: `/file${i}.ts`,
        language: 'typescript',
        originalTokens: 100,
        compactedTokens: 20,
      });
    }
    const a = aggregate(records);
    assert.equal(a.timeline.length, 50, 'timeline capped at 50');
  });
});

// ---- monthly aggregation ----------------------------------------------------

describe('monthKeyOf', () => {
  test('extracts YYYY-MM from ISO timestamps', () => {
    assert.equal(monthKeyOf('2026-06-09T10:00:00.000Z'), '2026-06');
    assert.equal(monthKeyOf('2025-12-31T23:59:59.999Z'), '2025-12');
  });

  test('returns null for unparseable timestamps', () => {
    assert.equal(monthKeyOf('not a date'), null);
  });
});

describe('aggregate byMonth', () => {
  function rec(ts, filePath, original, compacted) {
    return {
      timestamp: ts,
      tool: 'analyze_files',
      filePath,
      language: 'typescript',
      originalTokens: original,
      compactedTokens: compacted,
    };
  }

  test('empty state has empty byMonth', () => {
    assert.deepEqual(aggregate([]).byMonth, []);
  });

  test('buckets records into calendar months, newest first', () => {
    const a = aggregate([
      rec('2026-05-10T08:00:00.000Z', '/a.ts', 1000, 200),
      rec('2026-06-01T09:00:00.000Z', '/b.ts', 500, 100),
      rec('2026-06-15T10:00:00.000Z', '/c.ts', 300, 100),
    ]);

    assert.equal(a.byMonth.length, 2);
    assert.equal(a.byMonth[0].month, '2026-06');
    assert.equal(a.byMonth[0].analyses, 2);
    assert.equal(a.byMonth[0].calls, 2);
    assert.equal(a.byMonth[0].uniqueFiles, 2);
    assert.equal(a.byMonth[0].saved, 600); // (500-100) + (300-100)
    assert.equal(a.byMonth[1].month, '2026-05');
    assert.equal(a.byMonth[1].analyses, 1);
    assert.equal(a.byMonth[1].saved, 800);
  });

  test('computes per-month reduction and cost', () => {
    const a = aggregate([
      rec('2026-06-01T09:00:00.000Z', '/a.ts', 1_000_000, 0),
    ]);
    assert.equal(a.byMonth[0].reductionPercent, 100);
    assert.equal(a.byMonth[0].estimatedCost.gpt4o, 2.50);
    assert.equal(a.byMonth[0].estimatedCost.claudeSonnet, 3.00);
  });

  test('records sharing one call timestamp count as one call per month', () => {
    const ts = '2026-06-01T09:00:00.000Z';
    const a = aggregate([
      rec(ts, '/a.ts', 100, 20),
      rec(ts, '/b.ts', 100, 20),
    ]);
    assert.equal(a.byMonth[0].analyses, 2);
    assert.equal(a.byMonth[0].calls, 1);
  });

  test('formatMarkdown includes a By Month section', () => {
    const md = formatMarkdown(aggregate([
      rec('2026-06-01T09:00:00.000Z', '/a.ts', 1000, 100),
    ]));
    assert.ok(md.includes('## By Month'), 'markdown should have By Month section');
    assert.ok(md.includes('Jun 2026'), 'month should be human-readable');
  });

  test('formatTerminal includes a By Month section', () => {
    const out = formatTerminal(aggregate([
      rec('2026-06-01T09:00:00.000Z', '/a.ts', 1000, 100),
    ]));
    assert.ok(out.includes('By Month'), 'terminal output should have By Month section');
    assert.ok(out.includes('Jun 2026'), 'month should be human-readable');
  });

  test('computes month-over-month deltas on saved tokens', () => {
    const a = aggregate([
      rec('2026-05-10T08:00:00.000Z', '/a.ts', 1000, 200),
      rec('2026-06-01T09:00:00.000Z', '/b.ts', 500, 100),
    ]);
    assert.equal(a.byMonth[0].momSavedDelta, -400);
    assert.equal(a.byMonth[0].momSavedPercent, -50);
    assert.equal(a.byMonth[1].momSavedDelta, undefined);
  });

  test('formatMomDelta renders arrow and percent', () => {
    assert.equal(formatMomDelta(100, 25), '↑ 100 (+25%)');
    assert.equal(formatMomDelta(-50, -10), '↓ 50 (-10%)');
    assert.equal(formatMomDelta(0, 0), '→ flat');
  });

  test('formatMonthlyCsv includes header and mom columns', () => {
    const csv = formatMonthlyCsv(aggregate([
      rec('2026-05-10T08:00:00.000Z', '/a.ts', 1000, 200),
      rec('2026-06-01T09:00:00.000Z', '/b.ts', 500, 100),
    ]));
    assert.ok(csv.startsWith('month,analyses,calls,'));
    assert.ok(csv.includes('2026-06'));
    assert.ok(csv.includes('mom_saved_delta'));
  });

  test('monthlyAnalysisBudget reads TOKENSLAYER_MONTHLY_ANALYSIS_BUDGET', () => {
    process.env.TOKENSLAYER_MONTHLY_ANALYSIS_BUDGET = '500';
    assert.equal(getMonthlyAnalysisBudget(), 500);
    assert.equal(aggregate([]).monthlyAnalysisBudget, 500);
    delete process.env.TOKENSLAYER_MONTHLY_ANALYSIS_BUDGET;
    assert.equal(getMonthlyAnalysisBudget(), 0);
  });
});

// ---- clearStats -----------------------------------------------------------

describe('clearStats', () => {
  test('removes the stats file', () => {
    recordStats([{ filePath: '/a.ts', language: 'typescript', originalTokens: 100, compactedTokens: 20 }], 'analyze_files');
    assert.ok(fs.existsSync(getStatsFilePath()));
    clearStats();
    assert.equal(fs.existsSync(getStatsFilePath()), false);
    assert.deepEqual(readStats(), []);
  });

  test('is a no-op when no stats exist', () => {
    clearStats();
    // shouldn't throw
    clearStats();
    assert.deepEqual(readStats(), []);
  });
});
