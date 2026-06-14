import * as vscode from 'vscode';

// ─── Structural Symbol ──────────────────────────────────────────────────────

export interface StructuralSymbol {
  name: string;
  kind: vscode.SymbolKind;
  kindLabel: string;
  detail: string;
  range: {
    startLine: number;
    endLine: number;
  };
  signatureLine: string;
  children: StructuralSymbol[];
}

// ─── Compaction ─────────────────────────────────────────────────────────────

export interface CompactedResult {
  skeleton: string;
  originalTokens: number;
  compactedTokens: number;
  reductionPercent: number;
  fileUri: string;
  languageId: string;
  symbolCount: number;
  timestamp: number;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

export interface CacheEntry {
  key: string;
  fileUri: string;
  contentHash: string;
  result: CompactedResult;
  createdAt: number;
  lastAccessedAt: number;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  storageSizeBytes: number;
}

// ─── Token Savings ──────────────────────────────────────────────────────────

export interface CostEstimate {
  gpt4o: number;
  claudeSonnet: number;
  label: string;
}

export interface TokenSavings {
  totalOriginalTokens: number;
  totalCompactedTokens: number;
  totalSaved: number;
  reductionPercent: number;
  avgSavedPerFile: number;
  estimatedCost: CostEstimate;
  filesAnalyzed: number;
  cacheHits: number;
  cacheMisses: number;
}

// ─── LM Tool Input ─────────────────────────────────────────────────────────

export interface StructuralSummaryInput {
  filePath?: string;
  scope?: 'file' | 'directory' | 'workspace' | 'dependency-chain';
  verbosity?: 'minimal' | 'standard' | 'detailed';
  targetModel?: string;
}

// ─── Verbosity ──────────────────────────────────────────────────────────────

export type Verbosity = 'minimal' | 'standard' | 'detailed';

// ─── Dashboard Messages ────────────────────────────────────────────────────

export interface DashboardMessage {
  type: 'update-stats' | 'update-recent' | 'refresh';
  payload?: TokenSavings | RecentAnalysis[];
}

export interface RecentAnalysis {
  fileName: string;
  filePath: string;
  originalTokens: number;
  compactedTokens: number;
  reductionPercent: number;
  timestamp: number;
}

// ─── Excluded Files (Secrets Protection) ────────────────────────────────

export interface ExcludedFile {
  fileName: string;
  filePath: string;
  reasons: string[];
  severity: 'low' | 'medium' | 'high';
  timestamp: number;
}

// ─── Context Rot Score + Model Recommendation ───────────────────────────────

export interface RotSignals {
  turnCount: number;
  depthScore: number;       // 0–100
  redundancyScore: number;  // 0–100
  growthScore: number;      // 0–100
  loopingScore: number;     // 0–100 — repeated/low-diversity tool use (was "entropy")
  verbosityScore: number;   // 0–100
}

export type TaskComplexity = 'simple' | 'moderate' | 'complex';
export type RotSeverity = 'healthy' | 'amber' | 'critical';

export interface ModelRecommendation {
  model: string;               // e.g. "claude-sonnet-4-6"
  displayName: string;         // e.g. "Claude Sonnet 4.6"
  action: 'continue' | 'switch' | 'start_fresh';
  reason: string;
  estimatedCostPerTurn: number; // USD — based on this session's measured tokens/turn
}

/** One point on the rot-score trajectory, computed as-of turn N. */
export interface RotScorePoint {
  turn: number;
  score: number;
}

export type RotTrend = 'rising' | 'stable' | 'falling';

/** The signal contributing most to the current score, plus a concrete fix. */
export interface RotDriver {
  signal: string;   // human label, e.g. "Redundant reads"
  hint: string;     // specific remediation
}

export interface SessionHealth {
  rotScore: number;            // 0–100 composite
  severity: RotSeverity;
  signals: RotSignals;
  recommendation: ModelRecommendation;
  /** Score as-of each turn, reconstructed from the transcript (oldest→newest). */
  history: RotScorePoint[];
  trend: RotTrend;
  /** First turn whose score crossed into amber (>=35), or null if never. */
  amberCrossedTurn: number | null;
  /** Dominant weighted signal driving the score + how to fix it. */
  primaryDriver: RotDriver;
  sessionId: string;           // transcript filename stem
  turnCount: number;
  totalTokens: number;
  currentModel: string;
  updatedAt: number;           // epoch ms
}

// ─── Symbol Kind Helpers ────────────────────────────────────────────────────

export function symbolKindToLabel(kind: vscode.SymbolKind): string {
  const labels: Record<number, string> = {
    [vscode.SymbolKind.File]: 'file',
    [vscode.SymbolKind.Module]: 'module',
    [vscode.SymbolKind.Namespace]: 'namespace',
    [vscode.SymbolKind.Package]: 'package',
    [vscode.SymbolKind.Class]: 'class',
    [vscode.SymbolKind.Method]: 'method',
    [vscode.SymbolKind.Property]: 'property',
    [vscode.SymbolKind.Field]: 'field',
    [vscode.SymbolKind.Constructor]: 'constructor',
    [vscode.SymbolKind.Enum]: 'enum',
    [vscode.SymbolKind.Interface]: 'interface',
    [vscode.SymbolKind.Function]: 'function',
    [vscode.SymbolKind.Variable]: 'variable',
    [vscode.SymbolKind.Constant]: 'constant',
    [vscode.SymbolKind.String]: 'string',
    [vscode.SymbolKind.Number]: 'number',
    [vscode.SymbolKind.Boolean]: 'boolean',
    [vscode.SymbolKind.Array]: 'array',
    [vscode.SymbolKind.Object]: 'object',
    [vscode.SymbolKind.Key]: 'key',
    [vscode.SymbolKind.Null]: 'null',
    [vscode.SymbolKind.EnumMember]: 'enum-member',
    [vscode.SymbolKind.Struct]: 'struct',
    [vscode.SymbolKind.Event]: 'event',
    [vscode.SymbolKind.Operator]: 'operator',
    [vscode.SymbolKind.TypeParameter]: 'type-parameter',
  };
  return labels[kind] || 'unknown';
}
