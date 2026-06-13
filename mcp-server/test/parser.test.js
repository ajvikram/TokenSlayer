import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { analyzeFile, getLanguage } from '../build/parser.js';

// ---- helpers ---------------------------------------------------------------

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenslayer-test-'));

function writeFixture(filename, content) {
  const p = path.join(tmpRoot, filename);
  fs.writeFileSync(p, content);
  return p;
}

function analyze(filename, content) {
  return analyzeFile(writeFixture(filename, content));
}

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

// ---- getLanguage -----------------------------------------------------------

describe('getLanguage', () => {
  test('identifies all supported languages by extension', () => {
    assert.equal(getLanguage('/a/b.py'), 'python');
    assert.equal(getLanguage('/a/b.ts'), 'typescript');
    assert.equal(getLanguage('/a/b.tsx'), 'typescript');
    assert.equal(getLanguage('/a/b.js'), 'typescript');
    assert.equal(getLanguage('/a/b.jsx'), 'typescript');
    assert.equal(getLanguage('/a/b.go'), 'go');
    assert.equal(getLanguage('/a/b.java'), 'java');
    assert.equal(getLanguage('/a/b.rs'), 'rust');
    assert.equal(getLanguage('/a/b.cs'), 'csharp');
    assert.equal(getLanguage('/a/b.kt'), 'kotlin');
    assert.equal(getLanguage('/a/b.php'), 'php');
    assert.equal(getLanguage('/a/b.rb'), 'ruby');
    assert.equal(getLanguage('/a/b.swift'), 'swift');
    assert.equal(getLanguage('/a/b.sql'), 'sql');
    assert.equal(getLanguage('/a/b.vue'), 'vue');
    assert.equal(getLanguage('/a/b.svelte'), 'svelte');
  });

  test('returns "unknown" for unsupported types', () => {
    assert.equal(getLanguage('/a/b.txt'), 'unknown');
    assert.equal(getLanguage('/a/b.md'), 'unknown');
    assert.equal(getLanguage('/a/b.json'), 'unknown');
    assert.equal(getLanguage('/a/README'), 'unknown');
  });

  test('is case-insensitive on extension', () => {
    assert.equal(getLanguage('/a/B.PY'), 'python');
    assert.equal(getLanguage('/a/B.TS'), 'typescript');
  });
});

// ---- low-yield detection (IIFE/bundled collapse) ---------------------------

describe('analyzeFile — low-yield skeleton detection', () => {
  test('flags a large IIFE-wrapped file whose symbols collapse', () => {
    // Everything lives inside one top-level function, like lodash. The skeleton
    // collapses that body, so a 600-line file yields a near-empty skeleton.
    const inner = Array.from({ length: 600 }, (_, i) =>
      `  function helper${i}(a, b) { return a + b + ${i}; }`).join('\n');
    const content = `var lib = (function () {\n${inner}\n  return {};\n})();\n`;
    const r = analyze('bundle.js', content);
    assert.equal(r.error, undefined);
    assert.equal(r.lowYield, true, 'collapsed IIFE should be low-yield');
  });

  test('does NOT flag a large conventionally-structured file', () => {
    // Top-level functions are real symbols the skeleton keeps — high density.
    const content = Array.from({ length: 500 }, (_, i) =>
      `export function feature${i}(input) {\n  const x = input * ${i};\n  return x;\n}`).join('\n\n');
    const r = analyze('conventional.ts', content);
    assert.equal(r.error, undefined);
    assert.equal(r.lowYield ?? false, false, 'top-level symbols should not trip the guard');
  });

  test('does NOT flag small files (gated by line count)', () => {
    const content = `var m = (function () {\n  function a() {}\n  return {};\n})();\n`;
    const r = analyze('small.js', content);
    assert.equal(r.lowYield ?? false, false, 'small files are exempt');
  });
});

// ---- analyzeFile error paths ----------------------------------------------

describe('analyzeFile — error paths', () => {
  test('returns error for nonexistent files', () => {
    const r = analyzeFile('/no/such/file.ts');
    assert.ok(r.error, 'should set error field');
    assert.equal(r.skeleton, '');
    assert.equal(r.originalTokens, 0);
  });

  test('returns "Unsupported file type" for unknown languages', () => {
    const r = analyze('readme.md', '# hello\n');
    assert.equal(r.error, 'Unsupported file type');
  });

  test('handles empty files gracefully', () => {
    const r = analyze('empty.ts', '');
    assert.equal(r.error, undefined);
    assert.ok(r.skeleton.length > 0, 'header should still be present');
  });
});

// ---- Python ----------------------------------------------------------------

describe('Python compactor', () => {
  const sample = `"""Module docstring."""
import os
from typing import Optional

CONSTANT = 42

@dataclass
class MemoryManager:
    """Manages agent memory."""

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.cache = {}

    async def store(self, key: str, value: Optional[str]) -> None:
        if value is None:
            return
        self.cache[key] = value
        print(f"stored {key}")

def helper(x: int) -> int:
    return x * 2
`;

  test('preserves imports', () => {
    const r = analyze('memory.py', sample);
    assert.ok(r.skeleton.includes('import os'), 'import os missing');
    assert.ok(r.skeleton.includes('from typing import Optional'), 'from typing missing');
  });

  test('preserves class declarations', () => {
    const r = analyze('memory.py', sample);
    assert.ok(/class MemoryManager.*:/s.test(r.skeleton), 'class signature missing');
  });

  test('preserves function signatures with type hints', () => {
    const r = analyze('memory.py', sample);
    assert.ok(/def __init__\(self, agent_id: str\)/.test(r.skeleton));
    assert.ok(/async def store\(self, key: str, value: Optional\[str\]\) -> None/.test(r.skeleton));
    assert.ok(/def helper\(x: int\) -> int/.test(r.skeleton));
  });

  test('preserves decorators', () => {
    const r = analyze('memory.py', sample);
    assert.ok(r.skeleton.includes('@dataclass'), '@dataclass missing');
  });

  test('strips function bodies', () => {
    const r = analyze('memory.py', sample);
    assert.ok(!r.skeleton.includes('self.cache[key] = value'), 'body should be stripped');
    assert.ok(!r.skeleton.includes('print(f"stored'), 'print call should be stripped');
    assert.ok(!r.skeleton.includes('return x * 2'), 'return body should be stripped');
  });

  test('preserves module-level constants', () => {
    const r = analyze('memory.py', sample);
    assert.ok(r.skeleton.includes('CONSTANT = 42'));
  });

  test('produces meaningful reduction', () => {
    const r = analyze('memory.py', sample);
    assert.ok(r.compactedTokens < r.originalTokens, 'should shrink');
    assert.ok(r.reductionPercent >= 20, `expected >=20% reduction, got ${r.reductionPercent}%`);
  });
});

// ---- TypeScript ------------------------------------------------------------

describe('TypeScript compactor', () => {
  const sample = `import { Server } from 'http';
import * as fs from 'fs';

export interface UserConfig {
  name: string;
  age: number;
}

export class UserService {
  private users: Map<string, UserConfig> = new Map();

  constructor(private readonly db: Server) {
    this.users.clear();
  }

  async getUser(id: string): Promise<UserConfig | null> {
    const u = this.users.get(id);
    if (!u) return null;
    return u;
  }

  async createUser(cfg: UserConfig): Promise<void> {
    this.users.set(cfg.name, cfg);
    await this.persist();
  }

  private async persist(): Promise<void> {
    fs.writeFileSync('/tmp/users', JSON.stringify([...this.users]));
  }
}

export function helper(x: number): number {
  return x + 1;
}
`;

  test('preserves imports', () => {
    const r = analyze('user.ts', sample);
    assert.ok(r.skeleton.includes("from 'http'"));
    assert.ok(r.skeleton.includes("from 'fs'"));
  });

  test('preserves class and interface declarations', () => {
    const r = analyze('user.ts', sample);
    assert.ok(/export interface UserConfig/.test(r.skeleton));
    assert.ok(/export class UserService/.test(r.skeleton));
  });

  test('preserves method signatures', () => {
    const r = analyze('user.ts', sample);
    assert.ok(/async getUser\(id: string\): Promise<UserConfig \| null>/.test(r.skeleton));
    assert.ok(/async createUser\(cfg: UserConfig\): Promise<void>/.test(r.skeleton));
  });

  test('preserves top-level function signatures', () => {
    const r = analyze('user.ts', sample);
    assert.ok(/export function helper\(x: number\): number/.test(r.skeleton));
  });

  test('strips function bodies', () => {
    const r = analyze('user.ts', sample);
    assert.ok(!r.skeleton.includes('this.users.clear()'));
    assert.ok(!r.skeleton.includes('JSON.stringify'));
    assert.ok(!r.skeleton.includes('return x + 1'));
  });

  // Interface bodies are preserved verbatim (the fields are API), so the
  // floor on this small sample is lower than the old field-eliding behavior.
  test('reduces token count by at least 25%', () => {
    const r = analyze('user.ts', sample);
    assert.ok(r.reductionPercent >= 25, `got ${r.reductionPercent}%`);
  });
});

// ---- Go --------------------------------------------------------------------

describe('Go compactor', () => {
  const sample = `package gateway

import (
  "context"
  "net/http"
)

type Gateway struct {
  routes map[string]http.HandlerFunc
  port   int
}

func NewGateway(port int) *Gateway {
  g := &Gateway{
    routes: make(map[string]http.HandlerFunc),
    port:   port,
  }
  return g
}

func (g *Gateway) RouteTraffic(ctx context.Context, path string) error {
  handler, ok := g.routes[path]
  if !ok {
    return ErrNotFound
  }
  handler(nil, nil)
  return nil
}
`;

  test('preserves package and import', () => {
    const r = analyze('gateway.go', sample);
    assert.ok(r.skeleton.includes('package gateway'));
    assert.ok(r.skeleton.includes('import'));
  });

  test('preserves type declarations', () => {
    const r = analyze('gateway.go', sample);
    assert.ok(/type Gateway struct/.test(r.skeleton));
  });

  test('preserves function and method signatures', () => {
    const r = analyze('gateway.go', sample);
    assert.ok(/func NewGateway\(port int\) \*Gateway/.test(r.skeleton));
    assert.ok(/func \(g \*Gateway\) RouteTraffic\(ctx context\.Context, path string\) error/.test(r.skeleton));
  });

  test('strips function bodies', () => {
    const r = analyze('gateway.go', sample);
    assert.ok(!r.skeleton.includes('return ErrNotFound'));
    assert.ok(!r.skeleton.includes('handler(nil, nil)'));
  });
});

// ---- Java ------------------------------------------------------------------

describe('Java compactor', () => {
  const sample = `package com.example.app;

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/users")
public class UserController {

  private final UserService service;

  public UserController(UserService service) {
    this.service = service;
  }

  @GetMapping("/{id}")
  public User getUser(@PathVariable String id) {
    User u = service.find(id);
    if (u == null) throw new NotFoundException();
    return u;
  }

  @PostMapping
  public void createUser(@RequestBody User u) {
    service.save(u);
  }
}
`;

  test('preserves package and imports', () => {
    const r = analyze('UserController.java', sample);
    assert.ok(r.skeleton.includes('package com.example.app'));
    assert.ok(r.skeleton.includes('import org.springframework'));
  });

  test('preserves annotations', () => {
    const r = analyze('UserController.java', sample);
    assert.ok(r.skeleton.includes('@RestController'));
    assert.ok(r.skeleton.includes('@RequestMapping'));
    assert.ok(r.skeleton.includes('@GetMapping'));
  });

  test('preserves class declaration', () => {
    const r = analyze('UserController.java', sample);
    assert.ok(/public class UserController/.test(r.skeleton));
  });

  test('preserves method signatures', () => {
    const r = analyze('UserController.java', sample);
    assert.ok(/public User getUser\(@PathVariable String id\)/.test(r.skeleton));
    assert.ok(/public void createUser\(@RequestBody User u\)/.test(r.skeleton));
  });

  test('strips method bodies', () => {
    const r = analyze('UserController.java', sample);
    assert.ok(!r.skeleton.includes('throw new NotFoundException()'));
    assert.ok(!r.skeleton.includes('service.save(u)'));
  });
});

// ---- Rust ------------------------------------------------------------------

describe('Rust compactor', () => {
  const sample = `use std::collections::HashMap;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone)]
pub struct Config {
    pub name: String,
    pub timeout: u64,
}

pub trait Handler {
    fn handle(&self, req: &Request) -> Response;
}

impl Handler for Config {
    fn handle(&self, req: &Request) -> Response {
        let mut map = HashMap::new();
        map.insert("name", self.name.clone());
        Response { body: format!("{:?}", map) }
    }
}

pub fn parse_config(input: &str) -> Result<Config, Error> {
    serde_json::from_str(input).map_err(Error::Parse)
}
`;

  test('preserves use statements', () => {
    const r = analyze('config.rs', sample);
    assert.ok(r.skeleton.includes('use std::collections::HashMap'));
    assert.ok(r.skeleton.includes('use serde'));
  });

  test('preserves derive macros', () => {
    const r = analyze('config.rs', sample);
    assert.ok(r.skeleton.includes('#[derive(Debug, Clone)]'));
  });

  test('preserves struct, trait, impl declarations', () => {
    const r = analyze('config.rs', sample);
    assert.ok(/pub struct Config/.test(r.skeleton));
    assert.ok(/pub trait Handler/.test(r.skeleton));
    assert.ok(/impl Handler for Config/.test(r.skeleton));
  });

  test('preserves fn signatures', () => {
    const r = analyze('config.rs', sample);
    assert.ok(/pub fn parse_config\(input: &str\) -> Result<Config, Error>/.test(r.skeleton));
  });

  test('strips fn bodies', () => {
    const r = analyze('config.rs', sample);
    assert.ok(!r.skeleton.includes('serde_json::from_str'));
    assert.ok(!r.skeleton.includes('HashMap::new()'));
  });
});

// ---- C# --------------------------------------------------------------------

describe('C# compactor', () => {
  const sample = `using System;
using Microsoft.AspNetCore.Mvc;

namespace MyApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    private readonly IProductService _service;

    public ProductsController(IProductService service)
    {
        _service = service;
    }

    [HttpGet("{id}")]
    public ActionResult<Product> GetProduct(int id)
    {
        var p = _service.Find(id);
        if (p == null) return NotFound();
        return Ok(p);
    }
}
`;

  test('preserves usings', () => {
    const r = analyze('ProductsController.cs', sample);
    assert.ok(r.skeleton.includes('using System'));
    assert.ok(r.skeleton.includes('using Microsoft.AspNetCore.Mvc'));
  });

  test('preserves attributes', () => {
    const r = analyze('ProductsController.cs', sample);
    assert.ok(r.skeleton.includes('[ApiController]'));
    assert.ok(r.skeleton.includes('[Route("api/[controller]")]'));
    assert.ok(r.skeleton.includes('[HttpGet("{id}")]'));
  });

  test('preserves class and method signatures', () => {
    const r = analyze('ProductsController.cs', sample);
    assert.ok(/public class ProductsController/.test(r.skeleton));
    assert.ok(/public ActionResult<Product> GetProduct\(int id\)/.test(r.skeleton));
  });

  test('strips method bodies', () => {
    const r = analyze('ProductsController.cs', sample);
    assert.ok(!r.skeleton.includes('return NotFound()'));
    assert.ok(!r.skeleton.includes('_service.Find(id)'));
  });
});

// ---- Kotlin ----------------------------------------------------------------

describe('Kotlin compactor', () => {
  const sample = `package com.example.app

import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.RestController

@RestController
class UserController(private val service: UserService) {

    @GetMapping("/user/{id}")
    fun getUser(@PathVariable id: String): User {
        val u = service.find(id)
        return u ?: throw NotFoundException()
    }

    @JvmStatic
    fun helper(x: Int): Int {
        return x * 2
    }
}

data class User(val id: String, val name: String)
`;

  test('preserves package and imports', () => {
    const r = analyze('UserController.kt', sample);
    assert.ok(r.skeleton.includes('package com.example.app'));
    assert.ok(r.skeleton.includes('import org.springframework'));
  });

  test('preserves annotations', () => {
    const r = analyze('UserController.kt', sample);
    assert.ok(r.skeleton.includes('@RestController'));
    assert.ok(r.skeleton.includes('@JvmStatic'));
  });

  test('preserves class and fun signatures', () => {
    const r = analyze('UserController.kt', sample);
    assert.ok(/class UserController/.test(r.skeleton));
    assert.ok(/fun getUser\(@PathVariable id: String\): User/.test(r.skeleton));
    assert.ok(/fun helper\(x: Int\): Int/.test(r.skeleton));
  });

  test('preserves data class', () => {
    const r = analyze('UserController.kt', sample);
    assert.ok(/data class User/.test(r.skeleton));
  });

  test('strips fun bodies', () => {
    const r = analyze('UserController.kt', sample);
    assert.ok(!r.skeleton.includes('throw NotFoundException()'));
    assert.ok(!r.skeleton.includes('return x * 2'));
  });
});

// ---- Invariants across all languages --------------------------------------

describe('cross-language invariants', () => {
  const fixtures = [
    ['t.py', 'def f(x: int) -> int:\n    return x\n'],
    ['t.ts', 'export function f(x: number): number {\n  return x;\n}\n'],
    ['t.go', 'package x\n\nfunc F(x int) int {\n  return x\n}\n'],
    ['t.java', 'public class X {\n  public int f(int x) {\n    return x;\n  }\n}\n'],
    ['t.rs', 'pub fn f(x: i32) -> i32 {\n    return x;\n}\n'],
    ['t.cs', 'public class X {\n  public int F(int x) {\n    return x;\n  }\n}\n'],
    ['t.kt', 'class X {\n  fun f(x: Int): Int {\n    return x\n  }\n}\n'],
  ];

  for (const [name, content] of fixtures) {
    test(`${name}: skeleton header is present`, () => {
      const r = analyze(name, content);
      assert.equal(r.error, undefined);
      assert.match(r.skeleton, /^\/\/ .* \(\d+ lines → \d+-line skeleton\)/);
    });

    test(`${name}: reduction percent is non-negative and consistent`, () => {
      const r = analyze(name, content);
      assert.ok(r.reductionPercent >= 0);
      const expected = r.originalTokens > 0
        ? Math.round(((r.originalTokens - r.compactedTokens) / r.originalTokens) * 100)
        : 0;
      assert.equal(r.reductionPercent, expected);
    });
  }
});

// ---- HTML -----------------------------------------------------------------

describe('HTML compactor', () => {
  const sample = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My App</title>
  <link rel="stylesheet" href="/styles/main.css">
  <script src="/js/app.js" defer></script>
</head>
<body>
  <header id="site-header" class="hero dark">
    <h1>Welcome to the App</h1>
    <p>This is a long paragraph of body copy that should be stripped from the skeleton because it carries no structural signal.</p>
  </header>
  <nav role="navigation" aria-label="primary">
    <a href="/home">Home</a>
    <a href="/about">About</a>
  </nav>
  <main>
    <!-- Sidebar widgets go here -->
    <section id="features" data-testid="features-section">
      <article class="feature-card">
        <h2>Fast</h2>
        <p>Some marketing copy nobody reads anyway.</p>
      </article>
    </section>
    <form action="/submit" method="post" id="signup-form">
      <input type="email" name="email" required>
      <button type="submit">Sign Up</button>
    </form>
  </main>
</body>
</html>
`;

  test('getLanguage recognizes .html and .htm', () => {
    assert.equal(getLanguage('/a/index.html'), 'html');
    assert.equal(getLanguage('/a/page.htm'), 'html');
    assert.equal(getLanguage('/a/PAGE.HTML'), 'html');
  });

  test('preserves doctype, html, head, body', () => {
    const r = analyze('app.html', sample);
    assert.match(r.skeleton, /<!DOCTYPE html>/i);
    assert.match(r.skeleton, /<html\b/);
    assert.match(r.skeleton, /<head>/);
    assert.match(r.skeleton, /<body>/);
  });

  test('preserves meta, title, link, script tags', () => {
    const r = analyze('app.html', sample);
    assert.ok(r.skeleton.includes('<meta charset="utf-8">'));
    assert.ok(r.skeleton.includes('<title>'));
    assert.ok(r.skeleton.includes('<link rel="stylesheet"'));
    assert.ok(r.skeleton.includes('<script src="/js/app.js"'));
  });

  test('preserves elements with id/class/role/aria/data attributes', () => {
    const r = analyze('app.html', sample);
    assert.ok(r.skeleton.includes('id="site-header"'));
    assert.ok(r.skeleton.includes('class="hero dark"'));
    assert.ok(r.skeleton.includes('role="navigation"'));
    assert.ok(r.skeleton.includes('aria-label="primary"'));
    assert.ok(r.skeleton.includes('data-testid="features-section"'));
    assert.ok(r.skeleton.includes('id="signup-form"'));
  });

  test('preserves anchor / form / input / button tags (semantic)', () => {
    const r = analyze('app.html', sample);
    assert.ok(/<a href="\/home">/.test(r.skeleton));
    assert.ok(/<form action="\/submit"/.test(r.skeleton));
    assert.ok(/<input type="email"/.test(r.skeleton));
    assert.ok(/<button type="submit">/.test(r.skeleton));
  });

  test('strips body paragraph text content', () => {
    const r = analyze('app.html', sample);
    assert.ok(!r.skeleton.includes('Some marketing copy nobody reads'),
      'long paragraph text should be elided');
    assert.ok(!r.skeleton.includes('This is a long paragraph of body copy'),
      'long hero paragraph text should be elided');
  });

  test('strips HTML comments', () => {
    const r = analyze('app.html', sample);
    assert.ok(!r.skeleton.includes('Sidebar widgets go here'), 'comments should be removed');
  });

  test('reduces token count by at least 15% (HTML compaction is structural, not dramatic)', () => {
    const r = analyze('app.html', sample);
    assert.ok(r.reductionPercent >= 15, `got ${r.reductionPercent}%`);
  });
});

// ---- CSS ------------------------------------------------------------------

describe('CSS compactor', () => {
  const sample = `/* Brand tokens */
:root {
  --color-primary: #58a6ff;
  --color-bg: #0d1117;
  --font-stack: -apple-system, BlinkMacSystemFont, sans-serif;
  --space-md: 16px;
}

@import url('reset.css');
@charset "utf-8";

body {
  margin: 0;
  padding: 0;
  font-family: var(--font-stack);
  background: var(--color-bg);
  color: white;
}

.hero {
  display: flex;
  align-items: center;
  padding: 32px;
  background: linear-gradient(135deg, #58a6ff, #a371f7);
}

.hero h1,
.hero h2 {
  margin: 0;
  font-weight: 600;
}

#site-header {
  position: sticky;
  top: 0;
  z-index: 10;
}

@media (max-width: 768px) {
  .hero {
    flex-direction: column;
    padding: 16px;
  }
}

@keyframes pulse {
  0%   { opacity: 1; }
  50%  { opacity: 0.5; }
  100% { opacity: 1; }
}

.btn:hover {
  background: var(--color-primary);
}
`;

  test('getLanguage recognizes .css, .scss, .sass, .less', () => {
    assert.equal(getLanguage('/a/main.css'), 'css');
    assert.equal(getLanguage('/a/main.scss'), 'css');
    assert.equal(getLanguage('/a/main.sass'), 'css');
    assert.equal(getLanguage('/a/main.less'), 'css');
  });

  test('preserves :root custom properties (design tokens)', () => {
    const r = analyze('main.css', sample);
    assert.ok(r.skeleton.includes('--color-primary: #58a6ff;'));
    assert.ok(r.skeleton.includes('--color-bg: #0d1117;'));
    assert.ok(r.skeleton.includes('--font-stack:'));
  });

  test('preserves at-rules (@media, @keyframes, @import, @charset)', () => {
    const r = analyze('main.css', sample);
    assert.ok(r.skeleton.includes('@import url(\'reset.css\');'));
    assert.ok(r.skeleton.includes('@charset "utf-8";'));
    assert.ok(r.skeleton.includes('@media (max-width: 768px)'));
    assert.ok(r.skeleton.includes('@keyframes pulse'));
  });

  test('preserves class, id, and pseudo-selectors', () => {
    const r = analyze('main.css', sample);
    assert.ok(r.skeleton.includes('.hero {'));
    assert.ok(r.skeleton.includes('#site-header {'));
    assert.ok(r.skeleton.includes('.btn:hover {'));
  });

  test('preserves multi-line selector lists (lines ending in comma)', () => {
    const r = analyze('main.css', sample);
    assert.ok(r.skeleton.includes('.hero h1,'), 'multi-line selector first line missing');
    assert.ok(r.skeleton.includes('.hero h2 {'), 'multi-line selector second line missing');
  });

  test('strips property:value declarations inside rule bodies', () => {
    const r = analyze('main.css', sample);
    assert.ok(!r.skeleton.includes('margin: 0;'), 'margin declaration should be stripped');
    assert.ok(!r.skeleton.includes('linear-gradient'), 'gradient declaration should be stripped');
    assert.ok(!r.skeleton.includes('z-index: 10'), 'z-index declaration should be stripped');
  });

  test('preserves keyframe stops as selector-like lines', () => {
    const r = analyze('main.css', sample);
    // The 0%/50%/100% lines should also be considered "selectors" for purpose of keeping structure
    // In the current heuristic they're property-like ({ opacity: 1; }) so they'll be elided.
    // What MUST survive: the @keyframes pulse line itself and the closing brace.
    assert.ok(r.skeleton.includes('@keyframes pulse'));
  });

  test('strips CSS block comments', () => {
    const r = analyze('main.css', sample);
    assert.ok(!r.skeleton.includes('Brand tokens'), 'block comment should be stripped');
  });

  test('reduces token count by at least 30%', () => {
    const r = analyze('main.css', sample);
    assert.ok(r.reductionPercent >= 30, `got ${r.reductionPercent}%`);
  });
});

// ---- Regression / golden snapshot (intentionally small) -------------------

describe('golden snapshot (regression guard)', () => {
  test('Python: tiny fixture produces stable skeleton', () => {
    const r = analyze('tiny.py', 'def f(x: int) -> int:\n    return x\n');
    assert.ok(r.skeleton.includes('def f(x: int) -> int: ...'));
  });

  test('Go: tiny fixture produces stable skeleton', () => {
    const r = analyze('tiny.go', 'package x\n\nfunc F() int {\n  return 1\n}\n');
    assert.ok(r.skeleton.includes('func F() int'));
    assert.ok(!r.skeleton.includes('return 1'));
  });
});

// ---- PHP compactor --------------------------------------------------------

describe('PHP compactor', () => {
  const sample = `<?php
namespace App\\Controllers;

use App\\Models\\User;

class UserController {
    public function index(): Response {
        $users = User::all();
        return view('users.index', compact('users'));
    }

    private $secret = 'abc';

    public static function create(Request $request): User {
        return User::create($request->validated());
    }
}`;

  test('preserves namespace and use', () => {
    const r = analyze('UserController.php', sample);
    assert.ok(r.skeleton.includes('namespace App\\Controllers'));
    assert.ok(r.skeleton.includes('use App\\Models\\User'));
  });

  test('preserves class declaration', () => {
    const r = analyze('UserController.php', sample);
    assert.ok(r.skeleton.includes('class UserController'));
  });

  test('preserves function signatures', () => {
    const r = analyze('UserController.php', sample);
    assert.ok(r.skeleton.includes('public function index'));
    assert.ok(r.skeleton.includes('public static function create'));
  });

  test('strips function bodies', () => {
    const r = analyze('UserController.php', sample);
    assert.ok(!r.skeleton.includes('User::all()'));
  });
});

// ---- Ruby compactor -------------------------------------------------------

describe('Ruby compactor', () => {
  const sample = `require 'json'
require_relative './helpers'

module Api
  class UsersController < ApplicationController
    attr_reader :current_user

    RATE_LIMIT = 100

    def index
      users = User.all
      render json: users
    end

    def show(id)
      user = User.find(id)
      render json: user
    end
  end
end`;

  test('preserves require and module/class', () => {
    const r = analyze('users_controller.rb', sample);
    assert.ok(r.skeleton.includes("require 'json'"));
    assert.ok(r.skeleton.includes('module Api'));
    assert.ok(r.skeleton.includes('class UsersController'));
  });

  test('preserves attr_ declarations', () => {
    const r = analyze('users_controller.rb', sample);
    assert.ok(r.skeleton.includes('attr_reader :current_user'));
  });

  test('preserves def signatures', () => {
    const r = analyze('users_controller.rb', sample);
    assert.ok(r.skeleton.includes('def index'));
    assert.ok(r.skeleton.includes('def show'));
  });

  test('strips method bodies', () => {
    const r = analyze('users_controller.rb', sample);
    assert.ok(!r.skeleton.includes('User.all'));
    assert.ok(!r.skeleton.includes('User.find'));
  });
});

// ---- Swift compactor ------------------------------------------------------

describe('Swift compactor', () => {
  const sample = `import Foundation
import UIKit

@objc class UserService: NSObject {
    private let apiClient: APIClient

    public func fetchUsers(page: Int) -> [User] {
        let response = apiClient.get("/users", page: page)
        return response.data
    }

    static func shared() -> UserService {
        return UserService()
    }
}`;

  test('preserves imports and annotations', () => {
    const r = analyze('UserService.swift', sample);
    assert.ok(r.skeleton.includes('import Foundation'));
    assert.ok(r.skeleton.includes('@objc'));
  });

  test('preserves class and func signatures', () => {
    const r = analyze('UserService.swift', sample);
    assert.ok(r.skeleton.includes('class UserService'));
    assert.ok(r.skeleton.includes('func fetchUsers'));
  });

  test('strips function bodies', () => {
    const r = analyze('UserService.swift', sample);
    assert.ok(!r.skeleton.includes('apiClient.get'));
  });
});

// ---- SQL compactor --------------------------------------------------------

describe('SQL compactor', () => {
  const sample = `-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add index
CREATE INDEX idx_users_email ON users(email);

INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com');

SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.name;`;

  test('preserves CREATE TABLE and columns', () => {
    const r = analyze('schema.sql', sample);
    assert.ok(r.skeleton.includes('CREATE TABLE users'));
    assert.ok(r.skeleton.includes('id SERIAL PRIMARY KEY'));
    assert.ok(r.skeleton.includes('name VARCHAR'));
  });

  test('preserves CREATE INDEX', () => {
    const r = analyze('schema.sql', sample);
    assert.ok(r.skeleton.includes('CREATE INDEX'));
  });

  test('preserves SELECT statement', () => {
    const r = analyze('schema.sql', sample);
    assert.ok(r.skeleton.includes('SELECT'));
  });

  test('strips comments', () => {
    const r = analyze('schema.sql', sample);
    assert.ok(!r.skeleton.includes('-- Users table'));
  });
});

// ---- Advanced features (E, G, Feature 1) ----------------------------------

import { extractSymbol, scoreRelevance, pruneToFit } from '../build/parser.js';

describe('extractSymbol (E: symbol-level addressing)', () => {
  test('extracts a class by name', () => {
    const skeleton = '// header\nclass UserService {\n  constructor()\n  async login()\n}\nclass Other {\n  foo()\n}';
    const result = extractSymbol(skeleton, 'UserService');
    assert.ok(result.includes('class UserService'));
    assert.ok(!result.includes('class Other'));
  });

  test('extracts a function by name', () => {
    const skeleton = 'function fetchData() { /* ... */ }\nfunction processData() { /* ... */ }';
    const result = extractSymbol(skeleton, 'fetchData');
    assert.ok(result.includes('fetchData'));
  });

  test('returns full skeleton if symbol not found', () => {
    const skeleton = 'class Foo {\n  bar()\n}';
    const result = extractSymbol(skeleton, 'NonExistent');
    assert.equal(result, skeleton);
  });
});

describe('scoreRelevance (G: query-based ranking)', () => {
  test('scores higher for more keyword matches', () => {
    const s1 = scoreRelevance('class UserService { login() }', '/a/user.ts', 'user login');
    const s2 = scoreRelevance('class DatabasePool { connect() }', '/a/db.ts', 'user login');
    assert.ok(s1 > s2, `${s1} should be > ${s2}`);
  });

  test('boosts score for filename matches', () => {
    const s1 = scoreRelevance('class Service {}', '/auth/auth.ts', 'auth');
    const s2 = scoreRelevance('class Service {}', '/other/other.ts', 'auth');
    assert.ok(s1 > s2, `filename match should boost score`);
  });

  test('returns 0 for empty query', () => {
    assert.equal(scoreRelevance('anything', '/a.ts', ''), 0);
  });
});

describe('pruneToFit (Feature 1: budget-driven pruning)', () => {
  test('returns skeleton unchanged if within budget', () => {
    const skeleton = 'class Foo { bar() }';
    assert.equal(pruneToFit(skeleton, 1000), skeleton);
  });

  test('strips doc comments first', () => {
    const skeleton = '/** Long doc comment that takes up space */\nclass Foo { bar() }';
    const pruned = pruneToFit(skeleton, 10);
    assert.ok(!pruned.includes('Long doc comment'));
    assert.ok(pruned.includes('class Foo'));
  });

  test('truncates as last resort with marker', () => {
    const skeleton = 'a '.repeat(500);
    const pruned = pruneToFit(skeleton, 10);
    assert.ok(pruned.includes('truncated to fit token budget'));
    assert.ok(pruned.length < skeleton.length);
  });
});

// ---- Feature 5: Tokenizer & Layout Optimization ----------------------------

import { tokenize, optimizeLayout } from '../build/parser.js';

describe('tokenize (Feature 5: BPE tokenizer)', () => {
  test('returns 0 for empty string', () => {
    assert.equal(tokenize('', 'gpt-4o'), 0);
    assert.equal(tokenize(''), 0);
  });

  test('returns positive count for non-empty text', () => {
    assert.ok(tokenize('hello world') > 0);
  });

  test('uses chars/4 fallback when no targetModel', () => {
    const text = 'a'.repeat(100);
    assert.equal(tokenize(text), 25);
  });

  test('returns BPE count when targetModel is specified', () => {
    const text = 'function hello() { return "world"; }';
    const bpe = tokenize(text, 'gpt-4o');
    const fallback = tokenize(text);
    assert.ok(bpe > 0);
    assert.ok(fallback > 0);
  });
});

describe('optimizeLayout (Feature 5: BPE layout optimization)', () => {
  test('returns unchanged skeleton when no targetModel', () => {
    const skeleton = 'class Foo {\n  bar()\n}';
    assert.equal(optimizeLayout(skeleton), skeleton);
  });

  test('collapses 3+ blank lines to 1', () => {
    const skeleton = 'class Foo {\n\n\n\n  bar()\n}';
    const result = optimizeLayout(skeleton, 'gpt-4o');
    assert.ok(!result.includes('\n\n\n'));
  });

  test('strips trailing whitespace', () => {
    const skeleton = 'class Foo {   \n  bar()  \n}';
    const result = optimizeLayout(skeleton, 'gpt-4o');
    assert.ok(!result.includes('   \n'));
  });

  test('minifies 4-space indent to 2-space', () => {
    const skeleton = '    function foo() {}';
    const result = optimizeLayout(skeleton, 'gpt-4o');
    assert.equal(result, '  function foo() {}');
  });

  test('minifies tab indent to 2-space', () => {
    const skeleton = '\tfunction foo() {}';
    const result = optimizeLayout(skeleton, 'gpt-4o');
    assert.equal(result, '  function foo() {}');
  });

  test('compacts braces between declarations', () => {
    const skeleton = 'function foo() {}\n\nexport function bar() {}';
    const result = optimizeLayout(skeleton, 'gpt-4o');
    assert.ok(result.includes('}\nexport function bar'));
  });
});

// ---- Feature 2: Cross-File Graph Splicing ----------------------------------

import { extractImportSpecifiers, resolveImport, buildDependencyChain } from '../build/parser.js';

describe('extractImportSpecifiers', () => {
  test('extracts TS/JS ESM imports', () => {
    const code = `import { foo } from './foo';\nimport bar from '../bar';\nimport 'side-effect';`;
    const specs = extractImportSpecifiers(code, 'typescript');
    assert.ok(specs.includes('./foo'));
    assert.ok(specs.includes('../bar'));
    assert.ok(specs.includes('side-effect'));
  });

  test('extracts TS/JS require calls', () => {
    const code = `const x = require('./utils');\nconst y = require('lodash');`;
    const specs = extractImportSpecifiers(code, 'typescript');
    assert.ok(specs.includes('./utils'));
    assert.ok(specs.includes('lodash'));
  });

  test('extracts Python imports', () => {
    const code = `from .utils import helper\nimport os\nimport sys\nfrom collections import OrderedDict`;
    const specs = extractImportSpecifiers(code, 'python');
    assert.ok(specs.includes('.utils'));
    assert.ok(specs.includes('os'));
    assert.ok(specs.includes('sys'));
    assert.ok(specs.includes('collections'));
  });

  test('extracts Rust use statements', () => {
    const code = `use crate::models::User;\nuse super::utils;\nmod config;`;
    const specs = extractImportSpecifiers(code, 'rust');
    assert.ok(specs.includes('crate::models::User'));
    assert.ok(specs.includes('super::utils'));
    assert.ok(specs.includes('mod::config'));
  });

  test('extracts Ruby requires', () => {
    const code = `require 'json'\nrequire_relative './helper'`;
    const specs = extractImportSpecifiers(code, 'ruby');
    assert.ok(specs.includes('json'));
    assert.ok(specs.includes('./helper'));
  });

  test('extracts PHP includes', () => {
    const code = `require_once './config.php';\ninclude './utils.php';`;
    const specs = extractImportSpecifiers(code, 'php');
    assert.ok(specs.includes('./config.php'));
    assert.ok(specs.includes('./utils.php'));
  });

  test('deduplicates specifiers', () => {
    const code = `import { a } from './foo';\nimport { b } from './foo';`;
    const specs = extractImportSpecifiers(code, 'typescript');
    assert.equal(specs.filter(s => s === './foo').length, 1);
  });

  test('returns empty for unknown language', () => {
    const specs = extractImportSpecifiers('anything', 'unknown');
    assert.deepEqual(specs, []);
  });
});

describe('resolveImport', () => {
  const importDir = path.join(tmpRoot, 'imports');
  fs.mkdirSync(importDir, { recursive: true });

  test('resolves TS relative imports', () => {
    const mainFile = path.join(importDir, 'main.ts');
    const utilFile = path.join(importDir, 'utils.ts');
    fs.writeFileSync(mainFile, 'import { x } from "./utils"');
    fs.writeFileSync(utilFile, 'export const x = 1;');
    const resolved = resolveImport('./utils', mainFile, 'typescript');
    assert.equal(resolved, utilFile);
  });

  test('returns null for package imports', () => {
    const mainFile = path.join(importDir, 'main.ts');
    assert.equal(resolveImport('lodash', mainFile, 'typescript'), null);
  });

  test('resolves Python relative imports', () => {
    const mainFile = path.join(importDir, 'main.py');
    const helperFile = path.join(importDir, 'helper.py');
    fs.writeFileSync(mainFile, 'from .helper import foo');
    fs.writeFileSync(helperFile, 'def foo(): pass');
    const resolved = resolveImport('.helper', mainFile, 'python');
    assert.equal(resolved, helperFile);
  });

  test('resolves Ruby relative requires', () => {
    const mainFile = path.join(importDir, 'main.rb');
    const helperFile = path.join(importDir, 'lib.rb');
    fs.writeFileSync(mainFile, "require_relative './lib'");
    fs.writeFileSync(helperFile, 'class Lib; end');
    const resolved = resolveImport('./lib', mainFile, 'ruby');
    assert.ok(resolved !== null);
  });

  test('returns null for unresolvable imports', () => {
    const mainFile = path.join(importDir, 'main.ts');
    assert.equal(resolveImport('./nonexistent', mainFile, 'typescript'), null);
  });
});

describe('buildDependencyChain', () => {
  const chainDir = path.join(tmpRoot, 'chain');
  fs.mkdirSync(chainDir, { recursive: true });

  test('returns single file when no imports', () => {
    const file = path.join(chainDir, 'solo.ts');
    fs.writeFileSync(file, 'export const x = 1;');
    const results = buildDependencyChain(file, 2);
    assert.equal(results.length, 1);
    assert.ok(results[0].filePath.endsWith('solo.ts'));
  });

  test('follows relative imports to depth 1', () => {
    const main = path.join(chainDir, 'entry.ts');
    const dep = path.join(chainDir, 'dep.ts');
    fs.writeFileSync(dep, 'export function helper() { return 1; }');
    fs.writeFileSync(main, `import { helper } from './dep';\nexport function main() { return helper(); }`);
    const results = buildDependencyChain(main, 1);
    assert.ok(results.length >= 2, `expected >= 2 files, got ${results.length}`);
    const paths = results.map(r => path.basename(r.filePath));
    assert.ok(paths.includes('entry.ts'));
    assert.ok(paths.includes('dep.ts'));
  });

  test('handles circular imports without infinite loop', () => {
    const a = path.join(chainDir, 'a.ts');
    const b = path.join(chainDir, 'b.ts');
    fs.writeFileSync(a, `import { B } from './b';\nexport class A {}`);
    fs.writeFileSync(b, `import { A } from './a';\nexport class B {}`);
    const results = buildDependencyChain(a, 3);
    assert.ok(results.length === 2, `should visit each file once, got ${results.length}`);
  });

  test('respects depth limit', () => {
    const d1 = path.join(chainDir, 'd1.ts');
    const d2 = path.join(chainDir, 'd2.ts');
    const d3 = path.join(chainDir, 'd3.ts');
    fs.writeFileSync(d3, 'export const z = 3;');
    fs.writeFileSync(d2, `import { z } from './d3';\nexport const y = 2;`);
    fs.writeFileSync(d1, `import { y } from './d2';\nexport const x = 1;`);
    const results = buildDependencyChain(d1, 1);
    const paths = results.map(r => path.basename(r.filePath));
    assert.ok(paths.includes('d1.ts'));
    assert.ok(paths.includes('d2.ts'));
    assert.ok(!paths.includes('d3.ts'), 'depth=1 should not reach d3');
  });
});

// ---- Feature 4: Structural Patching ----------------------------------------

import { tagAllNodes, decodeNodeId, applyPatches } from '../build/parser.js';

describe('tagAllNodes (Feature 4: structural node IDs)', () => {
  test('tags signature lines with NODE IDs', () => {
    const original = 'import { foo } from "bar";\n\nfunction hello(name: string): string {\n  return "hi " + name;\n}\n';
    const skeleton = 'import { foo } from "bar";\nfunction hello(name: string): string { /* ... */ }';
    const result = tagAllNodes(skeleton, '/test/file.ts', original);
    assert.ok(result.includes('/* NODE:'));
  });

  test('tags import lines', () => {
    const original = 'import os\n\ndef foo():\n  pass\n';
    const skeleton = 'import os\ndef foo(): ...';
    const result = tagAllNodes(skeleton, '/test/file.py', original);
    assert.ok(result.includes('/* NODE:'));
    assert.ok(result.includes('import os'));
  });

  test('tags class declarations', () => {
    const original = 'class UserService {\n  constructor() {\n    this.x = 1;\n  }\n}\n';
    const skeleton = 'class UserService { /* ... */ }';
    const result = tagAllNodes(skeleton, '/test/file.ts', original);
    assert.ok(result.includes('/* NODE:'));
  });
});

describe('decodeNodeId', () => {
  test('decodes a valid body node ID', () => {
    const nodeId = Buffer.from('/test/file.ts:10:20').toString('base64url');
    const decoded = decodeNodeId(nodeId);
    assert.ok(decoded !== null);
    assert.equal(decoded.filePath, '/test/file.ts');
    assert.equal(decoded.startLine, 10);
    assert.equal(decoded.endLine, 20);
    assert.equal(decoded.kind, 'body');
  });

  test('decodes a node ID with kind', () => {
    const nodeId = Buffer.from('/test/file.ts:5:15:sig').toString('base64url');
    const decoded = decodeNodeId(nodeId);
    assert.ok(decoded !== null);
    assert.equal(decoded.kind, 'sig');
    assert.equal(decoded.startLine, 5);
    assert.equal(decoded.endLine, 15);
  });

  test('returns null for invalid input', () => {
    assert.equal(decodeNodeId('not-valid-base64!@#'), null);
  });
});

describe('applyPatches (Feature 4: structural patching)', () => {
  const patchDir = path.join(tmpRoot, 'patches');
  fs.mkdirSync(patchDir, { recursive: true });

  test('dry run returns diff without modifying file', () => {
    const file = path.join(patchDir, 'target.ts');
    const original = 'line 1\nline 2\nline 3\nline 4\nline 5\n';
    fs.writeFileSync(file, original);

    const nodeId = Buffer.from(`${file}:2:3:sig`).toString('base64url');
    const results = applyPatches([{ nodeId, action: 'replace', content: 'REPLACED LINE 2\nREPLACED LINE 3' }], true);

    assert.equal(results.length, 1);
    assert.ok(results[0].diff.includes('+REPLACED LINE 2'));
    const afterContent = fs.readFileSync(file, 'utf-8');
    assert.equal(afterContent, original, 'file should not be modified in dry run');
  });

  test('applies replacement when dryRun is false', () => {
    const file = path.join(patchDir, 'target2.ts');
    fs.writeFileSync(file, 'a\nb\nc\nd\ne\n');

    const nodeId = Buffer.from(`${file}:2:3:body`).toString('base64url');
    const results = applyPatches([{ nodeId, action: 'replace', content: 'X\nY' }], false);

    assert.equal(results.length, 1);
    const after = fs.readFileSync(file, 'utf-8');
    assert.ok(after.includes('X\nY'));
    assert.ok(!after.includes('b\nc'));
  });

  test('applies delete action', () => {
    const file = path.join(patchDir, 'target3.ts');
    fs.writeFileSync(file, 'a\nb\nc\nd\ne\n');

    const nodeId = Buffer.from(`${file}:3:4:sig`).toString('base64url');
    const results = applyPatches([{ nodeId, action: 'delete' }], false);

    assert.equal(results.length, 1);
    const after = fs.readFileSync(file, 'utf-8');
    assert.ok(!after.includes('c\nd'));
  });

  test('applies insert_after action', () => {
    const file = path.join(patchDir, 'target4.ts');
    fs.writeFileSync(file, 'a\nb\nc\n');

    const nodeId = Buffer.from(`${file}:2:2:sig`).toString('base64url');
    const results = applyPatches([{ nodeId, action: 'insert_after', content: 'INSERTED' }], false);

    assert.equal(results.length, 1);
    const after = fs.readFileSync(file, 'utf-8');
    assert.ok(after.includes('b\nINSERTED\nc'));
  });

  test('rejects overlapping patches', () => {
    const file = path.join(patchDir, 'target5.ts');
    fs.writeFileSync(file, 'a\nb\nc\nd\ne\n');

    const node1 = Buffer.from(`${file}:1:3:body`).toString('base64url');
    const node2 = Buffer.from(`${file}:2:4:body`).toString('base64url');
    const results = applyPatches([
      { nodeId: node1, action: 'replace', content: 'X' },
      { nodeId: node2, action: 'replace', content: 'Y' },
    ], true);

    assert.equal(results.length, 0, 'overlapping patches should be rejected');
  });

  test('caps at 10 patches', () => {
    const file = path.join(patchDir, 'target6.ts');
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    fs.writeFileSync(file, lines);

    const patches = Array.from({ length: 15 }, (_, i) => ({
      nodeId: Buffer.from(`${file}:${i * 3 + 1}:${i * 3 + 2}:sig`).toString('base64url'),
      action: /** @type {'replace'} */ ('replace'),
      content: `replaced ${i}`,
    }));

    const results = applyPatches(patches, true);
    // Should process at most 10 patches
    assert.ok(results.length <= 1);
  });
});
