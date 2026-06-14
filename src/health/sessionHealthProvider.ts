import * as vscode from 'vscode';
import { ContextRotAnalyzer } from './contextRotAnalyzer';
import { RotScoreEngine } from './rotScoreEngine';
import { SessionHealth, RotSeverity } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();
const POLL_INTERVAL_MS = 10_000;
const CRITICAL_THRESHOLD = 70;

/**
 * Manages the live session health loop:
 * - Polls the active Claude Code transcript every 10 s
 * - Updates a VS Code status bar item with the rot score + model recommendation
 * - Fires a one-shot warning notification when rot crosses the critical threshold
 * - Exposes the latest SessionHealth for the dashboard webview to consume
 */
export class SessionHealthProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private analyzer = new ContextRotAnalyzer();
  private engine   = new RotScoreEngine();
  private latestHealth: SessionHealth | null = null;
  private criticalNotified = false;

  /** Listeners registered by the dashboard webview. */
  private readonly changeEmitter = new vscode.EventEmitter<SessionHealth>();
  readonly onHealthChanged = this.changeEmitter.event;

  constructor(private readonly workspaceRoot: string) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      'tokenslayer.sessionHealth',
      vscode.StatusBarAlignment.Right,
      98, // just left of the language picker
    );
    this.statusBarItem.command = 'tokenslayer.showDashboard';
    this.statusBarItem.tooltip = 'TokenSlayer: Session Health — click to open dashboard';
  }

  /** Start polling. Call from extension.ts activate(). */
  start(): void {
    this.poll(); // immediate first run
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.statusBarItem.show();
  }

  getLatestHealth(): SessionHealth | null {
    return this.latestHealth;
  }

  dispose(): void {
    if (this.timer) { clearInterval(this.timer); }
    this.statusBarItem.dispose();
    this.changeEmitter.dispose();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private poll(): void {
    try {
      const result = this.analyzer.analyze(this.workspaceRoot);
      if (!result) {
        this.statusBarItem.hide();
        return;
      }

      const health = this.engine.compute(result);
      this.latestHealth = health;
      this.updateStatusBar(health);
      this.changeEmitter.fire(health);
      this.maybeNotifyCritical(health);
    } catch (err) {
      logger.error('SessionHealthProvider.poll failed', err);
    }
  }

  private updateStatusBar(health: SessionHealth): void {
    const { rotScore, severity, recommendation } = health;
    const icon  = severityIcon(severity);
    const model = shortModelName(recommendation.displayName);
    const action = recommendation.action === 'switch'
      ? ` → ${model}`
      : recommendation.action === 'start_fresh'
        ? ' → New session'
        : ` · ${model}`;

    const trendArrow = health.trend === 'rising' ? ' ▲' : health.trend === 'falling' ? ' ▼' : '';
    this.statusBarItem.text        = `${icon} Rot: ${rotScore}%${trendArrow}${action}`;
    this.statusBarItem.color       = severityColor(severity);
    this.statusBarItem.backgroundColor = severity === 'critical'
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    this.statusBarItem.show();
  }

  private maybeNotifyCritical(health: SessionHealth): void {
    if (this.criticalNotified) { return; }
    if (health.rotScore < CRITICAL_THRESHOLD) { return; }
    this.criticalNotified = true;

    vscode.window
      .showWarningMessage(
        `⚠️ TokenSlayer: Context rot score reached ${health.rotScore}%. ` +
        `Results may be unreliable — consider starting a fresh Claude Code session.`,
        'Open Dashboard',
        'Dismiss',
      )
      .then(choice => {
        if (choice === 'Open Dashboard') {
          vscode.commands.executeCommand('tokenslayer.showDashboard');
        }
      });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function severityIcon(s: RotSeverity): string {
  return s === 'critical' ? '🔴' : s === 'amber' ? '🟡' : '🟢';
}

function severityColor(s: RotSeverity): string | undefined {
  if (s === 'critical') { return '#ff6b6b'; }
  if (s === 'amber')    { return '#ffd93d'; }
  return undefined; // default theme colour for healthy
}

function shortModelName(displayName: string): string {
  // "Claude Sonnet 4.6" → "Sonnet"
  const m = displayName.match(/Claude\s+(\w+)/i);
  return m ? m[1] : displayName;
}

// ─── Dashboard HTML fragment ──────────────────────────────────────────────

/**
 * Returns an HTML string for the Session Health tab to be injected into
 * the dashboard webview. Called by dashboardProvider.ts.
 */
export function renderSessionHealthHtml(health: SessionHealth | null): string {
  if (!health) {
    return `<div class="health-empty">
      <p>No active Claude Code session detected.</p>
      <p class="muted">Start a session in this workspace to see live health metrics.</p>
    </div>`;
  }

  const { rotScore, severity, signals, recommendation, turnCount, totalTokens,
          currentModel, updatedAt, history, trend, amberCrossedTurn, primaryDriver } = health;
  const secsAgo = Math.round((Date.now() - updatedAt) / 1000);
  const severityLabel = severity === 'critical' ? 'CRITICAL' : severity === 'amber' ? 'AMBER' : 'HEALTHY';
  const barColor = severityHex(severity);

  // Display weights mirror WEIGHTS in rotScoreEngine (kept in sync intentionally).
  const signalRows = [
    { label: 'Turn depth',       score: signals.depthScore,       weight: 20 },
    { label: 'Redundant reads',  score: signals.redundancyScore,  weight: 25 },
    { label: 'Token growth',     score: signals.growthScore,      weight: 25 },
    { label: 'Tool looping',     score: signals.loopingScore,     weight: 15 },
    { label: 'Output verbosity', score: signals.verbosityScore,   weight: 15 },
  ].map(({ label, score, weight }) => {
    const contribution = Math.round(score * weight / 100);
    return `<tr>
      <td class="signal-label">${label}</td>
      <td class="signal-bar-cell">
        <div class="signal-bar-bg">
          <div class="signal-bar-fill" style="width:${score}%;background:${barColor}"></div>
        </div>
      </td>
      <td class="signal-score">${contribution}/${weight}</td>
    </tr>`;
  }).join('');

  const actionBadge = recommendation.action === 'start_fresh'
    ? '<span class="badge badge-critical">Start fresh session</span>'
    : recommendation.action === 'switch'
      ? '<span class="badge badge-warn">Switch model</span>'
      : '<span class="badge badge-ok">Continue</span>';

  const costStr = formatCostPerTurn(recommendation.estimatedCostPerTurn);
  const trendStr = formatTrend(trend, history);

  return `
<div class="session-health">

  <div class="health-score-block">
    <div class="health-score-label">Context Rot Score</div>
    <div class="health-bar-outer">
      <div class="health-bar-inner" style="width:${rotScore}%;background:${barColor}"></div>
    </div>
    <div class="health-score-value">
      <span class="score-num" style="color:${barColor}">${rotScore}</span>
      <span class="score-denom">/ 100</span>
      <span class="severity-badge severity-${severity}">${severityLabel}</span>
      <span class="health-trend trend-${trend}">${trendStr}</span>
    </div>
  </div>

  ${renderTrajectory(history, amberCrossedTurn, severity)}

  <div class="health-signals">
    <div class="section-title">Signal Breakdown</div>
    <table class="signal-table">
      <tbody>${signalRows}</tbody>
    </table>
  </div>

  <div class="health-driver">
    <div class="section-title">What's driving it</div>
    <div class="driver-card">
      <div class="driver-signal">${escapeHtml(primaryDriver.signal)}</div>
      <div class="driver-hint">${escapeHtml(primaryDriver.hint)}</div>
    </div>
  </div>

  <div class="health-recommendation">
    <div class="section-title">Model Recommendation</div>
    <div class="rec-card">
      <div class="rec-model">${recommendation.displayName} ${actionBadge}</div>
      <div class="rec-reason">${escapeHtml(recommendation.reason)}</div>
      <div class="rec-cost muted">${costStr}</div>
    </div>
  </div>

  <div class="health-meta muted">
    Session: ${turnCount} turn${turnCount !== 1 ? 's' : ''} ·
    ${formatTokens(totalTokens)} tokens ·
    Model: ${currentModel} ·
    Updated ${secsAgo}s ago
  </div>

</div>`;
}

// ─── Render helpers ─────────────────────────────────────────────────────────

function severityHex(s: RotSeverity): string {
  return s === 'critical' ? '#ff6b6b' : s === 'amber' ? '#ffd93d' : '#6bcb77';
}

/** USD/turn → "$0.12/turn" for cents-and-up, "0.64¢/turn" for sub-cent. */
function formatCostPerTurn(usd: number): string {
  if (usd >= 0.01) { return `~$${usd.toFixed(2)}/turn`; }
  return `~${(usd * 100).toFixed(2)}¢/turn`;
}

function formatTrend(trend: 'rising' | 'stable' | 'falling', history: { turn: number; score: number }[]): string {
  if (history.length < 2) { return ''; }
  const delta = history[history.length - 1].score - history[Math.max(0, history.length - 4)].score;
  const sign = delta > 0 ? '+' : '';
  if (trend === 'rising')  { return `▲ rising (${sign}${delta} pts)`; }
  if (trend === 'falling') { return `▼ improving (${sign}${delta} pts)`; }
  return '◆ stable';
}

/**
 * Inline-SVG sparkline of the score-per-turn trajectory — the "getting dumber
 * over time" view. Marks the turn where the score first crossed into amber.
 */
function renderTrajectory(
  history: { turn: number; score: number }[],
  amberCrossedTurn: number | null,
  severity: RotSeverity,
): string {
  if (history.length < 2) { return ''; }
  const W = 280, H = 48, pad = 4;
  const n = history.length;
  const x = (i: number) => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = (score: number) => pad + (1 - score / 100) * (H - 2 * pad);
  const pts = history.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const color = severityHex(severity);

  let amberMark = '';
  if (amberCrossedTurn !== null) {
    const idx = history.findIndex(p => p.turn === amberCrossedTurn);
    if (idx >= 0) {
      amberMark = `<circle cx="${x(idx).toFixed(1)}" cy="${y(history[idx].score).toFixed(1)}" r="3" fill="#ffd93d" />`;
    }
  }
  const amberCaption = amberCrossedTurn !== null
    ? `<span class="muted">crossed amber at turn ${amberCrossedTurn}</span>`
    : `<span class="muted">healthy across all ${n} turns</span>`;

  return `
  <div class="health-trajectory">
    <div class="section-title">Trajectory</div>
    <svg viewBox="0 0 ${W} ${H}" class="trajectory-svg" preserveAspectRatio="none">
      <line x1="${pad}" y1="${y(35).toFixed(1)}" x2="${W - pad}" y2="${y(35).toFixed(1)}"
            stroke="#ffd93d" stroke-width="0.5" stroke-dasharray="3 3" opacity="0.5" />
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" />
      ${amberMark}
    </svg>
    <div class="trajectory-caption">${amberCaption}</div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000)     { return `${(n / 1_000).toFixed(1)}k`; }
  return String(n);
}
