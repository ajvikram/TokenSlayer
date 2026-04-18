# TokenSlayer: Slashing the "Orientation Tax" with Semantic Structural Caching

**Abstract:** As Large Language Models (LLMs) become deeply integrated into developer workflows via tools like GitHub Copilot, the inefficiencies of context gathering have become a critical bottleneck. AI coding assistants currently read entire raw source files to understand architectural context, resulting in massive token consumption—a phenomenon we call the "Orientation Tax." **TokenSlayer** is a VS Code extension that solves this problem by intercepting LLM context requests and injecting AST-driven, compacted structural skeletons instead of raw text. This semantic caching approach achieves a **40-95% reduction in token usage** while preserving the architectural context necessary for the LLM to reason effectively about the codebase, all while ensuring local security and zero-latency access.

---

## 1. The Problem: The "Orientation Tax" and Context Bloat

Current AI coding assistants treat source code primarily as raw text blobs. When a developer asks an architectural question (e.g., "How does the authentication module connect to the database?"), the IDE packages entire files into the LLM context window. This leads to three critical inefficiencies:

1. **Token Waste:** Up to 80% of tokens are consumed during the "orientation phase." The LLM reads massive files—including method implementations, localized comments, and irrelevant logic—just to identify a single interface, function signature, or class hierarchy.
2. **Context Window Saturation:** With token limits and attention degradation in large context windows, providing 10,000 tokens of raw file data causes the AI to "forget" deep architectural relationships or dilute its focus.
3. **Redundant Computation:** Developers frequently ask repetitive questions within the same file or module, forcing the LLM to re-process identical boilerplate context, costing unnecessary tokens and latency every time.

---

## 2. The Solution: Semantic Structural Caching

The core objective of TokenSlayer is to move from brute-force text inclusion to a **locally-indexed, structural knowledge graph**. 

Instead of passing a 1,200-line file that costs ~5,000 tokens, TokenSlayer extracts an 8-line structural "skeleton" costing ~200 tokens. This skeleton contains exactly what the LLM needs to navigate the codebase: class hierarchies, function signatures, exported constants, and type definitions.

### 2.1 AST-Driven Extraction
TokenSlayer avoids heavy dependencies by leveraging the existing **Language Server Protocol (LSP)** built into VS Code. With a single, ultra-fast `executeDocumentSymbolProvider` call, TokenSlayer extracts the full hierarchical symbol tree of a file. This achieves 1-call-per-file overhead, remaining significantly faster than multi-pass Call Graph Extractors or Type Hierarchy parsing.

### 2.2 Domain-Aware Compaction
Because different languages express architecture differently, TokenSlayer applies domain-specific compaction strategies:
* **TypeScript/JavaScript:** Strips function bodies but preserves interfaces, types, and exported signatures.
* **Python:** Keeps signatures, type hints, decorators (`@dataclass`, `@staticmethod`), and first-line docstrings, while stripping implementations.
* **Java/Rust/Go:** Extracts class, struct, trait, and interface definitions, removing inner logic.

### 2.3 Zero-Latency Persistence
TokenSlayer features an advanced content-hash LRU cache. It uses file watchers and `sha256` content hashing to track changes. Furthermore, TokenSlayer implements **Workspace Pre-warming**, automatically scanning and caching all supported files in the background upon workspace activation. This means structural skeletons are instantly available the moment Copilot requests them.

---

## 3. Security First: The Secrets Detector

A major risk of automated context gathering is the accidental leakage of sensitive credentials to third-party LLM providers. If a developer accidentally leaves an API key in a source file, the AI assistant might read it as context.

TokenSlayer integrates a synchronous **SecretsDetector** directly into the extraction pipeline. It scans files for high-severity patterns:
* Private Keys (RSA, EC, SSH)
* API Tokens (AWS, GitHub, Stripe, Slack, etc.)
* Database Connection Strings

If a file triggers the detector, it is completely **blocked** from the cache and marked as Excluded. This ensures that sensitive content never reaches the LLM context window.

---

## 4. Deep IDE Integration

TokenSlayer is built natively into VS Code to intercept and manage LLM context effectively:

* **Language Model Tool API:** TokenSlayer registers as `tokenslayer-structural-summary`. This allows GitHub Copilot to autonomously choose to call TokenSlayer instead of reading raw files when it needs to understand codebase architecture.
* **Chat Participant (`@tokenslayer`):** Developers can explicitly invoke the tool in Copilot Chat (e.g., `@tokenslayer How is auth structured?`) to generate a structural map of the workspace or specific files, guaranteeing the token-saving path is used.
* **CodeLens & File Decorations:** Real-time visual indicators—such as inline `CodeLens` showing token reduction metrics above classes, and a `FileDecorationProvider` adding a ⚡ badge in the file explorer—keep developers informed of the tool's impact.

---

## 5. Performance Impact & Telemetry

TokenSlayer provides a rich, webview-based **Analytics Dashboard** directly in VS Code, powered by accurate BPE token counting (`cl100k_base` encoding via `gpt-tokenizer`). 

### Measured Benefits

| Metric | Standard Raw Context | TokenSlayer Skeletons | Improvement |
| :--- | :--- | :--- | :--- |
| **Token Usage** | High (e.g., 5,000+ per file) | Ultra-Low (e.g., 200 per slice) | **40-95% Token Reduction** |
| **Data Format** | Raw Text / Blobs | AST-Skeletons / Signatures | **Higher Signal-to-Noise** |
| **Latency** | Network-dependent processing | Instant (cached queries) | **Near-Zero Overhead** |
| **Security** | Opaque (blindly sent) | Guarded (Secrets Detection) | **Proactive Blocking** |

In large codebases, users routinely see reductions of **88-95%**, turning thousands of lines of code into a highly dense, LLM-optimized map.

---

## 6. Conclusion

As the developer ecosystem moves toward heavily utilizing LLMs, token efficiency and context relevance are paramount. TokenSlayer demonstrates that AI coding assistants do not need to read implementations to understand architecture. By slicing the "Orientation Tax" with AST-driven skeletons, TokenSlayer allows developers to interact with much larger codebases, retain more context, save API costs, and improve LLM reasoning capabilities—all while enhancing security.

Tokens are the new developer currency. TokenSlayer ensures you stop overpaying.
