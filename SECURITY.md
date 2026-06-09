# Security Policy

## Supported versions

TokenSlayer is pre-1.0. Security fixes are applied to the latest released
version on the [GitHub Releases page](https://github.com/ajvikram/TokenSlayer/releases).
Older versions are not separately patched — please upgrade.

## Reporting a vulnerability

If you discover a security issue **do not open a public GitHub issue**.

Instead:

1. Open a private security advisory at
   <https://github.com/ajvikram/TokenSlayer/security/advisories/new>, or
2. Email the maintainer at the address listed on the
   [maintainer's GitHub profile](https://github.com/ajvikram).

Please include:

- A description of the vulnerability and its impact.
- A minimal reproduction (file, command, or sequence of MCP tool calls).
- Your suggested severity and any proposed fix.

You can expect:

- An acknowledgement within **72 hours**.
- A status update within **7 days** with a triage decision (accept, request
  more info, or decline with reasoning).
- A coordinated disclosure timeline once a fix is staged.

## Security promises and known risks

### What TokenSlayer does to protect you

- **Secrets detection (VS Code extension)**:
  [`SecretsDetector`](src/utils/secretsDetector.ts) scans every file before
  analysis for ~50 patterns (AWS, GitHub, GitLab, Stripe, Slack, Google,
  Bearer tokens, RSA/PGP/PEM keys, database connection strings, hardcoded
  passwords) and ~18 sensitive filename patterns (`.env*`, `.pem`, `.key`,
  `id_rsa`, `credentials.json`, etc.). Detected files are **excluded** from
  skeleton generation and surfaced in the dashboard with severity badges.
  Coverage is verified by [test/secretsDetector.test.js](test/secretsDetector.test.js)
  (46 tests including false-positive guards).
- **5,000-character scan bound**: the secrets detector only scans the first
  5 KB of each file for performance. Files larger than that may have secrets
  in the tail that aren't flagged.
- **Local-only execution**: TokenSlayer does not make outbound network calls
  in the analyze path (see Privacy & Telemetry in [README.md](README.md)).

### Known security gaps (being tracked)

| Gap | Severity | Status |
|---|---|---|
| The **standalone MCP server** has no secrets detection. Files with secrets analyzed via `analyze_files` flow to the LLM unredacted. | High | Planned for next MCP release |
| Stats persistence (`~/.tokenslayer/stats.jsonl`) logs every analyzed file path in cleartext. Awkward for NDA'd repos. | Low | Planned: opt-out flag + hash-paths mode |
| The `localhost:4734` standalone MCP dashboard binds to all interfaces by default with no auth. Only intended for local use. | Low | Planned: explicit `127.0.0.1` bind + opt-in remote |

### What TokenSlayer does NOT promise

- **No guarantee of complete secret detection.** New providers, custom token
  formats, and obfuscated secrets may slip through. Treat the detector as
  defense-in-depth, not a substitute for `.gitignore` and a real secrets
  scanner (`gitleaks`, `trufflehog`) in your CI.
- **No content review of skeletons.** A skeleton may contain symbol names,
  type names, or string literals that themselves carry sensitive meaning
  (e.g. an internal API endpoint name). Review skeletons before pasting into
  third-party tools.
