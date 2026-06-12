'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  LlmUsageTracker,
  parseTranscriptText,
  claudeProjectDir,
  monthKey,
} = require('../out/usage/llmUsageTracker.js');
const { ToolInvocationTracker } = require('../out/usage/toolInvocationTracker.js');

function usageLine(model, usage, timestamp) {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { model, usage },
  });
}

describe('claudeProjectDir', () => {
  test('slugs the workspace path like Claude Code does', () => {
    const dir = claudeProjectDir('/Users/me/my.app_dir', '/tmp/claude-home');
    assert.equal(dir, path.join('/tmp/claude-home', 'projects', '-Users-me-my-app-dir'));
  });
});

describe('parseTranscriptText', () => {
  test('aggregates usage per model and tracks last activity', () => {
    const text = [
      usageLine('claude-fable-5', {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
      }, '2026-06-09T10:00:00.000Z'),
      usageLine('claude-fable-5', {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }, '2026-06-09T11:00:00.000Z'),
      usageLine('claude-haiku-4-5-20251001', {
        input_tokens: 100,
        output_tokens: 200,
      }, '2026-06-09T09:00:00.000Z'),
      // Placeholder model ids and malformed lines are skipped.
      usageLine('<synthetic>', { input_tokens: 9999, output_tokens: 9999 }, '2026-06-09T12:00:00.000Z'),
      'not json at all',
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    ].join('\n');

    const { perModel, lastActivity } = parseTranscriptText(text);
    assert.equal(perModel.size, 2);
    const sonnet = perModel.get('claude-fable-5');
    assert.deepEqual(sonnet, {
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheCreationTokens: 44,
      requests: 2,
    });
    const haiku = perModel.get('claude-haiku-4-5-20251001');
    assert.equal(haiku.inputTokens, 100);
    assert.equal(haiku.cacheReadTokens, 0);
    assert.equal(haiku.requests, 1);
    assert.equal(lastActivity, Date.parse('2026-06-09T11:00:00.000Z'));
  });
});

describe('LlmUsageTracker.getUsage', () => {
  let home;
  let workspace;
  let projectDir;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-llm-home-'));
    workspace = '/Users/test/my-project';
    projectDir = claudeProjectDir(workspace, home);
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('reports unavailable when no transcript directory exists', () => {
    const tracker = new LlmUsageTracker();
    const usage = tracker.getUsage('/Users/test/other-project', home);
    assert.equal(usage.available, false);
    assert.equal(usage.totalTokens, 0);
    assert.equal(usage.sessionCount, 0);
  });

  test('aggregates across multiple session transcripts', () => {
    fs.writeFileSync(
      path.join(projectDir, 'a.jsonl'),
      usageLine('claude-fable-5', {
        input_tokens: 10, output_tokens: 20,
        cache_read_input_tokens: 100, cache_creation_input_tokens: 50,
      }, '2026-06-09T10:00:00.000Z')
    );
    fs.writeFileSync(
      path.join(projectDir, 'b.jsonl'),
      usageLine('claude-haiku-4-5-20251001', {
        input_tokens: 5, output_tokens: 5,
      }, '2026-06-09T12:00:00.000Z')
    );

    const tracker = new LlmUsageTracker();
    const usage = tracker.getUsage(workspace, home);
    assert.equal(usage.available, true);
    assert.equal(usage.sessionCount, 2);
    assert.equal(usage.inputTokens, 15);
    assert.equal(usage.outputTokens, 25);
    assert.equal(usage.cacheReadTokens, 100);
    assert.equal(usage.cacheCreationTokens, 50);
    assert.equal(usage.totalTokens, 190);
    // Sorted by total descending: sonnet (180) first.
    assert.equal(usage.byModel[0].model, 'claude-fable-5');
    assert.equal(usage.byModel[0].totalTokens, 180);
    assert.equal(usage.lastActivity, Date.parse('2026-06-09T12:00:00.000Z'));
  });

  test('picks up appended usage on refresh (mtime/size cache invalidation)', () => {
    const file = path.join(projectDir, 'a.jsonl');
    fs.writeFileSync(
      file,
      usageLine('claude-fable-5', { input_tokens: 10, output_tokens: 10 }, '2026-06-09T10:00:00.000Z')
    );

    const tracker = new LlmUsageTracker();
    assert.equal(tracker.getUsage(workspace, home).totalTokens, 20);

    fs.appendFileSync(
      file,
      '\n' + usageLine('claude-fable-5', { input_tokens: 1, output_tokens: 1 }, '2026-06-09T10:05:00.000Z')
    );
    assert.equal(tracker.getUsage(workspace, home).totalTokens, 22);
  });

  test('buckets usage by calendar month, newest first', () => {
    fs.writeFileSync(
      path.join(projectDir, 'a.jsonl'),
      [
        usageLine('claude-fable-5', { input_tokens: 10, output_tokens: 10 }, '2026-05-15T10:00:00.000Z'),
        usageLine('claude-fable-5', { input_tokens: 20, output_tokens: 20 }, '2026-06-09T10:00:00.000Z'),
        usageLine('claude-fable-5', { input_tokens: 5, output_tokens: 5 }, '2026-06-10T10:00:00.000Z'),
      ].join('\n')
    );

    const tracker = new LlmUsageTracker();
    const usage = tracker.getUsage(workspace, home);

    assert.equal(usage.byMonth.length, 2);
    // Newest month first
    assert.equal(usage.byMonth[0].month, monthKey(Date.parse('2026-06-09T10:00:00.000Z')));
    assert.equal(usage.byMonth[0].totalTokens, 50);
    assert.equal(usage.byMonth[0].requests, 2);
    assert.equal(usage.byMonth[0].models.length, 1);
    assert.equal(usage.byMonth[0].models[0].model, 'claude-fable-5');
    assert.equal(usage.byMonth[0].models[0].requests, 2);
    assert.equal(usage.byMonth[1].month, monthKey(Date.parse('2026-05-15T10:00:00.000Z')));
    assert.equal(usage.byMonth[1].totalTokens, 20);
    assert.equal(usage.byMonth[1].requests, 1);
  });

  test('merges monthly buckets across multiple transcripts', () => {
    fs.writeFileSync(
      path.join(projectDir, 'a.jsonl'),
      usageLine('claude-fable-5', { input_tokens: 10, output_tokens: 0 }, '2026-06-01T10:00:00.000Z')
    );
    fs.writeFileSync(
      path.join(projectDir, 'b.jsonl'),
      usageLine('claude-haiku-4-5-20251001', { input_tokens: 30, output_tokens: 0 }, '2026-06-20T10:00:00.000Z')
    );

    const tracker = new LlmUsageTracker();
    const usage = tracker.getUsage(workspace, home);
    assert.equal(usage.byMonth.length, 1);
    assert.equal(usage.byMonth[0].totalTokens, 40);
    assert.equal(usage.byMonth[0].requests, 2);
    assert.equal(usage.byMonth[0].models.length, 2);
  });
});

describe('parseTranscriptText perMonth', () => {
  test('records without timestamps count toward models but not months', () => {
    const noTs = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-fable-5', usage: { input_tokens: 7, output_tokens: 3 } },
    });
    const { perModel, perMonth } = parseTranscriptText(noTs);
    assert.equal(perModel.get('claude-fable-5').inputTokens, 7);
    assert.equal(perMonth.size, 0);
  });
});

describe('ToolInvocationTracker monthly counts', () => {
  function memento() {
    const store = new Map();
    return {
      get(key, fallback) { return store.has(key) ? store.get(key) : fallback; },
      update(key, value) { store.set(key, value); return Promise.resolve(); },
    };
  }

  test('records all-time and current-month counts', () => {
    const tracker = new ToolInvocationTracker(memento());
    tracker.record('tokenslayer-structural-summary');
    tracker.record('tokenslayer-structural-summary');
    tracker.record('tokenslayer-apply-patch');

    assert.deepEqual(tracker.get(), {
      'tokenslayer-structural-summary': 2,
      'tokenslayer-apply-patch': 1,
    });

    const current = tracker.getCurrentMonth();
    assert.equal(current['tokenslayer-structural-summary'], 2);
    assert.equal(current['tokenslayer-apply-patch'], 1);

    const byMonth = tracker.getByMonth();
    const months = Object.keys(byMonth);
    assert.equal(months.length, 1);
    assert.match(months[0], /^\d{4}-\d{2}$/);
  });

  test('prunes to at most 12 months of history', () => {
    const state = memento();
    // Seed 13 historical months directly.
    const seeded = {};
    for (let i = 1; i <= 13; i++) {
      seeded[`2025-${String(i).padStart(2, '0')}`] = { tool: 1 };
    }
    // Month 13 is invalid as a date but fine as a sort key for pruning logic.
    state.update('tokenslayer.toolInvocationsByMonth', seeded);

    const tracker = new ToolInvocationTracker(state);
    tracker.record('tool');

    const months = Object.keys(tracker.getByMonth());
    assert.ok(months.length <= 12, `expected <= 12 months, got ${months.length}`);
  });
});
