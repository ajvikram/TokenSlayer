'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ============================================================================
// layoutOptimizer tests
// ============================================================================
const { optimizeLayout } = require('../out/utils/layoutOptimizer.js');

describe('optimizeLayout', () => {
  test('returns skeleton unchanged when no targetModel', () => {
    const skeleton = 'class Foo {\n  bar() {}\n}';
    assert.equal(optimizeLayout(skeleton), skeleton);
    assert.equal(optimizeLayout(skeleton, ''), skeleton);
    assert.equal(optimizeLayout(skeleton, undefined), skeleton);
  });

  test('collapses 3+ blank lines to 1', () => {
    const input = 'a\n\n\n\nb';
    const result = optimizeLayout(input, 'gpt-4o');
    assert.equal(result, 'a\n\nb');
  });

  test('strips trailing whitespace', () => {
    const input = 'hello   \nworld\t\t';
    const result = optimizeLayout(input, 'gpt-4o');
    assert.ok(!result.match(/[ \t]+$/m));
  });

  test('compacts braces between declarations', () => {
    const input = '}\n\nexport function bar() {}';
    const result = optimizeLayout(input, 'gpt-4');
    assert.equal(result, '}\nexport function bar() {}');
  });

  test('minifies tab indentation to 2-space', () => {
    const input = '\tfunction foo() {}';
    const result = optimizeLayout(input, 'gpt-4o');
    assert.equal(result, '  function foo() {}');
  });

  test('minifies 4-space indentation to 2-space', () => {
    const input = '    function foo() {}';
    const result = optimizeLayout(input, 'claude');
    assert.equal(result, '  function foo() {}');
  });

  test('preserves 2-space indentation', () => {
    const input = '  function foo() {}';
    const result = optimizeLayout(input, 'gpt-4o');
    assert.equal(result, '  function foo() {}');
  });
});

// ============================================================================
// importResolver tests
// ============================================================================
const {
  extractImportSpecifiers,
  resolveImport,
  buildDependencyChain,
} = require('../out/utils/importResolver.js');

describe('extractImportSpecifiers', () => {
  test('extracts TypeScript/ES imports', () => {
    const content = `
      import { Foo } from './foo';
      import bar from './bar';
      const baz = require('./baz');
    `;
    const specs = extractImportSpecifiers(content, 'typescript');
    assert.ok(specs.includes('./foo'));
    assert.ok(specs.includes('./bar'));
    assert.ok(specs.includes('./baz'));
  });

  test('extracts Python imports', () => {
    const content = `
from .models import User
import os
from utils.helpers import format
    `;
    const specs = extractImportSpecifiers(content, 'python');
    assert.ok(specs.includes('.models'));
    assert.ok(specs.includes('os'));
    assert.ok(specs.includes('utils.helpers'));
  });

  test('extracts Rust use specifiers', () => {
    const content = `
use crate::models::User;
use super::config::Settings;
mod database;
    `;
    const specs = extractImportSpecifiers(content, 'rust');
    assert.ok(specs.includes('crate::models::User'));
    assert.ok(specs.includes('super::config::Settings'));
    assert.ok(specs.includes('mod::database'));
  });

  test('deduplicates specifiers', () => {
    const content = `
import { A } from './shared';
import { B } from './shared';
    `;
    const specs = extractImportSpecifiers(content, 'typescript');
    const sharedCount = specs.filter(s => s === './shared').length;
    assert.equal(sharedCount, 1);
  });

  test('returns empty for unsupported languages', () => {
    const specs = extractImportSpecifiers('using System;', 'csharp');
    assert.deepEqual(specs, []);
  });
});

describe('resolveImport', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-resolve-'));
  const seedFile = path.join(tmpDir, 'index.ts');
  fs.writeFileSync(seedFile, '');
  fs.writeFileSync(path.join(tmpDir, 'helper.ts'), '');
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  fs.writeFileSync(path.join(tmpDir, 'sub', 'index.ts'), '');

  test('resolves relative TS import', () => {
    const result = resolveImport('./helper', seedFile, 'typescript');
    assert.equal(result, path.join(tmpDir, 'helper.ts'));
  });

  test('resolves directory import to index.ts', () => {
    const result = resolveImport('./sub', seedFile, 'typescript');
    assert.equal(result, path.join(tmpDir, 'sub', 'index.ts'));
  });

  test('returns null for package imports', () => {
    const result = resolveImport('lodash', seedFile, 'typescript');
    assert.equal(result, null);
  });

  test('returns null for non-existent relative import', () => {
    const result = resolveImport('./nonexistent', seedFile, 'typescript');
    assert.equal(result, null);
  });
});

describe('buildDependencyChain', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-chain-'));

  const aFile = path.join(tmpDir, 'a.ts');
  const bFile = path.join(tmpDir, 'b.ts');
  const cFile = path.join(tmpDir, 'c.ts');

  fs.writeFileSync(aFile, "import { B } from './b';\nexport class A {}");
  fs.writeFileSync(bFile, "import { C } from './c';\nexport class B {}");
  fs.writeFileSync(cFile, "export class C {}");

  test('follows imports BFS up to maxDepth', () => {
    const chain = buildDependencyChain(aFile, 'typescript', 2);
    assert.ok(chain.length >= 2);
    assert.equal(chain[0], path.resolve(aFile));
    assert.ok(chain.includes(path.resolve(bFile)));
  });

  test('respects maxDepth=1', () => {
    const chain = buildDependencyChain(aFile, 'typescript', 1);
    assert.ok(chain.includes(path.resolve(aFile)));
    assert.ok(chain.includes(path.resolve(bFile)));
    assert.ok(!chain.includes(path.resolve(cFile)));
  });

  test('handles circular imports', () => {
    const xFile = path.join(tmpDir, 'x.ts');
    const yFile = path.join(tmpDir, 'y.ts');
    fs.writeFileSync(xFile, "import { Y } from './y';");
    fs.writeFileSync(yFile, "import { X } from './x';");
    const chain = buildDependencyChain(xFile, 'typescript', 5);
    assert.equal(chain.length, 2);
  });
});

// ============================================================================
// structuralPatch tests
// ============================================================================
const {
  tagAllNodes,
  decodeNodeId,
  applyPatches,
} = require('../out/utils/structuralPatch.js');

describe('tagAllNodes', () => {
  test('tags function signatures with NODE markers', () => {
    const skeleton = 'function hello() { /* ... */ }';
    const original = 'function hello() {\n  console.log("hi");\n}';
    const result = tagAllNodes(skeleton, '/test/file.ts', original);
    assert.ok(result.includes('/* NODE:'));
  });

  test('tags import statements', () => {
    const skeleton = "import { Foo } from './foo';";
    const original = "import { Foo } from './foo';";
    const result = tagAllNodes(skeleton, '/test/file.ts', original);
    assert.ok(result.includes('/* NODE:'));
  });

  test('preserves existing EXPAND markers', () => {
    const skeleton = '  /* EXPAND:abc123 */';
    const original = 'function x() { console.log(1); }';
    const result = tagAllNodes(skeleton, '/test/file.ts', original);
    assert.ok(result.includes('/* EXPAND:abc123 */'));
  });

  test('preserves blank lines and non-code comments', () => {
    const skeleton = '\n// a comment\n';
    const original = '\n// a comment\n';
    const result = tagAllNodes(skeleton, '/test/file.ts', original);
    assert.ok(!result.includes('/* NODE:'));
  });
});

describe('decodeNodeId', () => {
  test('roundtrips a valid node ID', () => {
    const nodeId = Buffer.from('/test/file.ts:10:20:sig').toString('base64url');
    const decoded = decodeNodeId(nodeId);
    assert.ok(decoded);
    assert.equal(decoded.filePath, '/test/file.ts');
    assert.equal(decoded.startLine, 10);
    assert.equal(decoded.endLine, 20);
    assert.equal(decoded.kind, 'sig');
  });

  test('returns null for invalid base64', () => {
    assert.equal(decodeNodeId('!!!invalid!!!'), null);
  });

  test('handles file paths with colons (Windows)', () => {
    const nodeId = Buffer.from('C:\\Users\\test\\file.ts:5:15:decl').toString('base64url');
    const decoded = decodeNodeId(nodeId);
    assert.ok(decoded);
    assert.equal(decoded.startLine, 5);
    assert.equal(decoded.endLine, 15);
    assert.equal(decoded.kind, 'decl');
  });
});

describe('applyPatches', () => {
  test('replaces a node in dry-run mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-patch-'));
    const file = path.join(tmpDir, 'target.ts');
    fs.writeFileSync(file, 'line1\nline2\nline3\nline4\nline5\n');

    const nodeId = Buffer.from(`${file}:2:3:body`).toString('base64url');
    const results = applyPatches([
      { nodeId, action: 'replace', content: 'REPLACED' },
    ], true);

    assert.equal(results.length, 1);
    assert.ok(results[0].diff.length > 0);
    const originalOnDisk = fs.readFileSync(file, 'utf-8');
    assert.ok(originalOnDisk.includes('line2'), 'dry-run should not modify the file');
  });

  test('applies a delete in non-dry-run mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-patch2-'));
    const file = path.join(tmpDir, 'target.ts');
    fs.writeFileSync(file, 'line1\nline2\nline3\nline4\n');

    const nodeId = Buffer.from(`${file}:2:3:body`).toString('base64url');
    const results = applyPatches([
      { nodeId, action: 'delete' },
    ], false);

    assert.equal(results.length, 1);
    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(!content.includes('line2'));
    assert.ok(!content.includes('line3'));
    assert.ok(content.includes('line1'));
    assert.ok(content.includes('line4'));
  });

  test('insert_after adds content after a node', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-patch3-'));
    const file = path.join(tmpDir, 'target.ts');
    fs.writeFileSync(file, 'line1\nline2\nline3\n');

    const nodeId = Buffer.from(`${file}:1:2:body`).toString('base64url');
    const results = applyPatches([
      { nodeId, action: 'insert_after', content: 'INSERTED' },
    ], false);

    assert.equal(results.length, 1);
    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(content.includes('INSERTED'));
    const lines = content.split('\n');
    const insertIdx = lines.indexOf('INSERTED');
    assert.ok(insertIdx > 0);
  });

  test('returns empty for invalid nodeIds', () => {
    const results = applyPatches([
      { nodeId: 'totally-invalid', action: 'delete' },
    ], true);
    assert.equal(results.length, 0);
  });
});
