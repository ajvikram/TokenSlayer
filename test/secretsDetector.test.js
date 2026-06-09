'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { SecretsDetector } = require('../out/utils/secretsDetector.js');

const scan = (filePath, content) => SecretsDetector.scan(filePath, content);

// ---- Filename-based detection --------------------------------------------

describe('SecretsDetector — sensitive filenames', () => {
  const cases = [
    ['/proj/.env',                   '.env file'],
    ['/proj/.env.local',             '.env.local file'],
    ['/proj/.env.production',        '.env.production file'],
    ['/proj/.env.development',       '.env variant file'],
    ['/proj/server.pem',             'PEM certificate/key file'],
    ['/proj/private.key',            'Key file'],
    ['/proj/cert.p12',               'PKCS12 certificate'],
    ['/proj/store.jks',              'Java keystore'],
    ['/proj/id_rsa',                 'SSH private key'],
    ['/proj/id_ed25519',             'SSH private key'],
    ['/proj/credentials.json',       'Credentials file'],
    ['/proj/secrets.json',           'Secrets file'],
    ['/proj/secrets.yaml',           'Secrets file'],
    ['/proj/.htpasswd',              'htpasswd file'],
    ['/proj/service-account.json',   'Service account key'],
  ];
  for (const [filePath, label] of cases) {
    test(`flags ${filePath} (${label})`, () => {
      const r = scan(filePath, '');
      assert.equal(r.hasSecrets, true);
      assert.equal(r.severity, 'high');
      assert.ok(r.reasons.some(x => x.includes(label)), `expected reason mentioning "${label}", got: ${r.reasons.join('; ')}`);
    });
  }
});

// ---- Content-based detection: provider tokens ----------------------------

describe('SecretsDetector — provider tokens (content)', () => {
  const cases = [
    ['AWS access key',          'const KEY = "AKIAIOSFODNN7EXAMPLE";'],
    ['AWS secret',              'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"'],
    ['GitHub PAT',              'token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"'],
    ['GitLab PAT',              'gitlab_token = "glpat-abcdefghijklmnop1234"'],
    ['Stripe live secret',      'STRIPE_KEY = "sk_live_abcdefghij1234567890XYZ"'],
    ['Stripe restricted key',   'k = "rk_live_abcdefghij1234567890XYZ"'],
    ['Slack token',             'slack = "xoxb-1234567890-abcdefghijklm"'],
    ['Google API key',          'GOOGLE_KEY = "AIzaSyA-bC1234567890ABCDEFGHIJKLMNOPQRS"'],
    ['Bearer token in header',  'headers["Authorization"] = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";'],
    ['Generic api_key',         'api_key = "abcdefghijklmnop1234"'],
    ['Generic secret_key',      'secret_key = "abcdefghijklmnop1234"'],
    ['Generic access_token',    'access_token = "abcdefghijklmnop1234"'],
    ['Generic auth_token',      'auth_token = "abcdefghijklmnop1234"'],
  ];
  for (const [label, content] of cases) {
    test(`flags ${label}`, () => {
      const r = scan('/proj/config.ts', content);
      assert.equal(r.hasSecrets, true, `expected to flag ${label}; reasons: ${r.reasons.join('; ')}`);
      assert.equal(r.severity, 'high');
    });
  }
});

// ---- Content-based detection: keys, db strings, passwords --------------

describe('SecretsDetector — keys, DB strings, passwords', () => {
  test('flags RSA private key', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBA...\n-----END RSA PRIVATE KEY-----\n';
    const r = scan('/proj/key.ts', pem);
    assert.equal(r.hasSecrets, true);
    assert.equal(r.severity, 'high');
  });

  test('flags generic PRIVATE KEY block (non-RSA)', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIBOgIBAA...\n-----END PRIVATE KEY-----\n';
    const r = scan('/proj/x.ts', pem);
    assert.equal(r.hasSecrets, true);
  });

  test('flags PGP private key block', () => {
    const r = scan('/proj/x.ts', '-----BEGIN PGP PRIVATE KEY BLOCK-----\n');
    assert.equal(r.hasSecrets, true);
  });

  test('flags certificate block as medium severity', () => {
    const r = scan('/proj/x.ts', '-----BEGIN CERTIFICATE-----\nMIIBOgIBA...\n-----END CERTIFICATE-----\n');
    assert.equal(r.hasSecrets, true);
    // medium severity unless also flagged by something else
    assert.ok(r.severity === 'medium' || r.severity === 'high');
  });

  test('flags MongoDB connection string', () => {
    const r = scan('/proj/db.ts', 'const url = "mongodb://user:pass@host:27017/mydb";');
    assert.equal(r.hasSecrets, true);
  });

  test('flags Postgres connection string', () => {
    const r = scan('/proj/db.ts', 'DATABASE_URL = "postgres://u:p@host:5432/db"');
    assert.equal(r.hasSecrets, true);
  });

  test('flags hardcoded password assignment', () => {
    const r = scan('/proj/cfg.ts', 'password = "supersecret123"');
    assert.equal(r.hasSecrets, true);
  });

  test('flags JWT secret env var', () => {
    const r = scan('/proj/cfg.ts', 'jwt_secret = "abcdef12345678"');
    assert.equal(r.hasSecrets, true);
  });
});

// ---- False-positive guards (must NOT flag) ------------------------------

describe('SecretsDetector — should NOT flag legitimate code', () => {
  test('clean source file', () => {
    const r = scan('/proj/util.ts', `
      export function add(a: number, b: number): number {
        return a + b;
      }
    `);
    assert.equal(r.hasSecrets, false);
    assert.equal(r.reasons.length, 0);
  });

  test('variable NAMED "password" with no value', () => {
    const r = scan('/proj/x.ts', `
      function login(username: string, password: string) {
        return authenticate(username, password);
      }
    `);
    assert.equal(r.hasSecrets, false);
  });

  test('interface field declaration with no value', () => {
    const r = scan('/proj/x.ts', `
      interface User {
        password: string;
        apiKey: string;
        token: string;
      }
    `);
    assert.equal(r.hasSecrets, false);
  });

  test('short-string assignment to "api_key" (< 16 chars) is below threshold', () => {
    const r = scan('/proj/x.ts', 'api_key = "abc"'); // only 3 chars
    assert.equal(r.hasSecrets, false);
  });

  test('filename that contains "key" but isn\'t a key file', () => {
    const r = scan('/proj/keyboard.ts', 'export function press(k: string) {}');
    assert.equal(r.hasSecrets, false);
  });

  test('readme-style mention of patterns without actual secrets', () => {
    const r = scan('/proj/README.md', '## Example\nSet AWS_SECRET_ACCESS_KEY in your env.\n');
    assert.equal(r.hasSecrets, false);
  });
});

// ---- Result shape -------------------------------------------------------

describe('SecretsDetector — result shape', () => {
  test('clean scan returns {hasSecrets:false, reasons:[], severity:"low"}', () => {
    const r = scan('/proj/x.ts', 'const x = 1;');
    assert.deepEqual(r, { hasSecrets: false, reasons: [], severity: 'low' });
  });

  test('multiple violations are all listed in reasons', () => {
    const content = `
      AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
      const url = "postgres://u:p@host:5432/db"
    `;
    const r = scan('/proj/x.ts', content);
    assert.equal(r.hasSecrets, true);
    assert.ok(r.reasons.length >= 2, `expected >=2 reasons, got ${r.reasons.length}: ${r.reasons.join('; ')}`);
  });

  test('only scans first 5000 chars (perf guarantee)', () => {
    // Put a secret AFTER 5000 chars of filler — should NOT be flagged.
    const filler = 'x'.repeat(5100);
    const r = scan('/proj/big.ts', filler + '\nAWS_KEY = "AKIAIOSFODNN7EXAMPLE"');
    assert.equal(r.hasSecrets, false, 'content past 5000 chars is intentionally not scanned');
  });

  test('severity escalates to "high" if any high-severity pattern hits, even alongside medium', () => {
    const r = scan('/proj/x.ts', 'aws_key = "AKIAIOSFODNN7EXAMPLE"\n-----BEGIN CERTIFICATE-----\n');
    assert.equal(r.severity, 'high');
  });
});
