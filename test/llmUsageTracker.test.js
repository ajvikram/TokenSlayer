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
} = require('../out/usage/llmUsageTracker.js');

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
    });
    const haiku = perModel.get('claude-haiku-4-5-20251001');
    assert.equal(haiku.inputTokens, 100);
    assert.equal(haiku.cacheReadTokens, 0);
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
});
