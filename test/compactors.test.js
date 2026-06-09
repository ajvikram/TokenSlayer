'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const vscode = require('./_mocks/vscode.js');
const { CompactorFactory } = require('../out/compaction/compactor.js');
const { PythonCompactor } = require('../out/compaction/pythonCompactor.js');
const {
  extractBlockDocComment,
  extractLineDocComment,
} = require('../out/compaction/docCommentExtractor.js');

// ---- Helpers --------------------------------------------------------------

let nextLine = 0;
function sym(kind, signatureLine, opts = {}) {
  const startLine = opts.startLine ?? nextLine++;
  return {
    name: opts.name ?? signatureLine.split(/[\s(]/).find(Boolean) ?? 'sym',
    kind,
    kindLabel: opts.kindLabel ?? '',
    detail: opts.detail ?? '',
    range: { startLine, endLine: opts.endLine ?? startLine + 1 },
    signatureLine,
    children: opts.children ?? [],
  };
}

function compact(languageId, symbols, fileContent, filePath = `/proj/test.${languageId}`) {
  const c = CompactorFactory.getCompactor(languageId);
  assert.ok(c, `no compactor registered for ${languageId}`);
  return c.compact(symbols, fileContent, filePath);
}

// ---- CompactorFactory -----------------------------------------------------

describe('CompactorFactory', () => {
  test('registers a compactor for each supported language', () => {
    const langs = ['typescript', 'javascript', 'python', 'go', 'java', 'rust', 'csharp', 'kotlin'];
    for (const lang of langs) {
      assert.ok(CompactorFactory.hasCompactor(lang), `expected compactor for ${lang}`);
    }
  });

  test('returns undefined for unknown languages', () => {
    assert.equal(CompactorFactory.getCompactor('cobol'), undefined);
    assert.equal(CompactorFactory.hasCompactor('cobol'), false);
  });

  test('returns a result with the expected shape', () => {
    const result = CompactorFactory.compact(
      [sym(vscode.SymbolKind.Function, 'function helper(x)')],
      'function helper(x) { return x; }',
      '/proj/h.ts',
      'typescript'
    );
    assert.ok(result);
    assert.ok(typeof result.skeleton === 'string');
    assert.ok(typeof result.originalTokens === 'number');
    assert.ok(typeof result.compactedTokens === 'number');
    assert.ok(typeof result.reductionPercent === 'number');
    assert.equal(result.languageId, 'typescript');
    assert.ok(typeof result.symbolCount === 'number');
  });
});

// ---- TypeScript -----------------------------------------------------------

describe('TypeScriptCompactor', () => {
  test('preserves class declaration + method signatures', () => {
    const source = `
import { Server } from 'http';

export class UserService {
  constructor(private db: Server) {}
  async getUser(id: string): Promise<User | null> {
    return this.db.find(id);
  }
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'export class UserService', {
        name: 'UserService',
        children: [
          sym(vscode.SymbolKind.Constructor, 'constructor(private db: Server)'),
          sym(vscode.SymbolKind.Method, 'async getUser(id: string): Promise<User | null>'),
        ],
      }),
    ];
    const out = compact('typescript', symbols, source);
    assert.ok(out.includes('export class UserService'), 'class signature missing');
    assert.ok(out.includes('async getUser(id: string): Promise<User | null>'), 'method signature missing');
    assert.ok(!out.includes('return this.db.find'), 'method body should be stripped');
  });

  test('preserves imports compactly', () => {
    const source = `import { Server } from 'http';\nimport * as fs from 'fs';\n\nexport class X {}\n`;
    const out = compact('typescript', [sym(vscode.SymbolKind.Class, 'export class X', { name: 'X' })], source);
    assert.ok(out.includes("from 'http'") || out.includes('Imports'), 'imports should appear');
  });
});

// ---- Python ---------------------------------------------------------------

describe('PythonCompactor', () => {
  test('preserves class signature + method signatures + decorators', () => {
    const source = `import os
from typing import Optional

@dataclass
class MemoryManager:
    """Manages memory."""
    DEFAULT_TTL = 86400

    def __init__(self, agent_id: str):
        self.agent_id = agent_id

    @staticmethod
    def helper(x: int) -> int:
        return x * 2
`;
    // Decorator is at line 3 (0-indexed), class starts at line 4
    const symbols = [
      sym(vscode.SymbolKind.Class, 'class MemoryManager', {
        name: 'MemoryManager',
        startLine: 4,
        children: [
          sym(vscode.SymbolKind.Method, 'def __init__(self, agent_id: str)', { startLine: 8 }),
          sym(vscode.SymbolKind.Method, 'def helper(x: int) -> int', { startLine: 11 }),
        ],
      }),
    ];
    const out = compact('python', symbols, source, '/proj/mem.py');
    assert.ok(out.includes('class MemoryManager:'), 'class signature missing');
    assert.ok(out.includes('def __init__(self, agent_id: str):'), 'init signature missing');
    assert.ok(out.includes('def helper(x: int) -> int:'), 'helper signature missing');
    assert.ok(out.includes('...'), 'function body should be replaced with ellipsis');
    assert.ok(!out.includes('self.agent_id = agent_id'), 'body should be stripped');
  });

  test('preserves @dataclass decorator above a class', () => {
    const source = `@dataclass
class Foo:
    x: int
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'class Foo', { name: 'Foo', startLine: 1 }),
    ];
    const out = compact('python', symbols, source, '/proj/foo.py');
    assert.ok(out.includes('@dataclass'), 'decorator should be preserved');
  });

  test('preserves first-line docstring on functions', () => {
    const source = `def f(x: int) -> int:
    """Doubles the input."""
    return x * 2
`;
    const symbols = [sym(vscode.SymbolKind.Function, 'def f(x: int) -> int', { startLine: 0 })];
    const out = compact('python', symbols, source, '/proj/f.py');
    assert.ok(out.includes('Doubles the input'), 'docstring first line should be kept');
  });

  test('preserves imports', () => {
    const source = `import os\nfrom typing import Optional\n\ndef f(): pass\n`;
    const symbols = [sym(vscode.SymbolKind.Function, 'def f()', { startLine: 3 })];
    const out = compact('python', symbols, source, '/proj/f.py');
    assert.ok(out.includes('import os'));
    assert.ok(out.includes('from typing import Optional'));
  });
});

// ---- PythonCompactor.isSignificantDecorator (decorator allow-list) ------

describe('PythonCompactor.isSignificantDecorator', () => {
  const KEEP = [
    // stdlib classics
    '@dataclass', '@property', '@staticmethod', '@classmethod', '@abstractmethod',
    // functools
    '@cached_property', '@cache', '@lru_cache', '@wraps', '@total_ordering',
    '@singledispatch', '@singledispatchmethod',
    // typing PEPs
    '@overload', '@final', '@override', '@runtime_checkable',
    // contextlib
    '@contextmanager', '@asynccontextmanager',
    // enum
    '@unique',
    // Parameterized stdlib decorators
    '@dataclass(frozen=True)', '@lru_cache(maxsize=128)', '@cache_page(60 * 15)',
    // FastAPI routes (qualified)
    '@app.get("/users")', '@app.post("/items")', '@app.delete("/items/{id}")',
    '@router.get("/health")',
    // Flask
    '@app.route("/")', '@bp.route("/api/v1")', '@blueprint.before_request',
    // Django
    '@login_required', '@permission_required("polls.can_vote")',
    '@require_http_methods(["GET", "POST"])', '@csrf_exempt', '@cache_page(60)',
    '@method_decorator(login_required, name="dispatch")',
    // pytest
    '@pytest.fixture', '@pytest.mark.parametrize("x", [1, 2, 3])',
    '@pytest.mark.skipif(sys.version_info < (3, 10))',
    // celery
    '@task', '@shared_task', '@app.task',
    // click
    '@click.command()', '@click.option("--name")', '@click.argument("path")',
    // tenacity
    '@retry',
    // SQLAlchemy
    '@event.listens_for(User, "after_insert")',
    // generic qualified (catch-all)
    '@myframework.handler', '@some_lib.register_callback',
  ];

  const DROP = [
    // Private decorators
    '@_internal_helper',
    '@__dunder_decorator__',
    // Random unqualified short names not on the allow-list
    '@helper',
    '@my_decorator',
    '@some_random_thing',
  ];

  for (const d of KEEP) {
    test(`keeps ${d}`, () => {
      assert.equal(PythonCompactor.isSignificantDecorator(d), true,
        `expected to KEEP ${d}`);
    });
  }
  for (const d of DROP) {
    test(`drops ${d}`, () => {
      assert.equal(PythonCompactor.isSignificantDecorator(d), false,
        `expected to DROP ${d}`);
    });
  }
});

// ---- Python — end-to-end with realistic FastAPI route -----------------

describe('PythonCompactor — FastAPI route preservation (regression)', () => {
  test('keeps @app.get / @app.post decorators verbatim', () => {
    const source = `from fastapi import FastAPI

app = FastAPI()

@app.get("/users/{user_id}")
async def get_user(user_id: int) -> User:
    return await db.find(user_id)

@app.post("/users")
async def create_user(user: UserCreate) -> User:
    return await db.create(user)
`;
    // startLine = the def line; extractDecorators scans BACKWARDS from there.
    const symbols = [
      sym(vscode.SymbolKind.Function, 'async def get_user(user_id: int) -> User', { startLine: 5 }),
      sym(vscode.SymbolKind.Function, 'async def create_user(user: UserCreate) -> User', { startLine: 9 }),
    ];
    const out = compact('python', symbols, source, '/proj/api.py');
    assert.ok(out.includes('@app.get("/users/{user_id}")'), 'GET decorator dropped');
    assert.ok(out.includes('@app.post("/users")'), 'POST decorator dropped');
    assert.ok(out.includes('get_user'));
    assert.ok(out.includes('create_user'));
  });

  test('keeps @cached_property on a class method', () => {
    const source = `class Foo:
    @cached_property
    def total(self) -> int:
        return sum(self.values)
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'class Foo', {
        name: 'Foo',
        startLine: 0,
        children: [sym(vscode.SymbolKind.Method, 'def total(self) -> int', { startLine: 2 })],
      }),
    ];
    const out = compact('python', symbols, source, '/proj/foo.py');
    assert.ok(out.includes('@cached_property'), '@cached_property dropped (was missing from old allow-list)');
  });
});

// ---- Go -------------------------------------------------------------------

describe('GoCompactor', () => {
  test('preserves struct + function signatures', () => {
    const source = `package gateway

type Gateway struct {
  port int
}

func NewGateway(port int) *Gateway {
  return &Gateway{port: port}
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Struct, 'type Gateway struct', {
        name: 'Gateway',
        children: [sym(vscode.SymbolKind.Field, 'port int')],
      }),
      sym(vscode.SymbolKind.Function, 'func NewGateway(port int) *Gateway'),
    ];
    const out = compact('go', symbols, source, '/proj/g.go');
    assert.ok(out.includes('type Gateway struct') || out.includes('Gateway'), 'struct missing');
    assert.ok(out.includes('NewGateway'), 'function name missing');
    assert.ok(!out.includes('return &Gateway{port: port}'), 'function body should be stripped');
  });
});

// ---- Java -----------------------------------------------------------------

describe('JavaCompactor', () => {
  test('preserves class + method signatures + annotations', () => {
    const source = `package com.example;

@RestController
@RequestMapping("/users")
public class UserController {

  @GetMapping("/{id}")
  public User getUser(@PathVariable String id) {
    return service.find(id);
  }
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'public class UserController', {
        name: 'UserController',
        startLine: 4,
        children: [
          sym(vscode.SymbolKind.Method, 'public User getUser(@PathVariable String id)', { startLine: 7 }),
        ],
      }),
    ];
    const out = compact('java', symbols, source, '/proj/UC.java');
    assert.ok(out.includes('public class UserController'), 'class missing');
    assert.ok(out.includes('getUser'), 'method missing');
    assert.ok(!out.includes('return service.find(id);'), 'body should be stripped');
  });
});

// ---- Rust -----------------------------------------------------------------

describe('RustCompactor', () => {
  test('preserves use statements + struct + fn signatures', () => {
    const source = `use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Config {
    pub name: String,
}

pub fn parse(s: &str) -> Result<Config, Error> {
    serde_json::from_str(s)
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Struct, 'pub struct Config', {
        name: 'Config',
        startLine: 3,
        children: [sym(vscode.SymbolKind.Field, 'pub name: String')],
      }),
      sym(vscode.SymbolKind.Function, 'pub fn parse(s: &str) -> Result<Config, Error>', { startLine: 7 }),
    ];
    const out = compact('rust', symbols, source, '/proj/c.rs');
    assert.ok(out.includes('use std::collections::HashMap'), 'use statement missing');
    assert.ok(out.includes('#[derive(Debug, Clone)]'), 'derive macro missing');
    assert.ok(out.includes('pub struct Config'), 'struct missing');
    assert.ok(out.includes('pub fn parse'), 'fn missing');
    assert.ok(!out.includes('serde_json::from_str(s)'), 'fn body should be stripped');
  });
});

// ---- C# -------------------------------------------------------------------

describe('CSharpCompactor', () => {
  test('preserves class + method signatures + attributes', () => {
    const source = `using System;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet("{id}")]
    public ActionResult<Product> GetProduct(int id)
    {
        var p = _service.Find(id);
        return Ok(p);
    }
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'public class ProductsController : ControllerBase', {
        name: 'ProductsController',
        startLine: 4,
        children: [
          sym(vscode.SymbolKind.Method, 'public ActionResult<Product> GetProduct(int id)', { startLine: 7 }),
        ],
      }),
    ];
    const out = compact('csharp', symbols, source, '/proj/PC.cs');
    assert.ok(out.includes('public class ProductsController'), 'class missing');
    assert.ok(out.includes('GetProduct'), 'method missing');
    assert.ok(!out.includes('return Ok(p);'), 'body should be stripped');
  });
});

// ---- docCommentExtractor — pure helpers -----------------------------------

describe('extractBlockDocComment', () => {
  test('extracts single-line JSDoc /** Foo */ above a symbol', () => {
    const fileLines = ['/** Adds two numbers. */', 'function add(a, b) {'];
    assert.equal(extractBlockDocComment(fileLines, 1), 'Adds two numbers.');
  });

  test('extracts first non-empty line of a multi-line JSDoc block', () => {
    const fileLines = [
      '/**',
      ' * Computes the SHA-256 hash of the input string.',
      ' * @param input the raw string',
      ' * @returns hex-encoded hash',
      ' */',
      'function sha256(input) {',
    ];
    assert.equal(extractBlockDocComment(fileLines, 5), 'Computes the SHA-256 hash of the input string.');
  });

  test('skips intermediate blank lines and decorators between doc and symbol', () => {
    const fileLines = [
      '/** Wired controller. */',
      '',
      '@Component',
      'class Foo {',
    ];
    assert.equal(extractBlockDocComment(fileLines, 3), 'Wired controller.');
  });

  test('returns null when there is no preceding block comment', () => {
    const fileLines = ['', 'function plain() {'];
    assert.equal(extractBlockDocComment(fileLines, 1), null);
  });

  test('clamps long doc text to ~120 chars and adds ellipsis', () => {
    const long = 'x'.repeat(200);
    const fileLines = [`/** ${long} */`, 'function f() {'];
    const result = extractBlockDocComment(fileLines, 1);
    assert.ok(result.length <= 120, `expected <= 120, got ${result.length}`);
    assert.ok(result.endsWith('…'));
  });

  test('skips @tag-only first lines (no leaking @param into summary)', () => {
    const fileLines = [
      '/**',
      ' * @param x the input',
      ' */',
      'function f(x) {',
    ];
    // No actual summary line — returns null rather than the @tag line.
    assert.equal(extractBlockDocComment(fileLines, 3), null);
  });
});

describe('extractLineDocComment', () => {
  test('extracts a single /// Rust doc line', () => {
    const fileLines = ['/// Parses the input config file.', 'pub fn parse() {'];
    assert.equal(extractLineDocComment(fileLines, 1, '///'), 'Parses the input config file.');
  });

  test('extracts the first /// line from multiple', () => {
    const fileLines = [
      '/// Computes the SHA-256 hash.',
      '/// Returns hex-encoded.',
      'pub fn sha256() {',
    ];
    assert.equal(extractLineDocComment(fileLines, 2, '///'), 'Computes the SHA-256 hash.');
  });

  test('extracts <summary> contents from C# XML doc-comments', () => {
    const fileLines = [
      '/// <summary>',
      '/// Returns the order by its identifier.',
      '/// </summary>',
      'public Order GetOrder(int id) {',
    ];
    assert.equal(extractLineDocComment(fileLines, 3, '///'), 'Returns the order by its identifier.');
  });

  test('extracts Go-style // doc comment above a func', () => {
    const fileLines = [
      '// NewGateway creates a new HTTP gateway listening on the given port.',
      'func NewGateway(port int) *Gateway {',
    ];
    assert.equal(extractLineDocComment(fileLines, 1, '//'), 'NewGateway creates a new HTTP gateway listening on the given port.');
  });

  test('// marker does NOT match /// (Rust doc comments should not pollute Go scan)', () => {
    const fileLines = ['/// Rust doc comment', 'fn helper() {'];
    assert.equal(extractLineDocComment(fileLines, 1, '//'), null,
      '// marker must reject /// to avoid false positives');
  });

  test('skips Rust attributes (#[...]) between doc and symbol', () => {
    const fileLines = [
      '/// Tested function.',
      '#[test]',
      '#[cfg(unix)]',
      'fn helper() {',
    ];
    assert.equal(extractLineDocComment(fileLines, 3, '///'), 'Tested function.');
  });

  test('skips C# attributes ([...]) between doc and symbol', () => {
    const fileLines = [
      '/// <summary>Lists all orders.</summary>',
      '[HttpGet]',
      '[Authorize]',
      'public IActionResult List() {',
    ];
    assert.equal(extractLineDocComment(fileLines, 3, '///'), 'Lists all orders.');
  });

  test('returns null when there is no preceding doc comment', () => {
    const fileLines = ['', 'fn plain() {'];
    assert.equal(extractLineDocComment(fileLines, 1, '///'), null);
    assert.equal(extractLineDocComment(fileLines, 1, '//'), null);
  });
});

// ---- Per-language doc-comment preservation in end-to-end compact output --

describe('Doc-comment preservation end-to-end', () => {
  test('TypeScript: JSDoc on a class survives compaction', () => {
    const source = `/**
 * Manages persistent user sessions.
 */
export class SessionManager {
  /** Looks up a session by token. */
  find(token: string): Session | null {
    return this.store.get(token);
  }
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'export class SessionManager', {
        name: 'SessionManager',
        startLine: 3,
        children: [
          sym(vscode.SymbolKind.Method, 'find(token: string): Session | null', { startLine: 5 }),
        ],
      }),
    ];
    const out = compact('typescript', symbols, source, '/proj/sess.ts');
    assert.ok(out.includes('Manages persistent user sessions'), 'class JSDoc dropped');
    assert.ok(out.includes('Looks up a session by token'), 'method JSDoc dropped');
  });

  test('Java: Javadoc on a method survives compaction', () => {
    const source = `package com.example;

public class UserService {

  /**
   * Finds a user by their unique ID.
   * @param id the user identifier
   */
  public User findById(String id) {
    return repository.find(id);
  }
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'public class UserService', {
        name: 'UserService',
        startLine: 2,
        children: [
          sym(vscode.SymbolKind.Method, 'public User findById(String id)', { startLine: 8 }),
        ],
      }),
    ];
    const out = compact('java', symbols, source, '/proj/UserService.java');
    assert.ok(out.includes('Finds a user by their unique ID'), 'Javadoc dropped');
  });

  test('Kotlin: KDoc on a class survives compaction', () => {
    const source = `package com.example

/**
 * Handles payment authorization and capture.
 */
class PaymentService {
    fun authorize(amount: BigDecimal): String {
        return gateway.authorize(amount)
    }
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'class PaymentService', {
        name: 'PaymentService',
        startLine: 5,
        children: [
          sym(vscode.SymbolKind.Method, 'fun authorize(amount: BigDecimal): String', { startLine: 6 }),
        ],
      }),
    ];
    const out = compact('kotlin', symbols, source, '/proj/PaymentService.kt');
    assert.ok(out.includes('Handles payment authorization and capture'), 'KDoc dropped');
  });

  test('Rust: /// doc comment on a fn survives compaction', () => {
    const source = `use serde::Deserialize;

/// Parses the application config from JSON at the given path.
pub fn parse_config(path: &Path) -> Result<Config, Error> {
    serde_json::from_str(&fs::read_to_string(path)?).map_err(Error::Parse)
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Function, 'pub fn parse_config(path: &Path) -> Result<Config, Error>', { startLine: 3 }),
    ];
    const out = compact('rust', symbols, source, '/proj/config.rs');
    assert.ok(out.includes('Parses the application config from JSON'), 'Rustdoc dropped');
  });

  test('Rust: derive macros + /// doc-comment both preserved', () => {
    const source = `/// A user record loaded from the database.
#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: String,
    pub email: String,
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Struct, 'pub struct User', {
        name: 'User',
        startLine: 2,
        children: [
          sym(vscode.SymbolKind.Field, 'pub id: String'),
          sym(vscode.SymbolKind.Field, 'pub email: String'),
        ],
      }),
    ];
    const out = compact('rust', symbols, source, '/proj/user.rs');
    assert.ok(out.includes('A user record loaded from the database'), 'Rustdoc dropped');
    assert.ok(out.includes('#[derive(Debug, Clone, Serialize)]'), 'derive macro dropped');
  });

  test('C#: XML <summary> doc-comment survives compaction', () => {
    const source = `using System;

[ApiController]
public class OrdersController : ControllerBase
{
    /// <summary>
    /// Returns the order by its identifier.
    /// </summary>
    [HttpGet("{id}")]
    public ActionResult<Order> GetOrder(int id)
    {
        return Ok(_service.Find(id));
    }
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'public class OrdersController : ControllerBase', {
        name: 'OrdersController',
        startLine: 3,
        children: [
          sym(vscode.SymbolKind.Method, 'public ActionResult<Order> GetOrder(int id)', { startLine: 9 }),
        ],
      }),
    ];
    const out = compact('csharp', symbols, source, '/proj/OC.cs');
    assert.ok(out.includes('Returns the order by its identifier'), 'XML summary dropped');
  });

  test('Go: // doc comment above a func survives compaction', () => {
    const source = `package gateway

// RouteTraffic dispatches an incoming request to the registered handler.
func (g *Gateway) RouteTraffic(ctx context.Context, path string) error {
    return nil
}
`;
    const symbols = [
      sym(vscode.SymbolKind.Method, 'func (g *Gateway) RouteTraffic(ctx context.Context, path string) error', { startLine: 3 }),
    ];
    const out = compact('go', symbols, source, '/proj/gw.go');
    assert.ok(out.includes('RouteTraffic dispatches an incoming request'), 'Go doc comment dropped');
  });
});

// ---- HTML -----------------------------------------------------------------

describe('HtmlCompactor', () => {
  const sample = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My Page</title>
  <link rel="stylesheet" href="/app.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <header id="site-header" class="hero" role="banner">
    <h1>Welcome to the App</h1>
    <p>Some marketing copy that nobody reads but takes lots of tokens.</p>
  </header>
  <main id="main">
    <nav aria-label="primary">
      <a href="/home">Home</a>
    </nav>
    <!-- This is a comment that should be stripped -->
    <form action="/submit" method="post" id="signup">
      <input type="email" name="email" required>
      <button type="submit">Sign Up</button>
    </form>
  </main>
</body>
</html>
`;

  test('factory recognizes html language id', () => {
    assert.ok(CompactorFactory.hasCompactor('html'));
  });

  test('preserves doctype, html, head, body, meta, title', () => {
    const out = compact('html', [], sample, '/proj/index.html');
    assert.match(out, /<!DOCTYPE html>/i);
    assert.ok(out.includes('<html lang="en">'));
    assert.ok(out.includes('<title>My Page</title>'));
    assert.ok(out.includes('<meta charset="utf-8">'));
  });

  test('preserves elements with id/class/role/aria attributes', () => {
    const out = compact('html', [], sample, '/proj/index.html');
    assert.ok(out.includes('id="site-header"'));
    assert.ok(out.includes('class="hero"'));
    assert.ok(out.includes('role="banner"'));
    assert.ok(out.includes('aria-label="primary"'));
    assert.ok(out.includes('id="signup"'));
  });

  test('preserves heading and button text (structural label tags)', () => {
    const out = compact('html', [], sample, '/proj/index.html');
    assert.ok(out.includes('Welcome to the App'), 'h1 text should be preserved');
    assert.ok(out.includes('Sign Up'), 'button text should be preserved');
  });

  test('strips long text inside generic <p> containers', () => {
    const out = compact('html', [], sample, '/proj/index.html');
    assert.ok(!out.includes('Some marketing copy that nobody reads'), 'paragraph text should be elided');
  });

  test('strips HTML comments', () => {
    const out = compact('html', [], sample, '/proj/index.html');
    assert.ok(!out.includes('This is a comment'), 'comments should be stripped');
  });

  test('preserves form/input/button/anchor tags', () => {
    const out = compact('html', [], sample, '/proj/index.html');
    assert.ok(out.includes('action="/submit"'));
    assert.ok(out.includes('type="email"'));
    assert.ok(out.includes('<a href="/home">Home</a>'));
  });
});

// ---- CSS ------------------------------------------------------------------

describe('CssCompactor', () => {
  const sample = `/* Brand tokens */
:root {
  --color-primary: #58a6ff;
  --color-bg: #0d1117;
  --space-md: 16px;
}

@import url('reset.css');

body {
  margin: 0;
  padding: 0;
  font-family: var(--font-stack);
}

.hero,
.hero--gradient {
  display: flex;
  background: linear-gradient(135deg, #58a6ff, #a371f7);
}

#site-header {
  position: sticky;
  top: 0;
}

@media (max-width: 768px) {
  .hero {
    padding: 16px;
  }
}

@keyframes pulse {
  0%   { opacity: 1; }
  100% { opacity: 1; }
}
`;

  test('factory recognizes css, scss, sass, less', () => {
    assert.ok(CompactorFactory.hasCompactor('css'));
    assert.ok(CompactorFactory.hasCompactor('scss'));
    assert.ok(CompactorFactory.hasCompactor('sass'));
    assert.ok(CompactorFactory.hasCompactor('less'));
  });

  test('preserves :root design tokens', () => {
    const out = compact('css', [], sample, '/proj/main.css');
    assert.ok(out.includes('--color-primary: #58a6ff;'));
    assert.ok(out.includes('--color-bg: #0d1117;'));
    assert.ok(out.includes('--space-md: 16px;'));
  });

  test('preserves at-rules (@import, @media, @keyframes)', () => {
    const out = compact('css', [], sample, '/proj/main.css');
    assert.ok(out.includes('@import url(\'reset.css\');'));
    assert.ok(out.includes('@media (max-width: 768px)'));
    assert.ok(out.includes('@keyframes pulse'));
  });

  test('preserves class, id, and multi-line selector lists', () => {
    const out = compact('css', [], sample, '/proj/main.css');
    assert.ok(out.includes('.hero,'), 'multi-line selector first line');
    assert.ok(out.includes('.hero--gradient {'), 'multi-line selector second line');
    assert.ok(out.includes('#site-header {'));
  });

  test('strips property:value declarations', () => {
    const out = compact('css', [], sample, '/proj/main.css');
    assert.ok(!out.includes('margin: 0'), 'margin declaration should be stripped');
    assert.ok(!out.includes('linear-gradient'), 'gradient declaration should be stripped');
  });

  test('strips block comments', () => {
    const out = compact('css', [], sample, '/proj/main.css');
    assert.ok(!out.includes('Brand tokens'), 'comment should be stripped');
  });
});

// ---- Kotlin ---------------------------------------------------------------

describe('KotlinCompactor', () => {
  test('preserves class + fun signatures + annotations', () => {
    const source = `package com.example

@RestController
class UserController(private val service: UserService) {

    @GetMapping("/user/{id}")
    fun getUser(@PathVariable id: String): User {
        return service.find(id)
    }
}

data class User(val id: String, val name: String)
`;
    const symbols = [
      sym(vscode.SymbolKind.Class, 'class UserController(private val service: UserService)', {
        name: 'UserController',
        startLine: 3,
        children: [
          sym(vscode.SymbolKind.Method, 'fun getUser(@PathVariable id: String): User', { startLine: 6 }),
        ],
      }),
      sym(vscode.SymbolKind.Class, 'data class User(val id: String, val name: String)', { name: 'User', startLine: 11 }),
    ];
    const out = compact('kotlin', symbols, source, '/proj/UC.kt');
    assert.ok(out.includes('UserController'), 'class missing');
    assert.ok(out.includes('getUser'), 'method missing');
    assert.ok(out.includes('data class User'), 'data class missing');
    assert.ok(!out.includes('return service.find(id)'), 'body should be stripped');
  });
});
