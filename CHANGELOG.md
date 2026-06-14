# Changelog

All notable changes to TokenSlayer are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] — 2026-06-13

### Context Rot Score — now a real "getting dumber over time" meter

- **Trajectory view.** The Health tab now shows the rot score *as of each turn*
  as an inline sparkline, with the turn where it first crossed into amber
  marked. The trajectory is reconstructed deterministically from the transcript
  (replaying the signals on growing turn-prefixes) — no cross-poll state. A
  trend indicator (▲ rising / ◆ stable / ▼ improving) appears on the score and
  in the status bar.
- **Scoring reworked so length ≠ rot.** Turn depth was the dominant signal (30%)
  but is just a turn counter, so a long-but-clean session scored like a rotted
  one. Depth is now a 20% baseline; the genuine degradation signals — redundant
  reads and per-turn token growth — carry 25% each. ("Tool entropy" was also
  renamed to **"Tool looping"** — it measures repetition, the opposite of what
  "entropy" implies.)
- **Recommendation cost is now correct.** The model-switch estimate used a
  hardcoded ~8k tokens/turn regardless of the actual session, understating real
  cost several-fold on large sessions. It now uses the session's measured
  tokens/turn. Also fixed the "$0.64¢/turn" unit bug (mixed $ and ¢).
- **Remediation tied to the cause.** A new "What's driving it" card names the
  dominant signal and the specific fix — e.g. redundant reads →
  use `#tokenslayer-structural-summary` instead of re-reading; high depth/growth
  → `/compact` or a fresh session.

## MCP server [1.3.0] — 2026-06-13

### Added

- **Low-yield skeleton detection.** Bundled, minified, or IIFE/closure-wrapped
  files (e.g. `lodash.js`, an esbuild bundle) trap their real symbols inside a
  collapsed body, so the structural skeleton drops them while still reporting a
  huge reduction %. The analyze tools now detect this — a large file whose
  skeleton is suspiciously sparse (< 12 skeleton-lines per 1000 source lines;
  calibrated on real files: collapsed ≈7–8, conventional ≥23) is marked
  `lowYield`, and the output appends a warning telling the caller to grep / read
  targeted ranges instead of trusting the husk. Prevents a confident but empty
  skeleton from masquerading as a 99% saving. (Extension LSP-path equivalent is
  a follow-up — the language server reports nested symbols differently and needs
  in-editor validation.)

## [1.3.0] — 2026-06-12

### Added

- **New `tokenslayer-call-graph` Language Model Tool.** Deterministic, zero-LLM
  answers to relationship questions, backed by the language server's call
  hierarchy (not a text search): `direction: "callers"` (what calls X),
  `"callees"` (what X calls), and `"impact"` (transitive callers — what could
  break if you change X, traced up to `depth`). Resolves overloads, methods, and
  re-exports correctly where grep can't, and returns a compact list of call
  sites that fits any context window. The Copilot wire-up instructions now steer
  the model to it for "what calls X / what breaks if I change X" questions.
- **Month-end usage forecast** on the Monthly tab. Linear burn-rate projection
  of combined requests (LLM + tool calls) with a budget-crossing estimate
  ("on track to hit budget around the 23rd"). Math is unit-tested; early-month
  estimates are flagged until there's enough signal.

### Changed

- **Extension is now bundled with esbuild** — the published VSIX drops from
  ~26 MB / 3,261 files to **~2.4 MB / 16 files**. The old size was gpt-tokenizer's
  full encoding data; bundling tree-shakes it to only the encoding the extension
  uses (token counts verified identical post-bundle). Faster activation, no
  behavior change.

## [1.2.0] — 2026-06-11

### Added

- **Dedicated Monthly tab** on both the VS Code sidebar and MCP HTML dashboards.
- **Richer monthly metrics:** requests, LLM tokens (in/out), models used per month,
  tool calls, compaction savings, analyses, and month-over-month deltas.
- **Per-month model breakdown** in the LLM usage tracker (`byMonth[].models`).

## [1.1.0] — 2026-06-11

### Added

- **Monthly usage dashboards** on both the VS Code sidebar and MCP HTML dashboard.
  LLM token usage (from Claude Code transcripts), tool invocation counts, and
  token savings roll up by calendar month — aligned with how Copilot/LLM
  subscriptions reset.
- **Month-over-month delta indicators** (↑/↓ vs previous month) for tokens saved,
  LLM usage, and MCP analyses.
- **Configurable monthly budgets with progress bars.** Extension setting
  `tokenslayer.monthlyRequestBudget` tracks combined LLM requests + tool calls;
  MCP env `TOKENSLAYER_MONTHLY_ANALYSIS_BUDGET` tracks analyses per month.
- **CSV export per month.** Extension dashboard save dialog and MCP endpoint
  `/api/export/monthly.csv` for spreadsheet/billing reviews.

## [1.0.0] — 2026-06-11

### Changed

- **Version 1.0.0** — TokenSlayer is production-ready. Extension and MCP server
  both unified at v1.0.0. All architectural features (BPE layout optimization,
  dependency chain analysis, structural patching, secrets detection, usage
  tracking, tool invocation tracking) are stable and tested.

## [1.4.1] — 2026-06-13

### Changed

- **Monthly budget + forecast now track a configurable scope** via the new
  `tokenslayer.budgetScope` setting (`copilot` | `combined`, default
  `copilot`). Copilot has a monthly premium-request quota; Claude Code API
  calls are token-billed with no request quota, so projecting combined
  requests against a Copilot budget was misleading. With a budget set, the
  budget bar and month-end forecast count only Copilot requests by default
  (set `combined` to include Claude + tool calls). With no budget set, the
  forecast still shows combined activity.
- **LLM Tokens card now accounts for cached tokens.** The sub-label showed
  only "in · out", leaving the bulk of the total (Claude Code's cache reads)
  unexplained — e.g. 67.0M total under "9.6K in · 404K out". It now appends
  "· N cache" so the headline number reconciles.

### Fixed

- Copilot column shows `0` (not `—`) for months where Copilot tracking is
  available but had no requests, matching the summary card.
- "1 session" is no longer rendered as "1 sessions".

## [1.4.0] — 2026-06-12

### Added

- **GitHub Copilot request counts — monthly and total.** The dashboard
  previously showed request counts only for Claude Code (parsed from its
  transcripts); Copilot requests were invisible. A new `CopilotUsageTracker`
  parses the chat-session logs VS Code persists under
  `workspaceStorage/<hash>/chatSessions/` — including the op-log `.jsonl`
  format (kind-0 snapshot, kind-1 set-ops, kind-2 array-appends; new requests
  arrive as kind-2 appends) and legacy `.json` sessions — and reports requests
  per calendar month, per model, and all-time for the current workspace.
  Surfaced in the Monthly tab (new Copilot column + summary card with all-time
  total), the combined Requests card, the budget bar, the month-end forecast,
  and the CSV export (`copilot_requests`, `copilot_models` columns). Works for
  VS Code, Insiders, and VSCodium storage locations. Note: this is a local
  count of chat/agent requests made from this machine and workspace — not
  GitHub's billed premium-request meter (no model multipliers, no other
  devices, no inline completions).

## [0.7.0] — 2026-06-12

### Added

- **Default token budgets on all MCP analyze tools** (`analyze_files` 4000,
  `analyze_workspace` 6000, `analyze_dependency_chain` 4000; pass `maxTokens: 0`
  to opt out). SpendBench measured that an unbudgeted skeleton of a huge file
  can cost more than the targeted read it replaces — agents rarely pass
  `maxTokens` unprompted, so the cap is now the default. When output is pruned,
  it ends with a note telling the model how to drill deeper (`symbol`/`query`
  targeting, `expand_node`, or a larger budget).
- **Copilot tool take-up telemetry.** The extension now counts its own LM-tool
  invocations per workspace (stored locally in workspace state, nothing leaves
  the machine) and shows them in the dashboard — answering "does Copilot
  actually call our tools?" If take-up stays at 0 while using agent mode, the
  tools picker / descriptions are the problem, not skeleton quality.
- **API request counts in the LLM usage panel.** The Claude Code transcript
  tracker now also counts requests (assistant messages with usage), shown
  alongside sessions.

## [0.6.0] — 2026-06-11

### Changed

- **Tool descriptions now tell the model when NOT to use TokenSlayer.**
  End-to-end benchmarking (SpendBench) showed agents invoked `analyze_workspace`
  even for trivial single-file lookups, adding 37–55% cost overhead with zero
  benefit — the description was all trigger, no anti-trigger. All MCP tool
  descriptions (`analyze_files`, `analyze_workspace`, `analyze_dependency_chain`)
  and the extension's `tokenslayer-structural-summary` model description now
  include explicit skip guidance: don't use the tools when the target file is
  already known, for small files, or for JSON/config/markdown content (no code
  structure to compact — a direct read/grep is cheaper). After the change,
  measured overhead on trivial tasks dropped to ~2–6% while large-file
  orientation retained its full benefit (~60% fewer tokens, ~2.5× faster than
  baseline on a 17k-line file task).

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
