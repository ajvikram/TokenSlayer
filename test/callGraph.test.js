'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  transitiveCallers,
  formatCallers,
  formatCallees,
  formatImpact,
} = require('../out/graph/callGraph.js');

// Fake edge source backed by an adjacency map of incoming edges.
// graph[key] = array of caller nodes. key = `${file}:${line}:${name}`.
function fakeSource(incomingMap, outgoingMap = {}) {
  const k = (n) => `${n.file}:${n.line}:${n.name}`;
  return {
    async incoming(node) { return incomingMap[k(node)] || []; },
    async outgoing(node) { return outgoingMap[k(node)] || []; },
  };
}

const N = (name, line) => ({ name, file: 'a.ts', line });

describe('transitiveCallers', () => {
  test('collects direct and indirect callers in BFS order with depth', async () => {
    const root = N('target', 10);
    const c1 = N('caller1', 20);
    const c2 = N('caller2', 30);
    const c3 = N('grandcaller', 40);
    const src = fakeSource({
      'a.ts:10:target': [c1, c2],
      'a.ts:20:caller1': [c3],
    });

    const result = await transitiveCallers(root, src, 5);
    assert.deepEqual(
      result.map((r) => [r.node.name, r.depth]),
      [['caller1', 1], ['caller2', 1], ['grandcaller', 2]],
    );
  });

  test('respects maxDepth', async () => {
    const root = N('target', 10);
    const src = fakeSource({
      'a.ts:10:target': [N('c1', 20)],
      'a.ts:20:c1': [N('c2', 30)],
      'a.ts:30:c2': [N('c3', 40)],
    });
    const result = await transitiveCallers(root, src, 1);
    assert.deepEqual(result.map((r) => r.node.name), ['c1']);
  });

  test('is cycle-safe', async () => {
    const root = N('a', 1);
    const src = fakeSource({
      'a.ts:1:a': [N('b', 2)],
      'a.ts:2:b': [N('a', 1)], // b calls a -> cycle back to root
    });
    const result = await transitiveCallers(root, src, 10);
    assert.deepEqual(result.map((r) => r.node.name), ['b']); // root not re-added
  });

  test('caps total nodes', async () => {
    const callers = Array.from({ length: 50 }, (_, i) => N('c' + i, 100 + i));
    const src = fakeSource({ 'a.ts:1:root': callers });
    const result = await transitiveCallers(N('root', 1), src, 5, 10);
    assert.equal(result.length, 10);
  });
});

describe('formatting', () => {
  test('callers: empty vs populated', () => {
    assert.match(formatCallers(N('foo', 1), []), /No callers found for foo/);
    const out = formatCallers(N('foo', 1), [N('bar', 5)]);
    assert.match(out, /foo is called by 1 site/);
    assert.match(out, /bar \(a\.ts:5\)/);
  });

  test('callees: empty vs populated', () => {
    assert.match(formatCallees(N('foo', 1), []), /calls no other tracked/);
    assert.match(formatCallees(N('foo', 1), [N('bar', 5)]), /foo calls 1 function/);
  });

  test('impact groups by depth', () => {
    const ranked = [
      { node: N('direct', 5), depth: 1 },
      { node: N('indirect', 9), depth: 2 },
    ];
    const out = formatImpact(N('foo', 1), ranked);
    assert.match(out, /affect 2 dependent site/);
    assert.match(out, /direct callers:/);
    assert.match(out, /depth 2 \(indirect\):/);
  });
});
