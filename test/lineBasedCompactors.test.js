'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CompactorFactory } = require('../out/compaction/compactor.js');
const { ExpandNodeTool } = require('../out/tools/expandNodeTool.js');

function compact(languageId, content, filename) {
  const c = CompactorFactory.getCompactor(languageId);
  assert.ok(c, `no compactor registered for ${languageId}`);
  return c.compact([], content, `/proj/${filename}`);
}

describe('line-based compactors registration', () => {
  test('factory has compactors for the new languages', () => {
    for (const lang of ['php', 'ruby', 'swift', 'sql', 'vue', 'svelte']) {
      assert.ok(CompactorFactory.hasCompactor(lang), `missing ${lang}`);
    }
  });
});

describe('PHP compactor', () => {
  const sample = `<?php
namespace App\\Services;

use App\\Models\\User;

class UserService {
  private $repo;

  public function findUser(int $id): ?User {
    $row = $this->repo->find($id);
    return $row ? new User($row) : null;
  }
}
`;
  test('keeps class and method signatures, strips bodies', () => {
    const s = compact('php', sample, 'UserService.php');
    assert.ok(s.includes('namespace App\\Services;'));
    assert.ok(s.includes('class UserService'));
    assert.ok(/public function findUser\(int \$id\): \?User/.test(s));
    assert.ok(!s.includes('$this->repo->find'));
  });
});

describe('Ruby compactor', () => {
  const sample = `require 'json'

class OrderProcessor
  has_many :items
  validates :total, presence: true

  def process(order)
    total = order.items.sum(&:price)
    total
  end
end
`;
  test('keeps class, macros, and def signatures, strips bodies', () => {
    const s = compact('ruby', sample, 'order_processor.rb');
    assert.ok(s.includes('class OrderProcessor'));
    assert.ok(s.includes('has_many :items'));
    assert.ok(/def process\(order\) \.\.\. end/.test(s));
    assert.ok(!s.includes('order.items.sum'));
  });
});

describe('Swift compactor', () => {
  const sample = `import Foundation

struct Point {
    var x: Double
    var y: Double
}

class Renderer {
    func draw(point: Point) -> Bool {
        let scaled = point.x * 2
        return scaled > 0
    }
}
`;
  test('preserves struct bodies and collapses func bodies', () => {
    const s = compact('swift', sample, 'renderer.swift');
    assert.ok(s.includes('struct Point'));
    assert.ok(s.includes('var x: Double'));
    assert.ok(/func draw\(point: Point\) -> Bool/.test(s));
    assert.ok(!s.includes('point.x * 2'));
  });
});

describe('SQL compactor', () => {
  const sample = `-- schema
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

INSERT INTO users (email) VALUES ('a@b.c');
`;
  test('keeps DDL structure and column definitions', () => {
    const s = compact('sql', sample, 'schema.sql');
    assert.ok(s.includes('CREATE TABLE users'));
    assert.ok(s.includes('id SERIAL PRIMARY KEY'));
    assert.ok(s.includes('email VARCHAR(255) NOT NULL'));
  });
});

describe('Vue compactor', () => {
  const sample = `<template>
  <div class="card">
    <h1>Orders</h1>
    <p>This is a long descriptive paragraph that should be elided away.</p>
  </div>
</template>

<script>
export default {
  name: 'OrderCard',
}
function helper(x) {
  const secretWork = x * 2;
  return secretWork;
}
</script>

<style>
.card { padding: 4px; }
</style>
`;
  test('keeps template structure and script signatures, strips bodies', () => {
    const s = compact('vue', sample, 'OrderCard.vue');
    assert.ok(s.includes('<template>'));
    assert.ok(s.includes('<h1>Orders</h1>'));
    assert.ok(s.includes('function helper(x) { /* ... */ }'));
    assert.ok(!s.includes('secretWork'));
    assert.ok(s.includes('<style>'));
  });
});

describe('ExpandNodeTool', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-expand-'));
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function makeNodeId(filePath, startLine, endLine, kind) {
    return Buffer.from(`${filePath}:${startLine}:${endLine}:${kind}`).toString('base64url');
  }

  test('expands a node id back to the source slice', async () => {
    const file = path.join(tmp, 'sample.ts');
    fs.writeFileSync(file, ['line one', 'function target() {', '  return 42;', '}', 'line five'].join('\n'));

    const tool = new ExpandNodeTool();
    const result = await tool.invoke({ input: { nodeId: makeNodeId(file, 2, 4, 'body') } }, {});
    const text = result.content[0].value;
    assert.ok(text.includes('function target() {'));
    assert.ok(text.includes('return 42;'));
    assert.ok(!text.includes('line five'));
    assert.ok(text.includes('lines 2-4'));
  });

  test('rejects an invalid node id gracefully', async () => {
    const tool = new ExpandNodeTool();
    const result = await tool.invoke({ input: { nodeId: '!!!not-base64url!!!' } }, {});
    assert.match(result.content[0].value, /Invalid nodeId/);
  });
});
