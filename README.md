<div align="center">
  <img src="media/icon.png" alt="TokenSlayer" width="128" />
  <h1>⚡ TokenSlayer</h1>
  <p><strong>Semantic Structural Cache for Any AI Coding Tool</strong><br/>Slash LLM token usage by 40–95% with AST-driven code skeletons — 15 languages, dependency chain analysis, structural patching, BPE-optimized layouts</p>

  [![CI](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml/badge.svg)](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml)
  [![Release](https://github.com/ajvikram/TokenSlayer/actions/workflows/release.yml/badge.svg)](https://github.com/ajvikram/TokenSlayer/actions/workflows/release.yml)
  [![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visual-studio-code)](https://code.visualstudio.com/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
</div>

---

## The Problem

AI coding assistants waste **up to 80% of tokens** during the "orientation phase" — reading massive files just to understand where a single function is. Every time Copilot needs context, it reads raw files, consuming thousands of tokens for information that could fit in a few lines.

```
Without TokenSlayer:  1,200 lines of raw code  →  5,000 tokens consumed
With TokenSlayer:     8-line structural skeleton →    200 tokens consumed (96% reduction)
```

**TokenSlayer** fixes this by providing compact AST-driven structural skeletons instead of raw file contents — as a VS Code Language Model Tool for Copilot, and as a standalone MCP server for Cursor, Claude Code, Cline, Continue, Windsurf, and any MCP-compatible client.

---

## ✨ Features

### 1️⃣ The VS Code Extension

#### 🧠 Three-Layer Semantic Engine

| Layer | What It Does | Performance |
|---|---|---|
| **AST Extraction** | Single LSP API call → full symbol tree | ~10ms per file |
| **Domain Compaction** | Language-specific compactors strip bodies, keep signatures | ~5ms (pure string ops) |
| **Semantic Caching** | Content-hash LRU cache with file-watcher invalidation | Instant on repeat |

#### 🔧 Copilot Integration (3 LM Tools)

Three [Language Model Tools](https://code.visualstudio.com/api/extension-guides/language-model-tool) that Copilot can call autonomously:

| Tool | What It Does |
|---|---|
| `#tokenslayer-structural-summary` | Returns compact AST skeleton with `/* NODE:id */` markers. Supports `scope: "dependency-chain"` and `targetModel` for BPE optimization. |
| `#tokenslayer-apply-patch` | Applies structural patches by node ID — `replace`, `insert_after`, `delete`. Returns a unified diff. |
| `#tokenslayer-expand-node` | Expands a `NODE:<id>` marker back to that block's full source — drill into one function without re-reading the file. |

```
@user: #tokenslayer-structural-summary How is authentication structured?

TokenSlayer → returns compact skeleton with NODE markers → Copilot answers using 200 tokens instead of 5,000
```

#### 🔌 Wire Up Any AI Tool (One Command)

**`TokenSlayer: Wire Up AI Tool`** — a single QuickPick command that generates MCP configuration for your tool of choice:

| Tool | Config Generated |
|---|---|
| **GitHub Copilot** | `.github/copilot-instructions.md` + `.vscode/mcp.json` |
| **Cursor** | `.cursor/mcp.json` |
| **Cline** | `.cline/mcp_settings.json` |
| **Continue** | `.continue/config.json` |
| **Windsurf** | `.windsurf/mcp.json` |
| **Claude Code** | `.claude/settings.local.json` |

**Usage:**

1. Open the workspace where you want your AI tool to prefer skeletons.
2. `Cmd+Shift+P` → **`TokenSlayer: Wire Up AI Tool`** → pick your tool.
3. Reload your editor and start a chat session.

All wire-ups are idempotent — they merge into existing config files without clobbering other content. The legacy **`TokenSlayer: Wire Up Copilot`** command still works.

**What this actually fixes (and what it doesn't):**

| Surface | Before wire-up | After wire-up |
|---|---|---|
| Copilot Chat (ask mode) | Tool router may or may not call the skeleton | Explicit instructions push it to call the skeleton first |
| Copilot Chat (agent mode) | LM Tool only | LM Tool **+** MCP server registration |
| Explicit `#tokenslayer-structural-summary` | Works | Works |
| Inline ghost-text completions | No interception possible | **Still no interception** — Copilot's own context engine |
| `@workspace` queries | No interception possible | **Still no interception** — Copilot's own embeddings index |

Inline completions and `@workspace` are not part of any public extension API surface today. Wire-up moves chat-side savings from "best effort" toward "deterministic", but it cannot affect those two paths.

#### 📊 Premium Sidebar Dashboard

<div align="center">
  <table>
    <tr>
      <td><img src="media/screenshot-dashboard-top.png" alt="Dashboard — Stats, Coverage, Donut, Language Chart" width="320" /></td>
      <td><img src="media/screenshot-dashboard-bottom.png" alt="Dashboard — Top Savers, Activity, Excluded Files" width="320" /></td>
    </tr>
    <tr>
      <td align="center"><em>Stats · Coverage Ring · Donut · Language Chart</em></td>
      <td align="center"><em>Timeline · Top Savers · Activity · Excluded Files</em></td>
    </tr>
  </table>
</div>

A real-time analytics dashboard with:

- **⚡ Hero Counter** — Animated token savings counter with gradient text
- **📈 Stats Grid** — Reduction %, files analyzed, cache hit rate, cached entries, tokens processed, avg saved/file
- **💰 Estimated Cost Saved** — Real-time cost estimates for GPT-4o and Claude Sonnet based on actual token savings
- **🤖 LLM Tokens Used** — Real token consumption for the workspace (input/output/cache, per-model breakdown), aggregated from Claude Code session transcripts
- **🔵 Workspace Coverage Ring** — SVG circular progress showing analyzed vs total files
- **🍩 Donut Chart** — Animated circular chart showing compaction ratio
- **📊 Language Breakdown** — Horizontal bar chart with language icons (15 languages supported)
- **📈 Session Timeline** — Canvas sparkline showing savings over time
- **🏆 Top Savers Leaderboard** — Top 5 files by token savings with 🥇🥈🥉 medals
- **📋 Recent Activity** — Clickable file cards with reduction badges
- **🛡️ Excluded Files** — Files blocked for containing secrets, with severity badges
- **🔄 Auto-Refresh** — Dashboard updates every 5 seconds automatically

#### ⚡ Inline CodeLens

TokenSlayer adds reducibility indicators directly in your editor:

```
⚡ 69.7% reducible — 373 → 113 tokens        ← File-level indicator
class MemoryManager:
  ⚡ ~30 lines → ~9 lines skeleton             ← Class-level indicator
  def __init__(self, agent_id):
```

<div align="center">
  <img src="media/screenshot-codelens.png" alt="CodeLens inline indicator" />
  <p><em>Real CodeLens indicator showing <code>⚡ ~119 lines → ~14 lines skeleton</code> above a class</em></p>
</div>

#### 📂 File Explorer Badges

Color-coded badges appear on files in the Explorer sidebar:

| Badge | Meaning |
|---|---|
| ⚡ (green) | File analyzed & cached — shows reduction % on hover |
| 🔒 (red) | File excluded — contains detected secrets |

#### 🛡️ Secrets Detection & Protection

Automatically scans files for credentials and blocks them from LLM context:

| Detection | Examples |
|---|---|
| **API Keys** | AWS (`AKIA...`), Google (`AIza...`), Stripe (`sk_live_...`) |
| **Tokens** | GitHub (`ghp_...`), GitLab (`glpat-...`), Slack (`xox...`) |
| **Private Keys** | RSA, PGP, SSH private keys, PEM/P12 certificates |
| **Database** | Connection strings (MongoDB, Postgres, MySQL, Redis) |
| **Passwords** | Hardcoded passwords, JWT secrets, SSH credentials |
| **Sensitive Files** | `.env`, `.pem`, `.key`, `credentials.json`, `.htpasswd` |

Excluded files appear in the dashboard with severity levels: 🔴 HIGH · 🟡 MEDIUM · 🟢 LOW

The standalone MCP server enforces the same protection: flagged files return an
`Excluded: secrets detected` error instead of a skeleton, and assigned values are
stripped from variable declarations and class fields (`const API_KEY = "sk-…"` →
`const API_KEY;`) so hardcoded values never reach model context.

#### 📋 Export Report

Generate a formatted Markdown report with complete savings analytics:

```markdown
# ⚡ TokenSlayer Report

## Summary
| Metric         | Value   |
|----------------|---------|
| Tokens Saved   | 191,283 |
| Reduction      | 95%     |
| Files Analyzed | 50      |

## Language Breakdown
| Language   | Files | Tokens Saved | Reduction |
|------------|-------|-------------|-----------|
| typescript | 12    | 144,060     | 96%       |
| python     | 38    | 47,223      | 67%       |
```

#### 👁️ Skeleton Preview

Side-by-side comparison of original file vs structural skeleton with `TokenSlayer: Preview Skeleton` command.

---

### 2️⃣ Universal IDE Support (Zero VS Code Dependency)

TokenSlayer has evolved into a Universal Semantic Cache. If you do not use VS Code, you can still slash your token usage natively in Cursor, Claude Desktop, Windsurf, or your terminal.

#### 🤖 Cursor & Claude Desktop (True Node MCP Server)

TokenSlayer includes a **True Standalone Node MCP Server**. It uses our zero-dependency heuristic parser to analyze your codebase instantly, **without requiring VS Code to be open!**

**How to use in Cursor:**
1. Open Cursor -> Settings -> Features -> MCP Servers
2. Click **+ Add New MCP Server**
3. Type: `command`
4. Command: `node /absolute/path/to/TokenSlayer/mcp-server/build/index.js`
5. Save! Cursor will instantly have access to all 7 MCP tools: `analyze_files`, `analyze_workspace`, `analyze_dependency_chain`, `expand_node`, `apply_patch`, `get_stats`, and `clear_stats`.

#### 💻 Claude Code (Global Default via `CLAUDE.md`)

If you use [Claude Code](https://claude.com/claude-code), registering the MCP server is only half the job — Claude won't reach for `analyze_files` unless instructed to prefer it over the built-in `Read` tool. Rather than mentioning TokenSlayer in every prompt, add a **one-time global instruction** that loads into every session in every project.

**Step 1 — Register the MCP server:**

```bash
claude mcp add tokenslayer -- node /absolute/path/to/TokenSlayer/mcp-server/build/index.js
```

Or add an `.mcp.json` to your project (same shape as the `.vscode/mcp.json` that `TokenSlayer: Wire Up Copilot` generates).

**Step 2 — Create `~/.claude/CLAUDE.md`** (if it doesn't exist) and add:

```markdown
## TokenSlayer MCP

For any code orientation, navigation, or "where is X defined / how is Y wired" question, call the `tokenslayer` MCP server's `analyze_files` (single or multiple files) or `analyze_workspace` (whole directory) tool BEFORE reading files with the `Read` tool.

Raw `Read` is only justified when you need exact line content — editing a file, debugging a specific line, or reading config/data files that have no code structure to compact.

Every `tokenslayer` response begins with a `📊 Session Stats: Saved X% tokens (original -> compacted)` header. Treat that as confirmation the tool ran; do not strip it away when relaying findings.
```

**Step 3 — Restart Claude Code** and ask any *"where is X defined?"* or *"how is auth wired?"* question. Claude should now call `mcp__tokenslayer__analyze_files` instead of `Read`, and every response will lead with the savings header — your per-call receipt.

**Step 4 (optional) — See cumulative savings.** Every call is also persisted to `~/.tokenslayer/stats.jsonl`. Ask Claude *"how much has TokenSlayer saved me?"* (calls the `get_stats` tool), or see [Standalone Dashboard](#-standalone-dashboard-no-vs-code-required) below for terminal/browser views.

**Equivalents in other clients (same idea, different field):**

| Client | Where to paste the instruction |
|---|---|
| **Cursor** | Settings → Rules → "User Rules" (global across all projects) |
| **Windsurf** | Settings → Cascade → Global Rules |
| **Claude Desktop** | No global field — paste into each project's "Project Instructions" |

#### 🐍 Universal Standalone CLI & Agent Skill

If you use Windsurf, Antigravity, or just the terminal, TokenSlayer provides a 100% standalone, zero-dependency CLI parser: `standalone/tokenslayer.js`.

**How to use as an Agent Skill:**
Just tell your agent:
> *"Use `node /path/to/TokenSlayer/standalone/tokenslayer.js <filepath>` to read files instead of reading them directly."*

**How to use via CLI:**
```bash
node standalone/tokenslayer.js src/extension.ts
```

#### 📊 Standalone Dashboard (No VS Code Required)

The standalone MCP server tracks cumulative savings to `~/.tokenslayer/stats.jsonl` and exposes those stats three ways — so you can see how much TokenSlayer has saved you regardless of which client you use (Claude Code, Cursor, Claude Desktop, Windsurf, CLI).

**1. Inline in chat — `get_stats` MCP tool**

Once the MCP server is registered, just ask your assistant: *"How much has TokenSlayer saved me?"* It will call the `get_stats` tool and return a markdown table inline:

```markdown
# ⚡ TokenSlayer Stats

| Metric           | Value     |
|------------------|-----------|
| Tokens Saved     | 191,283   |
| Reduction        | 87%       |
| Tokens Processed | 219,980   |
| Avg Saved / File | 1,348     |
| Est. Cost Saved  | ~$0.48 (GPT-4o) / ~$0.57 (Claude Sonnet) |
| Total Analyses   | 142       |
| Unique Files     | 38        |
```

There is also a `clear_stats` tool to reset history.

**2. Terminal — `--stats` flag**

A colored ANSI dashboard in your terminal, on-demand:

```bash
node mcp-server/build/index.js --stats
```

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚡ TokenSlayer — Savings Dashboard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Tokens Saved      10,246
  Reduction         81%
  Original          12,690
  Compacted         2,444

  By Language
  typescript     files=   5  saved=    10,246    81%

  Top Savers
  .../TokenSlayer/src/extension.ts        3,606    85%
  .../mcp-server/src/dashboard.ts         2,213    83%
```

**3. Browser — local HTML dashboard**

A live-refreshing dashboard with hero counter, cost estimates, sparkline timeline, language breakdown, top savers, and recent activity feed — feature-parity with the VS Code sidebar dashboard:

```bash
node mcp-server/build/index.js --dashboard         # default port 4734
node mcp-server/build/index.js --dashboard --port=4735
```

Then open <http://localhost:4734>. Auto-refreshes every 5 seconds.

**MCP tools reference (7 tools):**

| Tool | Description |
|---|---|
| `analyze_files` | Analyze one or more files — supports `symbol`, `query`, `maxTokens`, `format`, `expandable`, `targetModel` |
| `analyze_workspace` | Analyze an entire directory — supports `query`, `maxTokens`, `format`, `maxFiles`, `targetModel` |
| `analyze_dependency_chain` | Follow imports from a seed file — supports `depth`, `query`, `maxTokens`, `format`, `expandable`, `targetModel` |
| `expand_node` | Retrieve original source for a pruned node ID (lazy-loading) |
| `apply_patch` | Apply structural patches via node IDs — `replace`, `insert_after`, `delete` actions with `dryRun` safety |
| `get_stats` | Return cumulative savings with cost estimates and timeline |
| `clear_stats` | Reset all stats history |

**CLI reference:**

| Flag | Description |
|---|---|
| `--stats` | Print cumulative savings to terminal and exit |
| `--dashboard` | Start local HTML dashboard (default port 4734) |
| `--dashboard --port=N` | Use a custom port |
| `--clear-stats` | Delete the stats file |
| `--stats-file` | Print the stats file path |
| `--help` | Show all flags |

Stats are stored in JSONL at `~/.tokenslayer/stats.jsonl` — append-only, one record per file analysis, safe to read or delete by hand.

#### 🧠 Agent Capabilities (MCP Server v3.0 + Extension)

Both the standalone MCP server and the VS Code extension expose advanced features that turn TokenSlayer from a static file filter into a **dynamic context orchestrator** for AI agents. All capabilities below are available in both the MCP server (via tools) and the VS Code extension (via LM Tools + commands):

| Capability | Parameter | Description |
|---|---|---|
| **Symbol-level addressing** | `symbol: "UserService"` | Extract only the named class, function, or struct — skip the rest of the file |
| **JSON output** | `format: "json"` | Returns structured data with per-file metadata, token counts, and skeletons for programmatic agent consumption |
| **Query-based ranking** | `query: "auth login"` | Sorts results by keyword relevance — most important files surface first, filename matches boosted |
| **Budget-driven pruning** | `maxTokens: 1500` | Progressively strips doc comments, body hints, blank lines, then hard truncates to fit a strict token budget |
| **Expandable nodes** | `expandable: true` | Tags ALL skeleton elements with node IDs (`/* NODE:id */` for signatures/decls, `/* EXPAND:id */` for pruned bodies). Call `expand_node(nodeId)` to lazy-load any block's full source |
| **Dependency chain** | `analyze_dependency_chain` | Follow local imports from a seed file via BFS traversal, returning a merged skeleton of the entire call chain |
| **Structural patching** | `apply_patch` | Apply AST diffs (replace/insert/delete by node ID) — model returns 15 tokens of patch instead of 2,000 tokens of rewrite |
| **BPE-aware tokenizer** | `targetModel: "gpt-4o"` | Use a real BPE tokenizer for accurate token counting + whitespace/indent layout optimization for the target model |

**Example — budget-constrained, query-ranked workspace scan:**

```json
{
  "tool": "analyze_workspace",
  "arguments": {
    "directoryPath": "/path/to/project",
    "query": "authentication middleware",
    "maxTokens": 3000,
    "format": "json"
  }
}
```

**Example — follow imports from an entry point:**

```json
{
  "tool": "analyze_dependency_chain",
  "arguments": {
    "seedFile": "/path/to/project/src/main.ts",
    "depth": 2,
    "expandable": true,
    "targetModel": "gpt-4o"
  }
}
```

**Example — apply a structural patch (dry run):**

```json
{
  "tool": "apply_patch",
  "arguments": {
    "patches": [
      { "nodeId": "L3Vzci9zcmMvYXV0aC50czo1OjE1OnNpZw", "action": "replace", "content": "async function login(email: string, otp: string): Promise<Session> {" }
    ],
    "dryRun": true
  }
}
```

This enables three powerful agent patterns:
1. **Lazy loading** — read a skeleton, then `expand_node` just the functions needed for debugging
2. **Dependency tracing** — follow `analyze_dependency_chain` to see the full call graph across files
3. **Precision editing** — return 15-token `apply_patch` diffs instead of 2,000-token full file rewrites

#### 🔌 Local HTTP REST API (VS Code Extension Only)

If you prefer REST, running the VS Code Extension exposes a local HTTP API (port `4733`) so custom scripts can query the cache.
- `GET /analyze?path=/path/to/file` -> Returns JSON structural skeleton
- `GET /stats` -> Returns JSON token savings data

> This is distinct from the standalone MCP dashboard above (port `4734`), which runs without VS Code.

---

## 🌐 Supported Languages (15)

All compactors preserve **doc-comment first lines** (JSDoc, Javadoc, KDoc, Rustdoc, C# XML `<summary>`, Go `//`, Python docstring), giving the LLM the *intent* of every symbol without the full body. Long doc lines are clamped to 120 chars.

| Language | Compactor Features |
|---|---|
| **TypeScript / JavaScript** | Strips bodies, keeps signatures, interfaces, types, compacted imports, **JSDoc first line** |
| **Python** | Keeps signatures with type hints, first-line docstrings, and a wide decorator allow-list (`@dataclass`, `@cached_property`, `@override`, FastAPI/Flask routes `@app.get`/`@bp.route`, Django `@login_required`/`@csrf_exempt`, Celery `@task`, click `@click.command`, pytest `@pytest.mark.*`, plus any qualified `@module.name` decorator) |
| **Go** | Keeps type/func signatures, struct fields, interface methods, **Go-style `//` doc comments** |
| **Java** | Keeps class/interface/enum, method signatures, Spring/Lombok/JPA/JUnit annotations, **Javadoc first line** |
| **Rust** | Keeps struct/enum/trait/impl, function signatures, derive macros, cfg/test attributes, **`///` and `/** */` doc-comments** |
| **C#** | Keeps record/struct/class, signatures, properties, ASP.NET attributes `[Route]`, `[ApiController]`, **XML `<summary>` doc-comments** |
| **Kotlin** | Keeps data class/object, val/var, JVM/Spring annotations `@RestController`, `@JvmStatic`, **KDoc first line** |
| **PHP** | Keeps namespace, use, class/interface/trait, function signatures, properties, attributes `#[...]` |
| **Ruby** | Keeps require, module/class, `def` signatures, `attr_*` declarations, constants, Rails macros |
| **Swift** | Keeps imports, class/struct/enum/protocol, func/init signatures, `@objc`/`@available` attributes |
| **SQL** | Keeps `CREATE TABLE`/`INDEX`/`VIEW`, column definitions, `SELECT`/`INSERT`/`UPDATE`/`DELETE` statements |
| **Vue** (`.vue`) | SFC-aware — splits `<template>`, `<script>`, `<style>` blocks and compacts each with the appropriate language processor |
| **Svelte** (`.svelte`) | Same SFC strategy as Vue — structural template + compacted script + compacted style |
| **HTML** | Keeps DOCTYPE, structural tags, `id`/`class`/`role`/`aria-*`/`data-*` attributes, script/link/meta, form/input/button. Preserves text inside structural label tags (`<title>`, `<h1>`–`<h6>`, `<label>`, `<button>`, `<a>`); elides long text inside generic containers (`<p>`, `<div>`); strips comments. |
| **CSS / SCSS / Less / Sass** | Keeps selectors, at-rules (`@media`, `@keyframes`, `@import`, `@font-face`, `@supports`), `:root` custom-property design tokens, brace structure. Strips property:value declarations inside rule bodies and block/line comments. |

---

## 🚀 Getting Started

### Requirements

- **VS Code** 1.93+
- **GitHub Copilot Chat** extension (for LM Tool integration)

### Install from VSIX

1. Download the latest `.vsix` from [Releases](https://github.com/ajvikram/TokenSlayer/releases)
2. In VS Code: `Cmd+Shift+P` → `Extensions: Install from VSIX...`
3. Select the downloaded file
4. Reload VS Code

### First Use

1. Open any project with supported source files
2. The ⚡ **TokenSlayer** sidebar appears in the Activity Bar
3. Files are **auto-analyzed** when you open or save them
4. Use `Cmd+Shift+P` → `TokenSlayer: Analyze Workspace` to scan all files at once
5. In Copilot Chat, type `#tokenslayer-structural-summary` to explicitly use the tool

---

## ⌨️ Commands

| Command | Description |
|---|---|
| `TokenSlayer: Analyze Workspace` | Scan all supported files in the workspace |
| `TokenSlayer: Analyze Current File` | Analyze the active editor file |
| `TokenSlayer: Preview Skeleton` | Open skeleton preview alongside the file |
| `TokenSlayer: Show Dashboard` | Focus the sidebar dashboard |
| `TokenSlayer: Export Savings Report` | Generate a Markdown savings report |
| `TokenSlayer: Clear Cache` | Purge all cached skeletons |
| `TokenSlayer: Wire Up AI Tool` | Pick an AI tool (Copilot, Cursor, Cline, Continue, Windsurf, Claude Code) and generate its MCP config |
| `TokenSlayer: Wire Up Copilot` | Legacy — generates `.github/copilot-instructions.md` + `.vscode/mcp.json` |
| `TokenSlayer: Analyze Dependency Chain` | Follow local imports from the active file via BFS traversal and analyze the full chain |
| `TokenSlayer: Apply Structural Patch` | Read a JSON patch from clipboard, preview the diff, and optionally apply changes |

---

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `tokenslayer.maxFileSizeKB` | `500` | Max file size to analyze (KB) |
| `tokenslayer.cacheMaxEntries` | `500` | Max cached skeletons before LRU eviction |
| `tokenslayer.verbosity` | `standard` | Skeleton detail level: `minimal` / `standard` / `detailed` |
| `tokenslayer.ignoredPaths` | `node_modules, dist, ...` | Glob patterns to exclude from analysis |
| `tokenslayer.targetModel` | `""` (disabled) | Target LLM for BPE layout optimization: `gpt-4o`, `gpt-4`, `claude`, `auto` |
| `tokenslayer.dependencyChainDepth` | `2` | Max import-follow depth for dependency chain analysis (1–5) |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   VS Code Extension Host                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │  LM Tool     │    │  Dashboard   │    │ CodeLens  │  │
│  │  (Copilot)   │    │  (Webview)   │    │ Provider  │  │
│  └──────┬───────┘    └──────┬───────┘    └─────┬─────┘  │
│         │                   │                  │        │
│  ┌──────▼───────────────────▼──────────────────▼─────┐  │
│  │              Structural Summary Tool               │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  ┌──────────┐  ┌──────────────┐  ┌─────────────┐  │  │
│  │  │ Secrets  │  │   Symbol     │  │  Skeleton   │  │  │
│  │  │ Detector │  │  Extractor   │  │  Builder    │  │  │
│  │  │          │  │  (1 LSP call)│  │             │  │  │
│  │  └────┬─────┘  └──────┬───────┘  └──────┬──────┘  │  │
│  │       │               │                 │         │  │
│  │  ┌────▼───────────────▼─────────────────▼──────┐  │  │
│  │  │          Domain Compactors (15 langs)         │  │  │
│  │  │  TS/JS │ Py │ Go │ Java │ Rust │ C# │ + 9    │  │  │
│  │  └────────────────────┬─────────────────────────┘  │  │
│  │                       │                            │  │
│  │  ┌────────────────────▼─────────────────────────┐  │  │
│  │  │           LRU Cache Manager                  │  │  │
│  │  │    Content-hash keys │ File watcher           │  │  │
│  │  │    Disk persistence  │ Auto-invalidation      │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │  File Decor  │    │  Skeleton    │    │  Status   │  │
│  │  Provider    │    │  Preview     │    │  Bar      │  │
│  └──────────────┘    └──────────────┘    └───────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/ajvikram/TokenSlayer.git
cd TokenSlayer

# Install dependencies
npm install

# Compile
npm run compile

# Watch mode (auto-recompile on changes)
npm run watch

# Package as VSIX
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

Press **F5** to launch the Extension Development Host for testing.

### Project Structure

```
TokenSlayer/
├── src/
│   ├── extension.ts              # Entry point — registers everything
│   ├── types.ts                  # Shared TypeScript interfaces
│   ├── extraction/
│   │   ├── symbolExtractor.ts    # LSP symbol tree extraction (1 API call)
│   │   └── skeletonBuilder.ts    # Symbol tree → compact text
│   ├── compaction/
│   │   ├── compactor.ts          # Interface + factory router
│   │   ├── typescriptCompactor.ts
│   │   ├── pythonCompactor.ts
│   │   ├── goCompactor.ts
│   │   ├── javaCompactor.ts
│   │   ├── rustCompactor.ts
│   │   ├── csharpCompactor.ts
│   │   ├── kotlinCompactor.ts
│   │   ├── htmlCompactor.ts
│   │   ├── cssCompactor.ts
│   │   └── docCommentExtractor.ts # Cross-language doc-comment preservation
│   ├── cache/
│   │   └── cacheManager.ts       # LRU cache with persistence + cost estimates
│   ├── copilot/
│   │   ├── wireUp.ts             # Wire Up Copilot logic
│   │   └── wireUpAll.ts          # Wire Up for Cursor, Cline, Continue, Windsurf, Claude Code
│   ├── tools/
│   │   ├── structuralSummaryTool.ts  # LM Tool for Copilot (+ dependency-chain scope)
│   │   └── patchTool.ts             # LM Tool: tokenslayer-apply-patch
│   ├── views/
│   │   ├── dashboardProvider.ts  # Sidebar webview dashboard
│   │   ├── skeletonPreviewProvider.ts
│   │   ├── codeLensProvider.ts   # Inline ⚡ indicators
│   │   └── fileDecorationProvider.ts # Explorer badges
│   └── utils/
│       ├── logger.ts
│       ├── tokenEstimator.ts
│       ├── secretsDetector.ts    # Credentials scanner
│       ├── layoutOptimizer.ts    # BPE-aware layout optimization
│       ├── importResolver.ts     # Import extraction + dependency chain traversal
│       └── structuralPatch.ts    # Node tagging + structural patch engine
├── mcp-server/
│   ├── src/
│   │   ├── index.ts              # MCP server — 7 tools, v3.0
│   │   ├── parser.ts             # Heuristic parser — 15 languages + BPE + graph + patching
│   │   ├── stats.ts              # Stats persistence + cost estimates + timeline
│   │   └── dashboard.ts          # Standalone HTML dashboard
│   ├── test/
│   │   ├── parser.test.js        # Parser + language + feature tests
│   │   └── stats.test.js         # Stats aggregation tests
│   └── eval/
│       ├── run.js                # Signal-preservation eval harness
│       ├── questions.json        # 29 questions, 9 languages
│       └── fixtures/             # Test files for all supported languages
├── media/
│   ├── icon.png
│   └── dashboard.css
├── .github/workflows/
│   ├── ci.yml                    # CI: code check, build, security, package
│   └── release.yml               # Release: tag → VSIX → GitHub Release
└── package.json
```

---

## 🧪 Quality: Tests & Eval Harness

TokenSlayer ships with **363 unit tests** across both the VS Code extension and the standalone MCP server, plus a **29-question signal-preservation eval** spanning 9 languages — so the savings numbers are defensible, not marketing.

### Latest run

```
VS Code extension:  206/206 pass     (test/, node --test)
Standalone MCP:     157/157 pass     (mcp-server/test/, node --test)
Eval questions:      28/29  PASS · 1 KNOWN limitation
Token reduction:     49%             (5,155 → 2,626 tokens across 9 fixtures)
Signal fidelity:     99%             (82/83 signals preserved)
```

### VS Code extension tests ([test/](test/))

A `vscode` API mock ([test/_mocks/vscode.js](test/_mocks/vscode.js)) is loaded via a `--require` setup hook ([test/_setup.js](test/_setup.js)), so the extension's logic runs under plain Node without spinning up an Electron host. `workspace.fs` is backed by a real temp directory, so file-modifying tests verify against real I/O.

| Suite | Tests | What it covers |
|---|---|---|
| **[secretsDetector.test.js](test/secretsDetector.test.js)** | 46 | Safety-critical: AWS / GitHub / GitLab / Stripe / Slack / Google / Bearer / RSA / PGP / DB connection strings, false-positive guards, 5000-char perf bound |
| **[wireUp.test.js](test/wireUp.test.js)** | 12 | Idempotency, managed-block boundary preservation, other MCP servers preserved, malformed-JSON recovery, no-workspace guard |
| **[tokenEstimator.test.js](test/tokenEstimator.test.js)** | 15 | Char-fallback, divide-by-zero guard, negative reduction, thousands formatting |
| **[compactors.test.js](test/compactors.test.js)** | 103 | All 9 VS Code compactors (TS, Python, Go, Java, Rust, C#, Kotlin, HTML, CSS) — signatures, decorators, annotations, attributes, doc-comments, Python decorator allow-list (~55 tests), doc-comment preservation (~21 tests) |
| **[extensionFeatures.test.js](test/extensionFeatures.test.js)** | 30 | Layout optimization (7), import extraction (5), import resolution (4), dependency chain (3), node tagging (4), node ID decode (3), structural patching (4) |

### Standalone MCP server tests ([mcp-server/test/](mcp-server/test/))

Zero external dependencies (built-in `node:test`):

- **[parser.test.js](mcp-server/test/parser.test.js)** — all 15 language compactors, plus: `extractSymbol`, `scoreRelevance`, `pruneToFit`, `tokenize`, `optimizeLayout`, `extractImportSpecifiers`, `resolveImport`, `buildDependencyChain`, `tagAllNodes`, `decodeNodeId`, `applyPatches`.
- **[stats.test.js](mcp-server/test/stats.test.js)** — stats persistence: round-trip, aggregation totals, top-savers, language breakdown, malformed-line resilience, `avgSavedPerFile`, `estimatedCost`, timeline accumulation and capping.

### What the eval harness measures

The eval ([`mcp-server/eval/`](mcp-server/eval/)) uses a deterministic proxy for "would an LLM still answer correctly from the compacted version?" — **signal preservation**.

For each `(file, question)` pair in [questions.json](mcp-server/eval/questions.json), it records the substrings that *must* appear in the compacted output for the question to be answerable, then verifies all of them survived compaction. No API key needed; runs in ~50ms.

Example entry:

```json
{
  "id": "java-2",
  "file": "UserController.java",
  "question": "What HTTP methods does the controller expose?",
  "signals": ["@GetMapping", "@PostMapping", "@DeleteMapping"]
}
```

Questions span 9 languages (TS, Python, Go, Java, Rust, C#, Kotlin, HTML, CSS) and cover orientation patterns devs actually ask: *"what's the signature of X?"*, *"what's the public API?"*, *"what fields does this struct have?"*, *"what annotations are on this class?"*.

### Run it yourself

```bash
# VS Code extension tests (206 tests)
npm test                            # alias for test:unit; compiles first
npm run test:unit                   # explicit

# Standalone MCP server tests + eval
cd mcp-server
npm test                            # 157 unit tests
npm run eval                        # 29-question fidelity report (colored)
npm run eval -- --json              # machine-readable, for CI dashboards
```

Both exit cleanly (`0`) on success. The eval treats entries marked `knownLimitation` as expected gaps and does not fail the run — see [questions.json](mcp-server/eval/questions.json) for the one currently documented.

### Known limitation surfaced by the eval

The current standalone parser is heuristic/regex-based. It cannot reliably detect TypeScript methods declared **without** an explicit return type or access modifier (e.g. `middleware()` instead of `public middleware(): RequestHandler`). Fixing this would require swapping to a real AST (tsserver / tree-sitter). It's documented inline in `questions.json` rather than papered over.

---

## 🗺️ Roadmap

| Feature | Status | Description |
|---|---|---|
| **Cross-file graph splicing** | **Shipped** | `analyze_dependency_chain` MCP tool — follows imports via BFS and returns a merged skeleton of the full dependency chain |
| **AST-driven structural patching** | **Shipped** | `apply_patch` MCP tool — `tagAllNodes` assigns node IDs to every skeleton element; models return AST diffs instead of full rewrites |
| **Tokenizer-aware layout optimization** | **Shipped** | `targetModel` parameter enables real BPE tokenizer + `optimizeLayout` whitespace/indent minimization |
| **Extension feature parity** | **Shipped (v0.4.0)** | All 3 architectural features (BPE layout, dependency chain, structural patching) now available in the VS Code extension via LM Tools + commands |
| **Parser unification** | Planned | Unify the VS Code LSP-based compactors with the MCP heuristic parser into a single tree-sitter-backed engine |
| **Secrets detection in MCP server** | Planned | Port the VS Code extension's `SecretsDetector` to the standalone MCP parser |

See [CHANGELOG.md](CHANGELOG.md) for what shipped in the latest release.

---

## 🔒 Privacy & Telemetry

TokenSlayer is built to be safe for codebases under NDA. Concrete promises:

| What | Where it goes |
|---|---|
| **Source code you analyze** | Never leaves your machine. Skeletons are generated locally by the extension or the standalone MCP server and handed to the LLM client process you already control (Copilot, Cursor, Claude Code, etc.) — TokenSlayer itself does not call out. |
| **Token-savings stats (VS Code)** | Stored in the extension's `globalState` (per-user, per-machine). |
| **Token-savings stats (standalone MCP)** | Stored as append-only JSONL at `~/.tokenslayer/stats.jsonl`. Includes file paths in cleartext for the local dashboard. **Delete with `node mcp-server/build/index.js --clear-stats` at any time.** A future release will add an opt-out flag and a path-hashing mode for NDA'd repos. |
| **Network calls TokenSlayer makes** | **None** in the analyze path. The optional `gpt-tokenizer` package loads its BPE table from disk (no network). The `Wire Up Copilot` command writes to your workspace, never to a remote. |
| **Files flagged as containing secrets** | Excluded from skeleton generation in the VS Code extension; shown in the sidebar with severity. The standalone MCP server does not yet redact (tracked in [SECURITY.md](SECURITY.md)). |

If you want to verify these claims, the code paths are short: search `src/` and
`mcp-server/src/` for `http`, `fetch`, `https`, or `axios` — nothing in the
analyze path uses them. The only HTTP servers TokenSlayer runs are local
loopback listeners (`:4733` from the VS Code extension, `:4734` from the
standalone MCP dashboard) for your own scripts and browser.

See [SECURITY.md](SECURITY.md) for known gaps and how to report a vulnerability.

---

## 📊 CI/CD Pipeline

| Job | Description | Status |
|---|---|---|
| 🔍 **Code Quality** | TypeScript type checking, linting | [![CI](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml/badge.svg)](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml) |
| 🔨 **Build** | Multi-node compilation (Node 18, 20, 22) | [![CI](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml/badge.svg)](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml) |
| 🛡️ **Security** | npm audit, secrets scan, license compliance | [![CI](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml/badge.svg)](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml) |
| 📦 **Package** | VSIX artifact upload | [![CI](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml/badge.svg)](https://github.com/ajvikram/TokenSlayer/actions/workflows/ci.yml) |
| 🚀 **Release** | Tag-triggered VSIX release | [![Release](https://github.com/ajvikram/TokenSlayer/actions/workflows/release.yml/badge.svg)](https://github.com/ajvikram/TokenSlayer/actions/workflows/release.yml) |

### Creating a Release

```bash
# Tag a release
git tag v0.1.0
git push origin v0.1.0

# GitHub Actions will automatically:
# 1. Run all CI checks
# 2. Package the VSIX
# 3. Create a GitHub Release with the VSIX attached
```

---

## 🤔 How It Compares

| Approach | API Calls/File | Token Cost | Latency |
|---|---|---|---|
| Raw file reading | 0 | 5,000+ tokens | Instant (but wasteful) |
| TokenSlayer | 1 (LSP) | 200–500 tokens | ~15ms (first), 0ms (cached) |
| Full AST parser (tree-sitter) | N/A | Low | High (heavy dependency) |

**Why 1 API call?** We deliberately cut Call Graph Extractor, Type Hierarchy Extractor, and Query Matcher to keep performance at a single `executeDocumentSymbolProvider` call per file instead of 60+.

---

## 📚 Project documentation

- **[CHANGELOG.md](CHANGELOG.md)** — release notes, what's new and what's fixed
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — repo layout, dev setup, test commands, PR checklist
- **[SECURITY.md](SECURITY.md)** — vulnerability disclosure process + known gaps tracker
- **[Privacy & Telemetry](#-privacy--telemetry)** (above) — what TokenSlayer stores, where, and what it does not send anywhere

---

## 📝 License

[MIT](LICENSE) — Built with ⚡ by [Ajay Vikram](https://github.com/ajvikram)
