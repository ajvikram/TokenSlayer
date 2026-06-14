'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeRotScore, scoreSeverity, recommendModel,
  computeHistory, computeTrend, primaryDriver,
} = require('../out/health/rotScoreEngine.js');

// Minimal TurnRecord factory.
function turn(over = {}) {
  return {
    timestamp: Date.now(),
    inputTokens: 5000,
    outputTokens: 1000,
    toolCalls: ['Read'],
    filesRead: ['a.ts'],
    userMessage: 'do a thing',
    model: 'claude-sonnet-4-6',
    ...over,
  };
}

describe('computeRotScore — new weights (depth no longer dominates)', () => {
  test('pure depth contributes only its 20% weight', () => {
    const s = { turnCount: 5, depthScore: 100, redundancyScore: 0, growthScore: 0, loopingScore: 0, verbosityScore: 0 };
    assert.equal(computeRotScore(s), 20);
  });

  test('a clean-but-long session is not critical from depth alone', () => {
    const s = { turnCount: 20, depthScore: 100, redundancyScore: 0, growthScore: 0, loopingScore: 0, verbosityScore: 0 };
    assert.notEqual(scoreSeverity(computeRotScore(s)), 'critical');
  });
});

describe('scoreSeverity thresholds', () => {
  test('boundaries', () => {
    assert.equal(scoreSeverity(34), 'healthy');
    assert.equal(scoreSeverity(35), 'amber');
    assert.equal(scoreSeverity(64), 'amber');
    assert.equal(scoreSeverity(65), 'critical');
  });
});

describe('recommendModel — cost uses ACTUAL tokens/turn', () => {
  test('Haiku estimate scales with the session, not a hardcoded 8k', () => {
    // 30k tokens/turn → Haiku ($0.80/1M) ≈ 0.024 USD/turn, not 0.0064 (old 8k figure)
    const rec = recommendModel(10, 'simple', 'claude-sonnet-4-6', 30_000);
    assert.equal(rec.model, 'claude-haiku-4-5-20251001');
    assert.ok(Math.abs(rec.estimatedCostPerTurn - 0.024) < 1e-6,
      `expected ~0.024, got ${rec.estimatedCostPerTurn}`);
  });

  test('falls back to the model default when session has no usage', () => {
    const rec = recommendModel(10, 'simple', 'claude-sonnet-4-6', 0);
    assert.ok(Math.abs(rec.estimatedCostPerTurn - 0.0064) < 1e-6);
  });
});

describe('computeHistory — trajectory reconstructed from transcript', () => {
  test('one point per turn, scores within 0..100', () => {
    const turns = Array.from({ length: 8 }, () => turn());
    const h = computeHistory(turns);
    assert.equal(h.length, 8);
    assert.deepEqual(h.map(p => p.turn), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (const p of h) { assert.ok(p.score >= 0 && p.score <= 100); }
  });
});

describe('computeTrend', () => {
  test('rising / falling / stable with a ±5 dead-band', () => {
    const mk = scores => scores.map((score, i) => ({ turn: i + 1, score }));
    assert.equal(computeTrend(mk([10, 20, 30, 45])), 'rising');
    assert.equal(computeTrend(mk([60, 50, 40, 30])), 'falling');
    assert.equal(computeTrend(mk([30, 31, 29, 32])), 'stable');
    assert.equal(computeTrend(mk([42])), 'stable');
  });
});

describe('primaryDriver — dominant weighted signal + product hint', () => {
  test('redundant reads dominate → structural-summary hint', () => {
    const s = { turnCount: 6, depthScore: 30, redundancyScore: 90, growthScore: 10, loopingScore: 0, verbosityScore: 0 };
    const d = primaryDriver(s);
    assert.equal(d.signal, 'Redundant reads');
    assert.match(d.hint, /structural-summary/);
  });

  test('depth dominates → /compact or fresh-session hint', () => {
    const s = { turnCount: 25, depthScore: 100, redundancyScore: 0, growthScore: 0, loopingScore: 0, verbosityScore: 0 };
    const d = primaryDriver(s);
    assert.equal(d.signal, 'Turn depth');
    assert.match(d.hint, /compact|fresh/i);
  });
});
