# Contributing to TokenSlayer

Thanks for your interest. TokenSlayer is a VS Code extension **plus** a standalone
MCP server — both built so non-VS-Code users (Cursor, Claude Code, Claude Desktop,
Windsurf) get the same token savings.

This guide covers what you need to know to develop, test, and submit a change.

---

## Repository layout

```
TokenSlayer/
├── src/                          # VS Code extension (TypeScript, compiles to out/)
│   ├── compaction/               # Per-language compactors (LSP-based)
│   ├── extraction/               # Symbol tree + skeleton builder
│   ├── cache/                    # LRU cache with content-hash invalidation
│   ├── tools/                    # Language Model Tool for Copilot
│   ├── copilot/                  # Wire-Up Copilot command
│   ├── chat/                     # @tokenslayer chat participant
│   ├── server/                   # Local HTTP API on :4733
│   ├── views/                    # Dashboard webview, CodeLens, decorations
│   └── utils/                    # Logger, token estimator, secrets detector
├── test/                         # VS Code extension unit tests (node:test)
│   ├── _mocks/vscode.js          # Minimal vscode API mock
│   ├── _setup.js                 # require('vscode') interceptor
│   └── *.test.js                 # secrets, wireUp, tokenEstimator, compactors
├── mcp-server/                   # Standalone MCP server (TypeScript)
│   ├── src/                      # parser.ts (heuristic), stats.ts, dashboard.ts
│   ├── test/                     # MCP unit tests
│   └── eval/                     # Signal-preservation eval harness
└── media/                        # Icon and dashboard assets
```

---

## Quick start

```bash
git clone https://github.com/ajvikram/TokenSlayer.git
cd TokenSlayer

# Install dependencies for both projects
npm install
(cd mcp-server && npm install)

# Compile both
npm run compile
(cd mcp-server && npm run build)
```

To launch the Extension Development Host, open the repo in VS Code and press **F5**.

---

## Running tests

```bash
# VS Code extension — 155 unit tests (compiles first)
npm test

# Standalone MCP server — 88 unit tests
(cd mcp-server && npm test)

# Signal-preservation eval — 29 questions across 9 languages
(cd mcp-server && npm run eval)

# Machine-readable eval output for CI
(cd mcp-server && npm run eval -- --json)
```

All three must be green for a PR to land.

The VS Code tests use a minimal `vscode` API mock ([test/_mocks/vscode.js](test/_mocks/vscode.js))
loaded via a `--require` hook ([test/_setup.js](test/_setup.js)). `workspace.fs`
is backed by a real temp directory, so wireUp tests exercise actual file I/O.

---

## Adding a language compactor

Both sides need a compactor for full coverage.

### VS Code extension (LSP-based)

1. Create `src/compaction/<lang>Compactor.ts` implementing `ICompactor`.
2. Register it in [src/compaction/compactor.ts](src/compaction/compactor.ts) under `CompactorFactory.compactors`.
3. Add the language ID to `codeLensSelector` and `supportedLanguages` in [src/extension.ts](src/extension.ts).
4. Add tests to [test/compactors.test.js](test/compactors.test.js) with a mock symbol tree.

### Standalone MCP server (heuristic)

1. Add an extension → language mapping in `getLanguage()` in [mcp-server/src/parser.ts](mcp-server/src/parser.ts).
2. Add a `process<Lang>()` function for the language, or extend `processCLike()` if it fits.
3. Add tests to [mcp-server/test/parser.test.js](mcp-server/test/parser.test.js).
4. Add an eval fixture to [mcp-server/eval/fixtures/](mcp-server/eval/fixtures/) and 2–4 questions to [mcp-server/eval/questions.json](mcp-server/eval/questions.json).

---

## Style

- TypeScript strict mode is on. New code must type-check cleanly.
- No new external runtime dependencies without discussion — TokenSlayer's
  appeal is partly that it has almost none.
- Test-first when adding bug fixes. The CI suite has caught real bugs and
  should keep doing so.

---

## Filing issues

When reporting a bug:

1. Tell us which side: VS Code extension or standalone MCP server.
2. Paste the file path and the language ID (`typescript`, `python`, etc.).
3. Paste the actual skeleton you got (`TokenSlayer: Preview Skeleton` or the
   MCP `analyze_files` output).
4. Tell us what was missing or wrong.

For feature requests, please first check [CHANGELOG.md](CHANGELOG.md) — many
things are in flight.

---

## Pull request checklist

- [ ] Tests added for new behavior (or updated for fixed behavior).
- [ ] `npm test` passes (root, 155 tests).
- [ ] `cd mcp-server && npm test` passes (88 tests).
- [ ] `cd mcp-server && npm run eval` exits 0.
- [ ] If you added a language, both sides have a compactor.
- [ ] If you added a public command/setting/MCP tool, [README.md](README.md) is updated.
- [ ] If you added user-visible behavior, [CHANGELOG.md](CHANGELOG.md) `[Unreleased]` is updated.

---

## Security issues

Don't open a public issue. See [SECURITY.md](SECURITY.md).

---

## License

By contributing you agree your contribution is licensed under the project's [MIT License](LICENSE).
