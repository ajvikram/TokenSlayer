'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { TokenEstimator } = require('../out/utils/tokenEstimator.js');

describe('TokenEstimator.estimate', () => {
  test('returns 0 for empty string', () => {
    assert.equal(TokenEstimator.estimate(''), 0);
  });

  test('returns 0 for null/undefined', () => {
    assert.equal(TokenEstimator.estimate(null), 0);
    assert.equal(TokenEstimator.estimate(undefined), 0);
  });

  test('approximates ~1 token per 4 chars when BPE tokenizer is unavailable', () => {
    // "abcd" = 4 chars → 1 token
    assert.equal(TokenEstimator.estimate('abcd'), 1);
    // "abcde" = 5 chars → ceil(5/4) = 2
    assert.equal(TokenEstimator.estimate('abcde'), 2);
    // "abcdefgh" = 8 chars → 2
    assert.equal(TokenEstimator.estimate('abcdefgh'), 2);
  });

  test('monotonic: longer text → more tokens', () => {
    const a = TokenEstimator.estimate('hello world');
    const b = TokenEstimator.estimate('hello world hello world hello world hello world');
    assert.ok(b > a, `${b} should be > ${a}`);
  });
});

describe('TokenEstimator.reductionPercent', () => {
  test('returns 0 when original is 0 (no divide-by-zero)', () => {
    assert.equal(TokenEstimator.reductionPercent(0, 0), 0);
    assert.equal(TokenEstimator.reductionPercent(0, 100), 0);
  });

  test('100 → 20 = 80% reduction', () => {
    assert.equal(TokenEstimator.reductionPercent(100, 20), 80);
  });

  test('1000 → 50 = 95% reduction', () => {
    assert.equal(TokenEstimator.reductionPercent(1000, 50), 95);
  });

  test('rounds to 1 decimal place', () => {
    // 1000 → 333 = 66.7%
    assert.equal(TokenEstimator.reductionPercent(1000, 333), 66.7);
  });

  test('returns negative when compaction inflated', () => {
    // 100 → 150 = -50%
    assert.equal(TokenEstimator.reductionPercent(100, 150), -50);
  });

  test('returns 0 when no change', () => {
    assert.equal(TokenEstimator.reductionPercent(100, 100), 0);
  });
});

describe('TokenEstimator.formatCount', () => {
  test('inserts thousands separators (en-US)', () => {
    assert.equal(TokenEstimator.formatCount(0), '0');
    assert.equal(TokenEstimator.formatCount(123), '123');
    assert.equal(TokenEstimator.formatCount(1234), '1,234');
    assert.equal(TokenEstimator.formatCount(1234567), '1,234,567');
  });

  test('handles negatives', () => {
    assert.equal(TokenEstimator.formatCount(-1234), '-1,234');
  });
});

describe('TokenEstimator.savingsSummary', () => {
  test('formats: "X tokens saved (Y% reduction)"', () => {
    const summary = TokenEstimator.savingsSummary(1000, 100);
    assert.match(summary, /^900 tokens saved \(90% reduction\)$/);
  });

  test('handles zero original gracefully', () => {
    const summary = TokenEstimator.savingsSummary(0, 0);
    assert.match(summary, /0 tokens saved \(0% reduction\)/);
  });

  test('formats large numbers with separators', () => {
    const summary = TokenEstimator.savingsSummary(1_000_000, 50_000);
    assert.match(summary, /^950,000 tokens saved \(95% reduction\)$/);
  });
});
