import { RotSignals, RotSeverity, ModelRecommendation, SessionHealth, TaskComplexity } from '../types';
import { AnalysisResult } from './contextRotAnalyzer';

/**
 * Converts raw RotSignals into a composite rot score (0–100) and emits a
 * ModelRecommendation. Pure functions — no I/O, easy to unit-test.
 *
 * Weights are calibrated against the 2026 constraint-compliance study:
 * turn depth dominates (30%), redundant reads second (25%), token growth
 * rate third (20%), tool entropy fourth (15%), verbosity last (10%).
 */

// ─── Scoring weights ──────────────────────────────────────────────────────

const WEIGHTS = {
  depth:      0.30,
  redundancy: 0.25,
  growth:     0.20,
  entropy:    0.15,
  verbosity:  0.10,
} as const;

// ─── Model catalogue ──────────────────────────────────────────────────────

interface ModelEntry {
  id: string;
  displayName: string;
  /** Blended cost per 1M tokens (input + output weighted 80/20). USD. */
  costPer1MTokens: number;
  /** Typical tokens per turn for a coding session. Used to estimate $/turn. */
  avgTokensPerTurn: number;
}

const MODELS: ModelEntry[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    costPer1MTokens: 0.80,
    avgTokensPerTurn: 8_000,
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    costPer1MTokens: 3.00,
    avgTokensPerTurn: 12_000,
  },
  {
    id: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    costPer1MTokens: 15.00,
    avgTokensPerTurn: 16_000,
  },
];

function modelById(id: string): ModelEntry {
  return MODELS.find(m => m.id === id) ?? MODELS[1]; // default Sonnet
}

function costPerTurn(model: ModelEntry): number {
  return (model.costPer1MTokens / 1_000_000) * model.avgTokensPerTurn;
}

// ─── Score computation ────────────────────────────────────────────────────

export function computeRotScore(signals: RotSignals): number {
  return Math.round(
    signals.depthScore      * WEIGHTS.depth      +
    signals.redundancyScore * WEIGHTS.redundancy  +
    signals.growthScore     * WEIGHTS.growth      +
    signals.entropyScore    * WEIGHTS.entropy     +
    signals.verbosityScore  * WEIGHTS.verbosity
  );
}

export function scoreSeverity(score: number): RotSeverity {
  if (score >= 65) { return 'critical'; }
  if (score >= 35) { return 'amber'; }
  return 'healthy';
}

// ─── Model recommendation ─────────────────────────────────────────────────

export function recommendModel(
  rotScore: number,
  complexity: TaskComplexity,
  currentModelId: string,
): ModelRecommendation {
  const haiku  = MODELS[0];
  const sonnet = MODELS[1];
  const opus   = MODELS[2];

  // Severe rot — advise starting fresh regardless of model
  if (rotScore >= 70) {
    const current = modelById(currentModelId);
    return {
      model: current.id,
      displayName: current.displayName,
      action: 'start_fresh',
      reason: `Context rot at ${rotScore}% — results are unreliable. Start a fresh session to restore quality.`,
      estimatedCostPerTurn: costPerTurn(current),
    };
  }

  // High rot + simple task → downgrade to Haiku
  if (rotScore >= 50 && complexity === 'simple') {
    return {
      model: haiku.id,
      displayName: haiku.displayName,
      action: currentModelId === haiku.id ? 'continue' : 'switch',
      reason: `High rot (${rotScore}%) + simple task — Haiku is ${Math.round(sonnet.costPer1MTokens / haiku.costPer1MTokens)}× cheaper and sufficient here.`,
      estimatedCostPerTurn: costPerTurn(haiku),
    };
  }

  // High rot + moderate/complex → stay on Sonnet (Opus won't help with rot)
  if (rotScore >= 50) {
    return {
      model: sonnet.id,
      displayName: sonnet.displayName,
      action: currentModelId === sonnet.id ? 'continue' : 'switch',
      reason: `High rot (${rotScore}%) — avoid Opus until context is clean. Sonnet is the right balance.`,
      estimatedCostPerTurn: costPerTurn(sonnet),
    };
  }

  // Clean context + complex task → Opus is justified
  if (rotScore < 20 && complexity === 'complex') {
    return {
      model: opus.id,
      displayName: opus.displayName,
      action: currentModelId === opus.id ? 'continue' : 'switch',
      reason: `Clean context (${rotScore}% rot) + complex task — Opus reasoning justified here.`,
      estimatedCostPerTurn: costPerTurn(opus),
    };
  }

  // Clean context + simple task → downgrade to Haiku
  if (rotScore < 20 && complexity === 'simple') {
    return {
      model: haiku.id,
      displayName: haiku.displayName,
      action: currentModelId === haiku.id ? 'continue' : 'switch',
      reason: `Simple task with clean context — Haiku handles this at ${Math.round(sonnet.costPer1MTokens / haiku.costPer1MTokens)}× lower cost.`,
      estimatedCostPerTurn: costPerTurn(haiku),
    };
  }

  // Default: Sonnet
  return {
    model: sonnet.id,
    displayName: sonnet.displayName,
    action: currentModelId === sonnet.id ? 'continue' : 'switch',
    reason: `Session is healthy (${rotScore}% rot) — Sonnet is the optimal default.`,
    estimatedCostPerTurn: costPerTurn(sonnet),
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────

export class RotScoreEngine {
  compute(result: AnalysisResult): SessionHealth {
    const rotScore = computeRotScore(result.signals);
    const severity = scoreSeverity(rotScore);
    const recommendation = recommendModel(
      rotScore,
      result.complexity,
      result.currentModel,
    );

    return {
      rotScore,
      severity,
      signals: result.signals,
      recommendation,
      sessionId: result.sessionFile,
      turnCount: result.signals.turnCount,
      totalTokens: result.totalTokens,
      currentModel: result.currentModel,
      updatedAt: Date.now(),
    };
  }
}
