# Changelog

All notable changes to TokenSlayer are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] — 2026-06-09

### Fixed

- **Go/Java/Kotlin no longer produce imports-only skeletons when the language
  server is missing or still indexing.** Three-part fix: symbol extraction now
  retries briefly during language-server warm-up; when no symbols arrive,
  symbol-driven languages (TS/JS, Python, Go, Java, Rust, C#, Kotlin) fall back
  to the line-based parser instead of emitting an empty skeleton; and
  symbol-less results are never cached, so a degraded analysis can no longer
  get pinned in the persisted cache. (Previously, analyzing a Go file before
  gopls was ready cached an imports-only skeleton by content hash — permanently,
  until the file changed or the cache was cleared. This is why the same
  extension version could work on one machine and not another.)

## [0.5.0] — 2026-06-09

### Added

- **Six new languages in the extension**: PHP, Ruby, Swift, SQL, Vue, and Svelte
  now have line-based compactors (ported from the MCP server), closing the
  language gap between the two surfaces. Auto-analyze, CodeLens, and
  directory/workspace scans all cover the new languages.
- **New `tokenslayer-expand-node` language model tool**. Skeletons tag every
  element with `NODE:<id>` markers; Copilot can now pass one of those ids to
  retrieve just that function or class body — no need to re-read the whole
  file. Brings the extension to parity with the MCP server's `expand_node`.
- **Real BPE token counting in the Tokenwise MCP sibling** (gpt-tokenizer with
  chars/4 fallback), so reported savings match actual tokenizer output.

- **LLM token usage in the dashboard**. New "🤖 LLM Tokens Used" section shows real
  token consumption for the current workspace, aggregated from Claude Code session
  transcripts (`~/.claude/projects/<workspace>/*.jsonl`): input, output, cache read,
  cache write, total, per-model breakdown, session count, and last activity.
  Transcripts are re-parsed only when they change, so the 5-second dashboard
  refresh stays cheap. (VS Code exposes no API for Copilot's internal usage, so
  Copilot requests are not included.)

### Security

- **MCP server now refuses to skeleton files containing secrets.** The extension's
  SecretsDetector has been ported to the standalone MCP server: files matching
  credential patterns (API keys, tokens, private keys, connection strings) or
  sensitive filenames (`.env`, `*.pem`, `credentials.json`, …) return an
  "Excluded: secrets detected" error instead of a skeleton.
- **Assigned values are stripped from variable declarations and class fields**
  in MCP skeletons (`const API_KEY = "sk-…"` → `const API_KEY;`), so hardcoded
  values can no longer leak into model context even in files that pass the scan.

### Fixed

- **MCP server parser no longer leaks function bodies into skeletons.** Collapsed
  functions are now skipped as whole blocks, so locals, object literals, and stray
  closing braces can no longer appear in the output. Class bodies are walked
  properly: fields kept, methods collapsed, closing brace emitted exactly once.
- **`type X = { ... }` object-type bodies are preserved verbatim**, matching the
  existing struct/interface/enum behavior.
- **Go receiver methods** (`func (g *Gateway) Handle(...)`) and **Rust
  `trait`/`impl` blocks** are now recognized as signatures; previously they only
  survived by accident of the old brace heuristic.

## [0.4.0] — 2026-06-08

### Added

- **HTML and CSS support** in both the VS Code extension and the standalone MCP server.
  Preserves DOCTYPE, structural tags, `id`/`class`/`role`/`aria-*`/`data-*` attributes,
  semantic forms, and text inside structural label tags (`<title>`, `<h1>`–`<h6>`,
  `<label>`, `<button>`, `<a>`). For CSS, keeps selectors, at-rules, `:root` design
  tokens, and brace structure while stripping property:value bodies. Activates on
  `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less`.
- **Significantly expanded Python decorator preservation**. Now keeps decorators from
  `functools` (`@cached_property`, `@cache`, `@lru_cache`, `@wraps`, `@singledispatch`,
  `@total_ordering`), `typing` PEPs (`@overload`, `@final`, `@override`,
  `@runtime_checkable`), `contextlib` (`@contextmanager`, `@asynccontextmanager`),
  `enum` (`@unique`), Django (`@login_required`, `@csrf_exempt`,
  `@require_http_methods`, `@cache_page`, `@method_decorator`, etc.), Celery
  (`@task`, `@shared_task`), and tenacity (`@retry`). Plus a qualified-decorator
  fallback (`@module.name`) that automatically catches FastAPI routes
  (`@app.get/post/put/delete`), Flask blueprints (`@bp.route`), click commands
  (`@click.command/option/argument`), pytest marks (`@pytest.mark.*`), SQLAlchemy
  events, and any future framework.
- **Standalone dashboard for the MCP server**:
  - `get_stats` MCP tool — ask Claude *"how much has TokenSlayer saved me?"*
  - `--stats` CLI flag — colored terminal dashboard on-demand
  - `--dashboard` CLI flag — live-refreshing HTML dashboard at `http://localhost:4734`
  - `clear_stats` MCP tool and `--clear-stats` CLI flag
  - Stats persisted as append-only JSONL at `~/.tokenslayer/stats.jsonl`
- **243 unit tests** across both the VS Code extension and the MCP server (was: zero).
  - VS Code: 155 tests covering `SecretsDetector` (46), `TokenEstimator` (15),
    `wireUpCopilot` file merger (12), and all 9 language compactors (82 incl. the
    Python decorator audit). Uses a minimal `vscode` API mock loaded via a
    `--require` hook; `workspace.fs` backed by a real temp directory so wireUp
    tests exercise actual file I/O.
  - MCP server: 88 tests covering every language compactor and the stats
    persistence layer (round-trip, append safety, aggregation, top-savers
    ordering, malformed-line resilience).
- **Eval harness** (`mcp-server/eval/`) — 29 hand-crafted dev questions across 9
  language fixtures with signal-preservation scoring. Latest run: **49% token
  reduction with 99% signal fidelity** (82/83 signals preserved). Supports
  `--json` for CI dashboards. Marks one finding as a known limitation
  (regex-based parser cannot detect TS methods without explicit return types).
- **Global instruction guidance for Claude Code** in the README — set
  `~/.claude/CLAUDE.md` once and Claude prefers TokenSlayer for every project.
- **6 new languages** in the standalone MCP server: PHP, Ruby, Swift, SQL,
  Vue (`.vue`), and Svelte (`.svelte`). Vue/Svelte SFC blocks are split and
  each section (template/script/style) is compacted with the appropriate
  language processor. Total supported: **15 languages**.
- **Symbol-level addressing** (`symbol` parameter on `analyze_files`) — extract
  only a specific class, function, or struct by name instead of the full skeleton.
- **JSON output mode** (`format: "json"`) — returns structured data with per-file
  metadata, token counts, and skeletons for programmatic consumption by agents.
- **Query-based ranking** (`query` parameter on `analyze_files` and
  `analyze_workspace`) — sorts results by keyword relevance so the most important
  files surface first. Boosts scores for filename matches.
- **Budget-driven adaptive pruning** (`maxTokens` parameter) — progressively
  strips doc comments, body hints, blank lines, then hard-truncates to fit within
  a strict token budget. Agents can request exactly the context they can afford.
- **De-skeletonization / lazy node expansion** (`expandable: true` + new
  `expand_node` MCP tool) — pruned function bodies are tagged with unique node
  IDs (`/* EXPAND:nodeId */`). The agent can later call `expand_node(nodeId)` to
  retrieve just that function's full source without re-reading the entire file.
- **Enhanced dashboards** on both VS Code and MCP server:
  - Total Tokens Processed card
  - Estimated Cost Saved (GPT-4o at $2.50/M, Claude Sonnet at $3.00/M)
  - Avg Saved per File metric
  - Savings-over-time sparkline chart (MCP dashboard)
  - JSON export endpoint (`/api/export`) on the MCP dashboard
  - Language icons for C#, Kotlin, HTML, CSS in VS Code dashboard
- **Wire Up AI Tool command** (`tokenslayer.wireUpTool`) — QuickPick menu to
  generate MCP configuration for Cursor, Cline, Continue, Windsurf, and Claude Code
  in addition to the existing Copilot wire-up.
- **Cross-file graph splicing** — new `analyze_dependency_chain` MCP tool.
  Follows local (relative) imports via BFS traversal up to a configurable depth,
  producing a merged skeleton of the entire dependency chain from a seed file.
  Supports TS/JS, Python, Rust, PHP, Ruby, and Swift import resolution.
- **AST-driven structural patching** — new `apply_patch` MCP tool.
  `tagAllNodes()` assigns node IDs to all skeleton elements (signatures,
  declarations, imports, pruned bodies). The model can then return AST diffs
  (`replace`, `insert_after`, `delete`) referencing node IDs, and `apply_patch`
  applies them bottom-up with a unified diff preview. Default is `dryRun: true`.
- **Tokenizer-aware BPE layout optimization** — `gpt-tokenizer` added to MCP
  server. New `targetModel` parameter (`gpt-4o`, `gpt-4`, `claude`) on all
  analysis tools enables real BPE token counting instead of `chars/4`, plus
  `optimizeLayout()` which collapses whitespace, minifies indentation, compacts
  braces, and collapses single-line-able multi-line signatures to reduce token count.
- **Extension feature parity** — all three architectural features (BPE layout
  optimization, dependency chain analysis, structural patching) now work in the
  VS Code extension, matching the MCP server capabilities:
  - **BPE layout optimization** — new `tokenslayer.targetModel` setting
    (`gpt-4o`, `gpt-4`, `claude`, `auto`). When set, `optimizeLayout()` runs in
    the compactor pipeline and LM Tool, collapsing whitespace and minifying
    indentation to reduce BPE token count.
  - **Dependency chain analysis** — new `tokenslayer.analyzeDependencyChain`
    command and `scope: "dependency-chain"` on the `tokenslayer-structural-summary`
    LM Tool. Follows local imports via BFS (configurable depth via
    `tokenslayer.dependencyChainDepth` setting, default 2) and analyzes the full
    chain with LSP-powered compaction.
  - **Structural patching** — new `tokenslayer-apply-patch` LM Tool registered
    in Copilot. All skeleton output now includes `/* NODE:id */` markers via
    `tagAllNodes()`. Copilot can send `replace`/`insert_after`/`delete` patches
    referencing node IDs. Also available as a manual `tokenslayer.applyPatch`
    command that reads JSON from the clipboard and shows a diff preview.
  - New files: `src/utils/layoutOptimizer.ts`, `src/utils/importResolver.ts`,
    `src/utils/structuralPatch.ts`, `src/tools/patchTool.ts`.
- **363 unit tests** (was 333). 30 new tests for the extension feature parity
  covering layout optimization (7), import resolution (12), dependency chain
  traversal (3), node tagging (4), and structural patching (4).

### Changed

- **Extension version bumped to 0.4.0** — full feature parity with MCP server v3.0.
  2 LM Tools, 10 commands, 6 settings, 363 tests.
- MCP server version bumped to **3.0.0** — new tools (`analyze_dependency_chain`,
  `apply_patch`), new `targetModel` parameter on all analysis tools, `tagAllNodes`
  replacing `tagPrunedNodes` when `expandable: true`, and real BPE token counting.
- `analyze_workspace` now accepts `maxFiles` (default 100) and `query` parameters.
- Workspace file-finder now excludes additional directories: `build`, `.venv`,
  `vendor`, `target`, `coverage`, `.next`, `.nuxt`.

### Changed

- `npm test` (root) now runs the 155-test unit suite. The legacy
  `@vscode/test-electron` runner is preserved as `npm run test:e2e`.

### Fixed

- **Rust `use` statements and `#[derive(...)]` macros** were silently dropped from
  the standalone parser's skeletons. Now preserved.
- **Tiny files** (≤ 5 lines) could produce skeletons larger than the source.
  The standalone parser now falls back to the original content when compaction
  would inflate.
- **Python class-level constants** (`DEFAULT_TTL = 86400` inside a class body)
  were stripped from the standalone parser's skeletons. Now matched by a
  `SCREAMING_SNAKE_CASE = ...` pattern.
- **Go struct fields and TypeScript interface members** were collapsed with
  `{ /* ... */ }`, losing the field names that are the whole API surface. The
  standalone parser now preserves the body verbatim for `struct`, `interface`,
  and `enum` blocks.
- **HTML `<title>` text and other structural label tags** were elided by an
  over-aggressive text-stripping pass. Text inside `<title>`, `<h1>`–`<h6>`,
  `<label>`, `<button>`, `<a>`, `<li>`, `<option>` is now preserved; only text
  in generic containers (`<p>`, `<div>`, `<span>`) is elided.
- **`analyzeWorkspace` command** glob pattern now includes `.cs`, `.kt`, `.html`,
  `.htm`, `.css`, `.scss`, `.sass`, `.less` — was missing supported languages.
- **MCP dashboard** now binds to `127.0.0.1` instead of all interfaces
  (addresses the low-severity security gap documented in SECURITY.md).

### Roadmap (not yet implemented)

- **Unify the two parsers** — merge the VS Code LSP-based and MCP heuristic
  parsers into a shared package so both sides produce identical skeletons.
- **Secrets detection in MCP server** — port the VS Code extension's
  `SecretsDetector` to the standalone parser.

## [0.3.1] and earlier

See [git history](https://github.com/ajvikram/TokenSlayer/commits/main) for
changes prior to the introduction of this changelog.

[0.4.0]: https://github.com/ajvikram/TokenSlayer/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/ajvikram/TokenSlayer/releases/tag/v0.3.1
