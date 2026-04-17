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

export interface TokenSavings {
  totalOriginalTokens: number;
  totalCompactedTokens: number;
  totalSaved: number;
  reductionPercent: number;
  filesAnalyzed: number;
  cacheHits: number;
  cacheMisses: number;
}

// ─── LM Tool Input ─────────────────────────────────────────────────────────

export interface StructuralSummaryInput {
  filePath?: string;
  scope?: 'file' | 'directory' | 'workspace';
  verbosity?: 'minimal' | 'standard' | 'detailed';
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
