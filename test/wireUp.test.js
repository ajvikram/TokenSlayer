'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const vscode = require('./_mocks/vscode.js');
const { wireUpCopilot } = require('../out/copilot/wireUp.js');

const INSTRUCTIONS_START = '<!-- TOKENSLAYER:START — managed block, do not edit between markers -->';
const INSTRUCTIONS_END = '<!-- TOKENSLAYER:END -->';

let tmpRoot;
let mockContext;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenslayer-wireup-'));
  vscode.__setWorkspaceRoot(tmpRoot);
  vscode.__clearShownMessages();
  vscode.__setNextMessageResponse(undefined);
  mockContext = { extensionPath: '/fake/ext/path' };
});

afterEach(() => {
  vscode.__setWorkspaceRoot(null);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

const instructionsPath = () => path.join(tmpRoot, '.github', 'copilot-instructions.md');
const mcpConfigPath = () => path.join(tmpRoot, '.vscode', 'mcp.json');

// ---- Fresh-install behavior ---------------------------------------------

describe('wireUpCopilot — fresh workspace', () => {
  test('creates .github/copilot-instructions.md with managed block', async () => {
    await wireUpCopilot(mockContext);
    const content = fs.readFileSync(instructionsPath(), 'utf-8');
    assert.ok(content.includes(INSTRUCTIONS_START));
    assert.ok(content.includes(INSTRUCTIONS_END));
    assert.ok(content.includes('TokenSlayer'));
    assert.ok(content.includes('#tokenslayer-structural-summary'));
  });

  test('creates .vscode/mcp.json with tokenslayer server registered', async () => {
    await wireUpCopilot(mockContext);
    const cfg = JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf-8'));
    assert.ok(cfg.servers);
    assert.ok(cfg.servers.tokenslayer);
    assert.equal(cfg.servers.tokenslayer.type, 'stdio');
    assert.equal(cfg.servers.tokenslayer.command, 'node');
    assert.ok(cfg.servers.tokenslayer.args[0].endsWith('mcp-server/build/index.js'));
  });

  test('creates parent directories as needed', async () => {
    await wireUpCopilot(mockContext);
    assert.ok(fs.existsSync(path.join(tmpRoot, '.github')));
    assert.ok(fs.existsSync(path.join(tmpRoot, '.vscode')));
  });

  test('shows success message naming both files', async () => {
    await wireUpCopilot(mockContext);
    const msgs = vscode.__getShownMessages();
    const info = msgs.find(m => m.type === 'info');
    assert.ok(info, 'expected an info message');
    assert.ok(info.message.includes('.github/copilot-instructions.md'));
    assert.ok(info.message.includes('.vscode/mcp.json'));
  });
});

// ---- Idempotency --------------------------------------------------------

describe('wireUpCopilot — idempotency', () => {
  test('second run produces identical files (no diff)', async () => {
    await wireUpCopilot(mockContext);
    const instr1 = fs.readFileSync(instructionsPath(), 'utf-8');
    const mcp1 = fs.readFileSync(mcpConfigPath(), 'utf-8');

    await wireUpCopilot(mockContext);
    const instr2 = fs.readFileSync(instructionsPath(), 'utf-8');
    const mcp2 = fs.readFileSync(mcpConfigPath(), 'utf-8');

    assert.equal(instr1, instr2, 'instructions file unchanged on second run');
    assert.equal(mcp1, mcp2, 'mcp.json unchanged on second run');
  });

  test('second run shows "already up to date" message', async () => {
    await wireUpCopilot(mockContext);
    vscode.__clearShownMessages();

    await wireUpCopilot(mockContext);
    const msgs = vscode.__getShownMessages();
    assert.ok(msgs.some(m => /already up to date/i.test(m.message)),
      `expected 'already up to date'; got: ${msgs.map(m => m.message).join(' | ')}`);
  });
});

// ---- Preserving user content (managed-block protocol) -----------------

describe('wireUpCopilot — preserving existing user content', () => {
  test('appends managed block to an existing instructions file without losing prior content', async () => {
    fs.mkdirSync(path.join(tmpRoot, '.github'), { recursive: true });
    const userContent = '# My Project Instructions\n\nUse 4-space indent.\n';
    fs.writeFileSync(instructionsPath(), userContent);

    await wireUpCopilot(mockContext);

    const merged = fs.readFileSync(instructionsPath(), 'utf-8');
    assert.ok(merged.startsWith(userContent), 'original user content must lead the file');
    assert.ok(merged.includes(INSTRUCTIONS_START), 'managed block was appended');
    assert.ok(merged.includes(INSTRUCTIONS_END));
  });

  test('replaces ONLY the managed block on re-run; user content above and below is preserved', async () => {
    fs.mkdirSync(path.join(tmpRoot, '.github'), { recursive: true });
    const before = '# Before User Content\nLine A\n';
    const after = '\n# After User Content\nLine Z\n';
    const stale = INSTRUCTIONS_START + '\n[STALE OLD MANAGED CONTENT]\n' + INSTRUCTIONS_END;
    fs.writeFileSync(instructionsPath(), before + stale + after);

    await wireUpCopilot(mockContext);

    const next = fs.readFileSync(instructionsPath(), 'utf-8');
    assert.ok(next.startsWith(before), 'content before the managed block preserved');
    assert.ok(next.endsWith(after), 'content after the managed block preserved');
    assert.ok(!next.includes('[STALE OLD MANAGED CONTENT]'), 'stale managed content removed');
    assert.ok(next.includes(INSTRUCTIONS_START));
    assert.ok(next.includes('#tokenslayer-structural-summary'), 'fresh managed content written');
  });

  test('preserves other MCP servers when merging mcp.json', async () => {
    fs.mkdirSync(path.join(tmpRoot, '.vscode'), { recursive: true });
    const userMcp = {
      servers: {
        'another-server': { type: 'stdio', command: 'python', args: ['-m', 'something'] },
        'github-mcp': { type: 'http', command: '', args: [] },
      },
      inputs: [{ id: 'foo', type: 'promptString' }],
    };
    fs.writeFileSync(mcpConfigPath(), JSON.stringify(userMcp, null, 2));

    await wireUpCopilot(mockContext);

    const merged = JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf-8'));
    assert.ok(merged.servers.tokenslayer, 'tokenslayer server added');
    assert.ok(merged.servers['another-server'], 'other server preserved');
    assert.ok(merged.servers['github-mcp'], 'second other server preserved');
    assert.equal(merged.servers['another-server'].command, 'python', 'other server config intact');
    assert.deepEqual(merged.inputs, userMcp.inputs, 'inputs[] preserved');
  });

  test('recovers from a malformed mcp.json by starting fresh (does not crash)', async () => {
    fs.mkdirSync(path.join(tmpRoot, '.vscode'), { recursive: true });
    fs.writeFileSync(mcpConfigPath(), '{ this is not valid JSON');

    await assert.doesNotReject(wireUpCopilot(mockContext));

    const merged = JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf-8'));
    assert.ok(merged.servers.tokenslayer, 'recovered with tokenslayer server registered');
  });
});

// ---- Edge cases ---------------------------------------------------------

describe('wireUpCopilot — edge cases', () => {
  test('shows a warning and writes nothing when no workspace folder is open', async () => {
    vscode.__setWorkspaceRoot(null);

    await wireUpCopilot(mockContext);

    const msgs = vscode.__getShownMessages();
    assert.ok(msgs.some(m => m.type === 'warning' && /open a workspace folder/i.test(m.message)),
      `expected warning about workspace folder; got: ${msgs.map(m => m.type + ':' + m.message).join(' | ')}`);
    assert.ok(!fs.existsSync(instructionsPath()));
    assert.ok(!fs.existsSync(mcpConfigPath()));
  });

  test('does not duplicate the managed block when run twice', async () => {
    await wireUpCopilot(mockContext);
    await wireUpCopilot(mockContext);

    const content = fs.readFileSync(instructionsPath(), 'utf-8');
    const startCount = content.split(INSTRUCTIONS_START).length - 1;
    const endCount = content.split(INSTRUCTIONS_END).length - 1;
    assert.equal(startCount, 1, `expected exactly 1 START marker, found ${startCount}`);
    assert.equal(endCount, 1, `expected exactly 1 END marker, found ${endCount}`);
  });
});
