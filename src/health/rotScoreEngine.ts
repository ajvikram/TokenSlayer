import {
  RotSignals, RotSeverity, ModelRecommendation, SessionHealth, TaskComplexity,
  RotScorePoint, RotTrend, RotDriver,
} from '../types';
import { AnalysisResult, TurnRecord, computeRotSignals } from './contextRotAnalyzer';

/**
 * Converts raw RotSignals into a composite rot score (0–100), reconstructs the
 * per-turn trajectory, and emits a ModelRecommendation + remediation. Pure
 * functions — no I/O, easy to unit-test.
 *
 * Weighting rationale: the original model let turn-depth (a pure turn counter)
 * dominate at 30%, so a long-but-clean session scored the same as a rotted one.
 * Depth is now a milder baseline (20%); the genuine *degradation* signals —
 * redundant reads and per-turn token growth — carry the most weight (25% each).
 */

// ─── Scoring weights (sum = 1.00) ──────────────────────────────────────────

const WEIGHTS = {
  depth:      0.20, // session length — a baseline, not the dominant term
  redundancy: 0.25, // re-reading the same files (real degradation)
  growth:     0.25, // per-turn context ballooning (real degradation)
  looping:    0.15, // repeated/low-diversity tool use
  verbosity:  0.15, // output bloating relative to input
} as const;

/** Human labels + weights for the dashboard breakdown, in display order. */
export const SIGNAL_META: { key: keyof typeof WEIGHTS; field: keyof RotSignals; label: string }[] = [
  { key: 'depth',      field: 'depthScore',      label: 'Turn depth' },
  { key: 'redundancy', field: 'redundancyScore', label: 'Redundant reads' },
  { key: 'growth',     field: 'growthScore',     label: 'Token growth' },
  { key: 'looping',    field: 'loopingScore',    label: 'Tool looping' },
  { key: 'verbosity',  field: 'verbosityScore',  label: 'Output verbosity' },
];

// ─── Model catalogue ──────────────────────────────────────────────────────

interface ModelEntry {
  id: string;
  displayName: string;
  /** Blended cost per 1M tokens (input + output weighted 80/20). USD. */
  costPer1MTokens: number;
  /** Fallback tokens/turn when the session has no measured usage yet. */
  avgTokensPerTurn: number;
}

const MODELS: ModelEntry[] = [
  { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', costPer1MTokens: 0.80, avgTokensPerTurn: 8_000 },
  { id: 'claude-sonnet-4-6',         displayName: 'Claude Sonnet 4.6', costPer1MTokens: 3.00, avgTokensPerTurn: 12_000 },
  { id: 'claude-opus-4-8',           displayName: 'Claude Opus 4.8',   costPer1MTokens: 15.00, avgTokensPerTurn: 16_000 },
];

function modelById(id: string): ModelEntry {
  return MODELS.find(m => m.id === id) ?? MODELS[1]; // default Sonnet
}

/**
 * Cost of one turn on `model`, using THIS session's measured tokens/turn when
 * available (falling back to the model's typical figure for an empty session).
 * The old code always used the static figure, so the estimate was wrong by the
 * ratio of actual to assumed session size.
 */
function costPerTurn(model: ModelEntry, actualTokensPerTurn: number): number {
  const tokens = actualTokensPerTurn > 0 ? actualTokensPerTurn : model.avgTokensPerTurn;
  return (model.costPer1MTokens / 1_000_000) * tokens;
}

// ─── Score computation ────────────────────────────────────────────────────

export function computeRotScore(signals: RotSignals): number {
  return Math.round(
    signals.depthScore      * WEIGHTS.depth      +
    signals.redundancyScore * WEIGHTS.redundancy +
    signals.growthScore     * WEIGHTS.growth     +
    signals.loopingScore    * WEIGHTS.looping    +
    signals.verbosityScore  * WEIGHTS.verbosity
  );
}

export function scoreSeverity(score: number): RotSeverity {
  if (score >= 65) { return 'critical'; }
  if (score >= 35) { return 'amber'; }
  return 'healthy';
}

const AMBER_THRESHOLD = 35;

// ─── Trajectory ("getting dumber over time") ───────────────────────────────

/**
 * Reconstruct the rot score as-of each turn by replaying the signal computation
 * on growing prefixes of the transcript. Deterministic from the transcript
 * alone — no cross-poll state to persist or drift.
 */
export function computeHistory(turns: TurnRecord[]): RotScorePoint[] {
  const history: RotScorePoint[] = [];
  for (let k = 1; k <= turns.length; k++) {
    history.push({ turn: k, score: computeRotScore(computeRotSignals(turns.slice(0, k))) });
  }
  return history;
}

/** Rising/falling/stable over the last few turns (±5 pt dead-band). */
export function computeTrend(history: RotScorePoint[]): RotTrend {
  if (history.length < 2) { return 'stable'; }
  const current = history[history.length - 1].score;
  const lookback = history[Math.max(0, history.length - 4)].score;
  const delta = current - lookback;
  if (delta > 5) { return 'rising'; }
  if (delta < -5) { return 'falling'; }
  return 'stable';
}

function amberCrossedTurn(history: RotScorePoint[]): number | null {
  const hit = history.find(p => p.score >= AMBER_THRESHOLD);
  return hit ? hit.turn : null;
}

// ─── Remediation: dominant signal → concrete fix ───────────────────────────

const DRIVER_HINTS: Record<keyof typeof WEIGHTS, (s: RotSignals) => string> = {
  depth:      s => `Long session (${s.turnCount} turns). Run /compact or start a fresh session to reset context.`,
  redundancy: () => `Re-reading the same files. Use #tokenslayer-structural-summary to read structure once instead of re-reading whole files.`,
  growth:     () => `Context is ballooning each turn. /compact, or scope reads with TokenSlayer skeletons instead of full files.`,
  looping:    () => `The agent is repeating the same tools and may be stuck. Rephrase the task or start a fresh session.`,
  verbosity:  () => `Responses are growing long relative to input. Ask for terser output.`,
};

export function primaryDriver(signals: RotSignals): RotDriver {
  let best: { key: keyof typeof WEIGHTS; label: string; contribution: number } | null = null;
  for (const { key, field, label } of SIGNAL_META) {
    const contribution = (signals[field] as number) * WEIGHTS[key];
    if (!best || contribution > best.contribution) { best = { key, label, contribution }; }
  }
  const k = best!.key;
  return { signal: best!.label, hint: DRIVER_HINTS[k](signals) };
}

// ─── Model recommendation ─────────────────────────────────────────────────

export function recommendModel(
  rotScore: number,
  complexity: TaskComplexity,
  currentModelId: string,
  actualTokensPerTurn: number,
): ModelRecommendation {
  const haiku  = MODELS[0];
  const sonnet = MODELS[1];
  const opus   = MODELS[2];
  const rec = (m: ModelEntry, action: ModelRecommendation['action'], reason: string): ModelRecommendation => ({
    model: m.id,
    displayName: m.displayName,
    action: action === 'switch' && currentModelId === m.id ? 'continue' : action,
    reason,
    estimatedCostPerTurn: costPerTurn(m, actualTokensPerTurn),
  });

  // Severe rot — advise starting fresh regardless of model
  if (rotScore >= 70) {
    const current = modelById(currentModelId);
    return rec(current, 'start_fresh',
      `Context rot at ${rotScore}% — results are unreliable. Start a fresh session to restore quality.`);
  }
  // High rot + simple task → downgrade to Haiku
  if (rotScore >= 50 && complexity === 'simple') {
    return rec(haiku, 'switch',
      `High rot (${rotScore}%) + simple task — Haiku is ${Math.round(sonnet.costPer1MTokens / haiku.costPer1MTokens)}× cheaper and sufficient here.`);
  }
  // High rot + moderate/complex → stay on Sonnet (Opus won't fix rot)
  if (rotScore >= 50) {
    return rec(sonnet, 'switch',
      `High rot (${rotScore}%) — avoid Opus until context is clean. Sonnet is the right balance.`);
  }
  // Clean context + complex task → Opus is justified
  if (rotScore < 20 && complexity === 'complex') {
    return rec(opus, 'switch',
      `Clean context (${rotScore}% rot) + complex task — Opus reasoning justified here.`);
  }
  // Clean context + simple task → downgrade to Haiku
  if (rotScore < 20 && complexity === 'simple') {
    return rec(haiku, 'switch',
      `Simple task with clean context — Haiku handles this at ${Math.round(sonnet.costPer1MTokens / haiku.costPer1MTokens)}× lower cost.`);
  }
  // Default: Sonnet
  return rec(sonnet, 'switch', `Session is healthy (${rotScore}% rot) — Sonnet is the optimal default.`);
}

// ─── Main entry point ─────────────────────────────────────────────────────

export class RotScoreEngine {
  compute(result: AnalysisResult): SessionHealth {
    const rotScore = computeRotScore(result.signals);
    const severity = scoreSeverity(rotScore);
    const turnCount = result.signals.turnCount;
    const actualTokensPerTurn = turnCount > 0 ? result.totalTokens / turnCount : 0;
    const recommendation = recommendModel(rotScore, result.complexity, result.currentModel, actualTokensPerTurn);
    const history = computeHistory(result.turns);

    return {
      rotScore,
      severity,
      signals: result.signals,
      recommendation,
      history,
      trend: computeTrend(history),
      amberCrossedTurn: amberCrossedTurn(history),
      primaryDriver: primaryDriver(result.signals),
      sessionId: result.sessionFile,
      turnCount,
      totalTokens: result.totalTokens,
      currentModel: result.currentModel,
      updatedAt: Date.now(),
    };
  }
}
