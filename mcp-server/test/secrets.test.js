import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { analyzeFile } from '../build/parser.js';
import { scanForSecrets } from '../build/secretsDetector.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenslayer-secrets-'));

function analyze(filename, content) {
  const p = path.join(tmpRoot, filename);
  fs.writeFileSync(p, content);
  return analyzeFile(p);
}

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

describe('scanForSecrets', () => {
  test('flags hardcoded API keys as high severity', () => {
    const r = scanForSecrets('/app/config.ts', 'const apiKey = "sk1234567890abcdef0000";');
    assert.equal(r.hasSecrets, true);
    assert.equal(r.severity, 'high');
  });

  test('flags private key blocks', () => {
    const r = scanForSecrets('/app/x.ts', '-----BEGIN RSA PRIVATE KEY-----\nabc');
    assert.equal(r.hasSecrets, true);
  });

  test('flags sensitive filenames regardless of content', () => {
    const r = scanForSecrets('/app/.env', 'FOO=bar');
    assert.equal(r.hasSecrets, true);
    assert.equal(r.severity, 'high');
  });

  test('passes clean source files', () => {
    const r = scanForSecrets('/app/clean.ts', 'export function add(a, b) { return a + b; }');
    assert.equal(r.hasSecrets, false);
  });
});

describe('analyzeFile secrets exclusion', () => {
  test('refuses to skeleton a file containing credentials', () => {
    const r = analyze('config.ts', [
      "export const dbUrl = 'postgres://admin:hunter22@db.internal:5432/prod';",
      'export function connect(): void {',
      '  // ...',
      '}',
    ].join('\n'));
    assert.ok(r.error);
    assert.match(r.error, /secrets detected/i);
    assert.equal(r.skeleton, '');
  });

  test('still analyzes clean files', () => {
    const r = analyze('clean.ts', 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
    assert.equal(r.error, undefined);
    assert.ok(r.skeleton.includes('export function add'));
  });
});

describe('assigned-value stripping', () => {
  test('strips values from top-level const declarations', () => {
    const r = analyze('values.ts', [
      "export const serviceName: string = 'orders';",
      'export const retryLimit = 3;',
      'export function noop(): void {',
      '  return;',
      '}',
    ].join('\n'));
    assert.equal(r.error, undefined);
    assert.ok(r.skeleton.includes('export const serviceName: string;'));
    assert.ok(r.skeleton.includes('export const retryLimit;'));
    assert.ok(!r.skeleton.includes("'orders'"));
    assert.ok(!r.skeleton.includes('= 3'));
  });

  test('strips values from class field initializers', () => {
    const r = analyze('svc.ts', [
      'export class Service {',
      "  private endpoint = 'https://internal.example.com';",
      '  doWork(input: string): number {',
      '    return input.length;',
      '  }',
      '}',
    ].join('\n'));
    assert.equal(r.error, undefined);
    assert.ok(r.skeleton.includes('private endpoint;'));
    assert.ok(!r.skeleton.includes('internal.example.com'));
  });

  test('leaves type aliases and comparisons intact', () => {
    const r = analyze('types2.ts', [
      "export type Mode = 'fast' | 'slow';",
      'export const isReady = status >= 2;',
    ].join('\n'));
    assert.equal(r.error, undefined);
    assert.ok(r.skeleton.includes("export type Mode = 'fast' | 'slow';"));
    assert.ok(r.skeleton.includes('export const isReady;'));
  });
});
