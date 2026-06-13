// ─── Weights ─────────────────────────────────────────────────────────────────
const WEIGHTS = {
    depth: 0.30,
    redundancy: 0.25,
    growth: 0.20,
    entropy: 0.15,
    verbosity: 0.10,
};
const MODELS = [
    { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', costPer1MTokens: 0.80, avgTokensPerTurn: 8_000 },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', costPer1MTokens: 3.00, avgTokensPerTurn: 12_000 },
    { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', costPer1MTokens: 15.00, avgTokensPerTurn: 16_000 },
];
function modelById(id) {
    return MODELS.find(m => m.id === id) ?? MODELS[1];
}
function costPerTurn(model) {
    return (model.costPer1MTokens / 1_000_000) * model.avgTokensPerTurn;
}
// ─── Scoring ──────────────────────────────────────────────────────────────────
export function computeRotScore(signals) {
    return Math.round(signals.depthScore * WEIGHTS.depth +
        signals.redundancyScore * WEIGHTS.redundancy +
        signals.growthScore * WEIGHTS.growth +
        signals.entropyScore * WEIGHTS.entropy +
        signals.verbosityScore * WEIGHTS.verbosity);
}
export function scoreSeverity(score) {
    if (score >= 65) {
        return 'critical';
    }
    if (score >= 35) {
        return 'amber';
    }
    return 'healthy';
}
// ─── Recommendation ───────────────────────────────────────────────────────────
export function recommendModel(rotScore, complexity, currentModelId) {
    const haiku = MODELS[0];
    const sonnet = MODELS[1];
    const opus = MODELS[2];
    if (rotScore >= 70) {
        const current = modelById(currentModelId);
        return { model: current.id, displayName: current.displayName, action: 'start_fresh',
            reason: `Context rot at ${rotScore}% — results are unreliable. Start a fresh session.`,
            estimatedCostPerTurn: costPerTurn(current) };
    }
    if (rotScore >= 50 && complexity === 'simple') {
        return { model: haiku.id, displayName: haiku.displayName,
            action: currentModelId === haiku.id ? 'continue' : 'switch',
            reason: `High rot (${rotScore}%) + simple task — Haiku costs ${Math.round(sonnet.costPer1MTokens / haiku.costPer1MTokens)}× less and handles this.`,
            estimatedCostPerTurn: costPerTurn(haiku) };
    }
    if (rotScore >= 50) {
        return { model: sonnet.id, displayName: sonnet.displayName,
            action: currentModelId === sonnet.id ? 'continue' : 'switch',
            reason: `High rot (${rotScore}%) — stay on Sonnet, avoid Opus until context is clean.`,
            estimatedCostPerTurn: costPerTurn(sonnet) };
    }
    if (rotScore < 20 && complexity === 'complex') {
        return { model: opus.id, displayName: opus.displayName,
            action: currentModelId === opus.id ? 'continue' : 'switch',
            reason: `Clean context (${rotScore}% rot) + complex task — Opus reasoning justified.`,
            estimatedCostPerTurn: costPerTurn(opus) };
    }
    if (rotScore < 20 && complexity === 'simple') {
        return { model: haiku.id, displayName: haiku.displayName,
            action: currentModelId === haiku.id ? 'continue' : 'switch',
            reason: `Simple task + clean context — Haiku at ${Math.round(sonnet.costPer1MTokens / haiku.costPer1MTokens)}× lower cost.`,
            estimatedCostPerTurn: costPerTurn(haiku) };
    }
    return { model: sonnet.id, displayName: sonnet.displayName,
        action: currentModelId === sonnet.id ? 'continue' : 'switch',
        reason: `Session healthy (${rotScore}% rot) — Sonnet is the optimal default.`,
        estimatedCostPerTurn: costPerTurn(sonnet) };
}
// ─── Main ─────────────────────────────────────────────────────────────────────
export class RotScoreEngine {
    compute(result) {
        const rotScore = computeRotScore(result.signals);
        const severity = scoreSeverity(rotScore);
        const recommendation = recommendModel(rotScore, result.complexity, result.currentModel);
        return {
            rotScore, severity, signals: result.signals, recommendation,
            sessionId: result.sessionFile, turnCount: result.signals.turnCount,
            totalTokens: result.totalTokens, currentModel: result.currentModel,
            updatedAt: Date.now(),
        };
    }
}
