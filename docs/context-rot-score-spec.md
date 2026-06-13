# Context Rot Score + Model Recommendation — Feature Spec

**Status:** Draft  
**Target:** TokenSlayer v0.5.0  
**Author:** Ajay Vikram  

---

## 1. Problem

AI coding agent sessions degrade silently. A 2026 study across 4,416 trials showed agent constraint compliance drops from **73% at turn 5 to 33% at turn 16** — without the developer knowing anything changed. 65% of agent failures trace back to context drift, not model capability.

Today there is no signal anywhere telling you:
- How healthy your current session is
- When to start fresh
- Which model to use for the next prompt

TokenSlayer already reads Claude Code session transcripts (`llmUsageTracker.ts`). This feature adds a **real-time session health layer** on top: a rot score that tracks degradation as it happens, plus a model recommendation that turns the warning into an action.

---

## 2. Scope

Two tightly coupled capabilities shipped together:

| Capability | What it does |
|---|---|
| **Context Rot Score** | 0–100 score reflecting how degraded the current session's context is. Updated live as the session progresses. |
| **Model Recommendation** | Based on rot score + task complexity signals + current cost pace, recommends the optimal model for the next prompt with a reason and estimated cost saving. |

---

## 3. Data Sources

All signals come from data TokenSlayer already has access to — no new APIs required.

| Source | What we read | Already in TokenSlayer? |
|---|---|---|
| Claude Code session transcript (`~/.claude/projects/<slug>/*.jsonl`) | Turn count, token usage per turn, model used, tool calls, timestamps | ✅ `llmUsageTracker.ts` |
| Active session detection | Most-recently-modified `.jsonl` file = active session | New (trivial) |
| Tool call patterns | Which tools were called per turn (Read, Bash, etc.) | Parse from transcript |
| Copilot chat sessions | Request count, model | ✅ `copilotUsageTracker.ts` |
| SpendBench results | Ground-truth model performance by task type | Reference data (hardcoded v1) |

---

## 4. Rot Signals

Six signals, each scored 0–100. The composite rot score is a weighted sum.

### 4.1 Turn Depth (`depth`)
Turn count in the current session. Compliance degrades sharply after turn 10.

```
score = min(100, turn_count * 6)
```

Weight: **30%** (strongest single predictor from research data)

### 4.2 Redundant File Reads (`redundancy`)
Ratio of repeated file reads to total reads. An agent re-reading the same file it already read is the clearest sign of context confusion.

```
score = (repeated_reads / total_reads) * 100
```

Weight: **25%**

### 4.3 Token Growth Rate (`growth`)
Token-per-turn growth acceleration. A healthy session plateaus; a rotting one grows as the agent adds more and more noise.

```
rate = tokens_last_3_turns / tokens_first_3_turns
score = min(100, (rate - 1.0) * 50)   // 3× growth = 100
```

Weight: **20%**

### 4.4 Tool Call Entropy (`entropy`)
Low diversity of tool calls signals a loop. A healthy session uses varied tools; a stuck agent keeps calling the same one.

```
unique_tools = count of distinct tools called
total_calls = total tool invocations
score = max(0, 100 - (unique_tools / total_calls) * 100)
```

Weight: **15%**

### 4.5 Output-to-Input Ratio (`verbosity`)
Rising output token ratio signals the model is overexplaining — a known symptom of context rot where the model loses track of what was already said.

```
score = min(100, (output_tokens / input_tokens) * 50)
```

Weight: **10%**

### 4.6 Composite Score

```
rot_score = round(
  depth      * 0.30 +
  redundancy * 0.25 +
  growth     * 0.20 +
  entropy    * 0.15 +
  verbosity  * 0.10
)
```

---

## 5. Model Recommendation

### 5.1 Model Roster (v1)

| Model | ID | Approx input cost/1M | Best for |
|---|---|---|---|
| Claude Haiku 4.5 | `claude-haiku-4-5` | $0.80 | Simple orientation, grep-style tasks, high rot sessions |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3.00 | General coding, moderate complexity |
| Claude Opus 4.8 | `claude-opus-4-8` | $15.00 | Complex multi-file refactor, architecture, low-rot fresh sessions |

### 5.2 Recommendation Logic

```
function recommend(rotScore, taskComplexity, currentModel):

  if rotScore >= 70:
    return { action: "start_fresh", model: currentModel,
             reason: "Context too degraded — start a new session for reliable results" }

  if rotScore >= 50:
    if taskComplexity == "simple":
      return { model: "haiku", reason: "High rot + simple task — Haiku costs 4× less and handles this" }
    else:
      return { model: "sonnet", reason: "High rot — stay on Sonnet, avoid Opus until context is clean" }

  if rotScore < 20 and taskComplexity == "complex":
    return { model: "opus", reason: "Clean context + complex task — Opus justified here" }

  return { model: "sonnet", reason: "Healthy session, Sonnet is optimal" }
```

### 5.3 Task Complexity Detection (v1 heuristics)

Simple signals (any → `simple`):
- Last user message < 50 tokens
- Tool calls in last turn: only `Bash` with short command
- Keywords: "where is", "what is", "find", "show me", "grep"

Complex signals (any → `complex`):
- Tool calls span > 3 different files
- Output tokens in last turn > 800
- Keywords: "refactor", "redesign", "implement", "architecture", "migrate"

Default: `moderate` → Sonnet

---

## 6. UI Integration

### 6.1 Status Bar Item (always visible)

```
⚡ Rot: 42%  →  Sonnet ✓
```

- Color: green (0–30), amber (31–60), red (61–100)
- Click → opens Session Health panel in sidebar
- Updates every 10 seconds

### 6.2 Session Health Panel (new dashboard tab)

New **"Session Health"** tab in the TokenSlayer sidebar alongside the existing Overview and Monthly tabs.

```
┌─────────────────────────────────────┐
│  SESSION HEALTH                     │
│                                     │
│  Context Rot Score                  │
│  ████████░░░░░░░░  42 / 100  AMBER  │
│                                     │
│  Signal Breakdown                   │
│  Turn depth      ████░░  18/30      │
│  Redundant reads ███░░░  12/25      │
│  Token growth    ████░░  10/20      │
│  Tool entropy    ░░░░░░   2/15      │
│  Verbosity       ██░░░░   0/10      │
│                                     │
│  Model Recommendation               │
│  ┌─────────────────────────────┐    │
│  │  ✓  Claude Sonnet 4.6       │    │
│  │  Healthy session, Sonnet    │    │
│  │  is optimal for this task.  │    │
│  │  Est. cost: ~$0.03/turn     │    │
│  └─────────────────────────────┘    │
│                                     │
│  Session: 7 turns · 43,211 tokens   │
│  Model in use: claude-sonnet-4-6    │
│  Updated 3s ago                     │
└─────────────────────────────────────┘
```

### 6.3 Inline Warning (rot score ≥ 70)

A VS Code information message fires once per session when rot crosses 70:

```
⚠️ TokenSlayer: Context rot score reached 71%. Consider starting a fresh 
Claude Code session for reliable results.  [Start Fresh]  [Dismiss]
```

---

## 7. New Types (`types.ts`)

```typescript
export interface RotSignals {
  turnCount: number;
  depthScore: number;       // 0–100
  redundancyScore: number;  // 0–100
  growthScore: number;      // 0–100
  entropyScore: number;     // 0–100
  verbosityScore: number;   // 0–100
}

export type TaskComplexity = 'simple' | 'moderate' | 'complex';
export type RotSeverity = 'healthy' | 'amber' | 'critical';

export interface ModelRecommendation {
  model: string;          // e.g. "claude-sonnet-4-6"
  displayName: string;    // e.g. "Claude Sonnet 4.6"
  action: 'continue' | 'switch' | 'start_fresh';
  reason: string;
  estimatedCostPerTurn: number; // USD
}

export interface SessionHealth {
  rotScore: number;         // 0–100 composite
  severity: RotSeverity;
  signals: RotSignals;
  recommendation: ModelRecommendation;
  sessionId: string;        // transcript filename stem
  turnCount: number;
  totalTokens: number;
  currentModel: string;
  updatedAt: number;        // epoch ms
}
```

---

## 8. New Files

```
src/health/
  contextRotAnalyzer.ts   # reads active transcript, computes RotSignals
  rotScoreEngine.ts       # RotSignals → rotScore + ModelRecommendation
  sessionHealthProvider.ts # VS Code status bar + polling + notification
```

---

## 9. Build Phases

### Phase 1 — Core engine (no UI) ✅ target: done first
- `contextRotAnalyzer.ts` — parse active session, emit `RotSignals`
- `rotScoreEngine.ts` — `RotSignals` → `SessionHealth`
- Unit tests for score computation

### Phase 2 — Status bar
- `sessionHealthProvider.ts` — 10s poll, status bar item, color coding
- One-shot warning notification at rot ≥ 70

### Phase 3 — Dashboard tab
- New "Session Health" tab in `dashboardProvider.ts`
- Signal breakdown bars, recommendation card, session stats

### Phase 4 — Model cost data
- Hardcode model pricing table (updated with each TokenSlayer release)
- Estimate cost/turn from recent session token averages

---

## 10. Out of Scope (v1)

- ML-based complexity classification (v1 uses keyword heuristics)
- Copilot session rot (no transcript access)
- Multi-session history / rot trends over time
- Auto-switching models (recommendation only, no action taken)
- Cursor / Windsurf support (Claude Code transcripts only for v1)
