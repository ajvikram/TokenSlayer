// ─── Context Rot Score + Model Recommendation types ──────────────────────────
// Mirrors src/types.ts in the VS Code extension (no vscode dependency).

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
  model: string;
  displayName: string;
  action: 'continue' | 'switch' | 'start_fresh';
  reason: string;
  estimatedCostPerTurn: number;
}

export interface SessionHealth {
  rotScore: number;
  severity: RotSeverity;
  signals: RotSignals;
  recommendation: ModelRecommendation;
  sessionId: string;
  turnCount: number;
  totalTokens: number;
  currentModel: string;
  updatedAt: number;
}
