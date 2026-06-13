'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, beforeEach, afterEach } = require('node:test');

const {
  CopilotUsageTracker,
  findChatSessionDirs,
  parseChatSessionText,
} = require('../out/usage/copilotUsageTracker');

const JUNE = Date.UTC(2026, 5, 10); // 2026-06
const MAY = Date.UTC(2026, 4, 20);  // 2026-05

/**
 * Build a session op-log the way VS Code writes them: a kind-0 snapshot, then
 * each new request arrives as a kind-2 append of a one-item list to
 * `['requests']`, with kind-1 set-ops patching fields afterwards.
 */
function opLog(requests, creationDate) {
  const lines = [
    JSON.stringify({ kind: 0, v: { version: 1, sessionId: 's1', creationDate, requests: [] } }),
    ...requests.map((r) => JSON.stringify({ kind: 2, k: ['requests'], v: [r] })),
    JSON.stringify({ kind: 1, k: ['requests', 0, 'isCompleteAddedRequest'], v: false }),
    // Streaming response parts also arrive as kind-2 appends; must not affect counts.
    JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], v: [{ kind: 'markdownContent' }] }),
  ];
  return lines.join('\n') + '\n';
}

describe('parseChatSessionText', () => {
  it('replays snapshot + set-ops into the requests array', () => {
    const text = opLog(
      [
        { timestamp: JUNE, modelId: 'copilot/gpt-4.1', message: { text: 'q1' } },
        { timestamp: JUNE, result: { details: { modelId: 'copilot/gpt-5-mini' } } },
      ],
      JUNE,
    );
    const { requests, creationDate } = parseChatSessionText(text);
    assert.equal(requests.length, 2);
    assert.equal(creationDate, JUNE);
  });

  it('handles deep-path ops creating request fields', () => {
    const lines = [
      JSON.stringify({ kind: 0, v: { creationDate: MAY, requests: [] } }),
      JSON.stringify({ kind: 1, k: ['requests', 0, 'message'], v: { text: 'hello' } }),
      JSON.stringify({ kind: 1, k: ['requests', 0, 'timestamp'], v: MAY }),
    ];
    const { requests } = parseChatSessionText(lines.join('\n'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].timestamp, MAY);
  });

  it('parses legacy single-object .json sessions', () => {
    const legacy = JSON.stringify({
      creationDate: MAY,
      requests: [{ timestamp: MAY, modelId: 'copilot/gpt-4o' }],
    });
    const { requests, creationDate } = parseChatSessionText(legacy);
    assert.equal(requests.length, 1);
    assert.equal(creationDate, MAY);
  });

  it('ignores malformed lines and unknown op kinds', () => {
    const text = [
      'not json',
      JSON.stringify({ kind: 0, v: { creationDate: JUNE, requests: [{ timestamp: JUNE }] } }),
      JSON.stringify({ kind: 7, k: ['requests'], v: 'garbage' }),
    ].join('\n');
    const { requests } = parseChatSessionText(text);
    assert.equal(requests.length, 1);
  });
});

describe('CopilotUsageTracker.getUsage', () => {
  let storageRoot;
  let workspace;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-copilot-storage-'));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-copilot-ws-'));
  });

  afterEach(() => {
    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  function writeStorage(hash, folderPath, sessions) {
    const dir = path.join(storageRoot, hash);
    const chatDir = path.join(dir, 'chatSessions');
    fs.mkdirSync(chatDir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'workspace.json'),
      JSON.stringify({ folder: 'file://' + folderPath }),
    );
    for (const [name, text] of Object.entries(sessions)) {
      fs.writeFileSync(path.join(chatDir, name), text);
    }
  }

  it('finds the matching storage dir and counts requests monthly + total', () => {
    writeStorage('aaa', workspace, {
      'one.jsonl': opLog(
        [
          { timestamp: JUNE, modelId: 'copilot/gpt-4.1', message: { text: 'a' } },
          { timestamp: JUNE, modelId: 'copilot/gpt-4.1', message: { text: 'b' } },
          { timestamp: MAY, modelId: 'copilot/gpt-5-mini', message: { text: 'c' } },
        ],
        MAY,
      ),
      // Second session: no per-request timestamp -> falls back to creationDate.
      'two.jsonl': opLog([{ modelId: 'copilot/gpt-4.1', message: { text: 'd' } }], MAY),
    });
    // A different workspace's storage must not be counted.
    writeStorage('bbb', '/somewhere/else', {
      'other.jsonl': opLog([{ timestamp: JUNE, modelId: 'x', message: {} }], JUNE),
    });

    const tracker = new CopilotUsageTracker([storageRoot]);
    const usage = tracker.getUsage(workspace);

    assert.equal(usage.available, true);
    assert.equal(usage.totalRequests, 4);
    assert.equal(usage.sessionCount, 2);
    assert.deepEqual(
      usage.byMonth.map((m) => [m.month, m.requests]),
      [['2026-06', 2], ['2026-05', 2]],
    );
    assert.equal(usage.byModel[0].model, 'copilot/gpt-4.1');
    assert.equal(usage.byModel[0].requests, 3);
    assert.equal(usage.lastActivity, JUNE);
  });

  it('reports unavailable when no storage folder matches the workspace', () => {
    writeStorage('ccc', '/some/other/project', { 'a.jsonl': opLog([], MAY) });
    const tracker = new CopilotUsageTracker([storageRoot]);
    const usage = tracker.getUsage(workspace);
    assert.equal(usage.available, false);
    assert.equal(usage.totalRequests, 0);
  });

  it('skips empty placeholder request items', () => {
    writeStorage('ddd', workspace, {
      'sparse.jsonl': [
        JSON.stringify({ kind: 0, v: { creationDate: JUNE, requests: [] } }),
        // Deep op at index 2 pads indices 0-1 with placeholders.
        JSON.stringify({ kind: 1, k: ['requests', 2, 'message'], v: { text: 'only real one' } }),
      ].join('\n'),
    });
    const tracker = new CopilotUsageTracker([storageRoot]);
    const usage = tracker.getUsage(workspace);
    assert.equal(usage.totalRequests, 1);
  });

  it('findChatSessionDirs matches URI-encoded folder paths', () => {
    const spaced = path.join(workspace, 'My Project');
    fs.mkdirSync(spaced);
    const dir = path.join(storageRoot, 'eee');
    fs.mkdirSync(path.join(dir, 'chatSessions'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'workspace.json'),
      JSON.stringify({ folder: 'file://' + encodeURI(spaced) }),
    );
    const dirs = findChatSessionDirs(spaced, [storageRoot]);
    assert.equal(dirs.length, 1);
  });
});
