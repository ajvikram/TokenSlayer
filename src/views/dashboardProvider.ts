import * as vscode from 'vscode';
import { CacheManager } from '../cache/cacheManager';
import { LlmUsageTracker } from '../usage/llmUsageTracker';
import { ToolInvocationTracker } from '../usage/toolInvocationTracker';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Webview View Provider for the TokenSlayer sidebar dashboard.
 * Shows real-time token savings, cache stats, language breakdown,
 * top savers, workspace coverage, timeline, and excluded files.
 */
export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'tokenslayer.dashboardView';
  private view?: vscode.WebviewView;
  private llmUsageTracker = new LlmUsageTracker();

  constructor(
    private extensionUri: vscode.Uri,
    private cacheManager: CacheManager,
    private toolTracker?: ToolInvocationTracker
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case 'refresh':
            this.updateDashboard();
            break;
          case 'clearCache':
            this.cacheManager.clear();
            this.updateDashboard();
            vscode.window.showInformationMessage('TokenSlayer: Cache cleared');
            break;
          case 'openFile':
            if (message.filePath) {
              vscode.window.showTextDocument(vscode.Uri.file(message.filePath));
            }
            break;
          case 'exportReport':
            vscode.commands.executeCommand('tokenslayer.exportReport');
            break;
        }
      }
    );

    // Initial data push
    this.updateDashboard();

    // Auto-refresh every 5 seconds
    const autoRefreshInterval = setInterval(() => {
      this.updateDashboard();
    }, 5000);

    // Clean up interval when view is disposed
    webviewView.onDidDispose(() => {
      clearInterval(autoRefreshInterval);
    });
  }

  /**
   * Push updated stats to the webview.
   */
  public updateDashboard(): void {
    if (!this.view) { return; }

    const savings = this.cacheManager.getSavings();
    const cacheStats = this.cacheManager.getStats();
    const recentAnalyses = this.cacheManager.getRecentAnalyses();
    const excludedFiles = this.cacheManager.getExcludedFiles();
    const excludedCount = this.cacheManager.getExcludedCount();
    const languageStats = this.cacheManager.getLanguageStats();
    const topSavers = this.cacheManager.getTopSavers(5);
    const timeline = this.cacheManager.getTimeline(30);
    const analyzedFileCount = this.cacheManager.getAnalyzedFileCount();

    // Real LLM usage for this workspace, read from Claude Code transcripts.
    let llmUsage = null;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      try {
        llmUsage = this.llmUsageTracker.getUsage(workspaceRoot);
      } catch (err) {
        logger.warn('Failed to read LLM usage from transcripts', err);
      }
    }

    this.view.webview.postMessage({
      type: 'update',
      savings,
      cacheStats,
      recentAnalyses,
      excludedFiles,
      excludedCount,
      languageStats,
      topSavers,
      timeline,
      analyzedFileCount,
      llmUsage,
      toolInvocations: this.toolTracker?.get() ?? {},
    });
  }

  /**
   * Generate the dashboard HTML.
   */
  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'dashboard.css')
    );

    const nonce = this.getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>TokenSlayer Dashboard</title>
</head>
<body>
  <div class="dashboard">
    <!-- Hero Stats -->
    <div class="hero">
      <div class="hero-icon">⚡</div>
      <div class="hero-number" id="tokensSaved">0</div>
      <div class="hero-label">tokens saved</div>
    </div>

    <!-- Quick Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value" id="reductionPercent">0%</div>
        <div class="stat-label">Reduction</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="filesAnalyzed">0</div>
        <div class="stat-label">Files</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="cacheHitRate">0%</div>
        <div class="stat-label">Cache Hit</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="cacheEntries">0</div>
        <div class="stat-label">Cached</div>
      </div>
    </div>

    <!-- Extended Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value" id="totalTokensProcessed">0</div>
        <div class="stat-label">Tokens Processed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value cost-value" id="estCostSaved"><$0.01</div>
        <div class="stat-label">Est. Cost Saved</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="avgSavedPerFile">0</div>
        <div class="stat-label">Avg Saved/File</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="totalAnalyses">0</div>
        <div class="stat-label">Analyses</div>
      </div>
    </div>

    <!-- Copilot tool take-up (our own LM tool invocations, this workspace) -->
    <div class="section">
      <div class="section-title">
        <span>🔧 Copilot Tool Take-up</span>
        <span class="excluded-count" id="toolTakeupTotal">0 calls</span>
      </div>
      <div id="toolTakeupChart" class="lang-chart"></div>
    </div>

    <!-- LLM Usage (from Claude Code transcripts) -->
    <div class="section">
      <div class="section-title">
        <span>🤖 LLM Tokens Used</span>
        <span class="excluded-count" id="llmSessionCount">0 sessions</span>
      </div>
      <div id="llmUsageBody" style="display:none">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value" id="llmInput">0</div>
            <div class="stat-label">Input</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="llmOutput">0</div>
            <div class="stat-label">Output</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="llmCacheRead">0</div>
            <div class="stat-label">Cache Read</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="llmCacheWrite">0</div>
            <div class="stat-label">Cache Write</div>
          </div>
        </div>
        <div class="savings-bar-labels">
          <span id="llmTotal">0 total</span>
          <span id="llmLastActivity"></span>
        </div>
        <div class="lang-chart" id="llmModelChart"></div>
      </div>
      <div class="empty-state-small" id="llmEmpty">No Claude Code activity recorded for this workspace yet</div>
    </div>

    <!-- Workspace Coverage Ring -->
    <div class="section">
      <div class="section-title">Workspace Coverage</div>
      <div class="coverage-container">
        <div class="coverage-ring-wrapper">
          <svg class="coverage-ring" viewBox="0 0 100 100">
            <circle class="ring-bg" cx="50" cy="50" r="42" />
            <circle class="ring-fill" id="coverageRing" cx="50" cy="50" r="42"
              stroke-dasharray="263.9" stroke-dashoffset="263.9" />
          </svg>
          <div class="coverage-center">
            <div class="coverage-percent" id="coveragePercent">0%</div>
            <div class="coverage-sub">analyzed</div>
          </div>
        </div>
        <div class="coverage-details">
          <div class="coverage-stat"><span class="dot dot-green"></span><span id="analyzedCount">0</span> analyzed</div>
          <div class="coverage-stat"><span class="dot dot-red"></span><span id="excludedCountCoverage">0</span> excluded</div>
        </div>
      </div>
    </div>

    <!-- Donut Chart: Savings -->
    <div class="section">
      <div class="section-title">Token Compaction</div>
      <div class="donut-container">
        <svg class="donut" viewBox="0 0 100 100">
          <circle class="donut-bg" cx="50" cy="50" r="38" />
          <circle class="donut-fill" id="donutFill" cx="50" cy="50" r="38"
            stroke-dasharray="238.8" stroke-dashoffset="238.8" />
        </svg>
        <div class="donut-center">
          <div class="donut-value" id="donutPercent">0%</div>
          <div class="donut-label">saved</div>
        </div>
      </div>
      <div class="savings-bar-labels">
        <span id="originalTokens">0 original</span>
        <span id="compactedTokens">0 compacted</span>
      </div>
    </div>

    <!-- Language Breakdown -->
    <div class="section">
      <div class="section-title">Language Breakdown</div>
      <div class="lang-chart" id="langChart">
        <div class="empty-state-small">No language data yet</div>
      </div>
    </div>

    <!-- Session Timeline -->
    <div class="section">
      <div class="section-title">Session Timeline</div>
      <div class="timeline-container">
        <canvas id="timelineCanvas" width="280" height="50"></canvas>
      </div>
    </div>

    <!-- Top Savers Leaderboard -->
    <div class="section">
      <div class="section-title">🏆 Top Savers</div>
      <div class="top-savers" id="topSavers">
        <div class="empty-state-small">Analyze files to see top savers</div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="section">
      <div class="section-title">Recent Activity</div>
      <div class="activity-list" id="activityList">
        <div class="empty-state">No files analyzed yet.<br>Use "TokenSlayer: Analyze File" to get started.</div>
      </div>
    </div>

    <!-- Excluded Files (Secrets Protection) -->
    <div class="section">
      <div class="section-title">
        <span>🛡️ Excluded Files</span>
        <span class="excluded-count" id="excludedCount">0</span>
      </div>
      <div class="severity-summary" id="severitySummary"></div>
      <div class="excluded-list" id="excludedList">
        <div class="empty-state secure-state">✅ No secrets detected — all files are clean.</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button class="btn btn-primary" id="refreshBtn">↻ Refresh</button>
      <button class="btn btn-export" id="exportBtn">📋 Export</button>
      <button class="btn btn-danger" id="clearBtn">Clear</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Elements
    const tokensSavedEl = document.getElementById('tokensSaved');
    const reductionPercentEl = document.getElementById('reductionPercent');
    const filesAnalyzedEl = document.getElementById('filesAnalyzed');
    const cacheHitRateEl = document.getElementById('cacheHitRate');
    const cacheEntriesEl = document.getElementById('cacheEntries');
    const totalTokensProcessedEl = document.getElementById('totalTokensProcessed');
    const estCostSavedEl = document.getElementById('estCostSaved');
    const avgSavedPerFileEl = document.getElementById('avgSavedPerFile');
    const totalAnalysesEl = document.getElementById('totalAnalyses');
    const originalTokensEl = document.getElementById('originalTokens');
    const compactedTokensEl = document.getElementById('compactedTokens');
    const activityListEl = document.getElementById('activityList');
    const excludedListEl = document.getElementById('excludedList');
    const excludedCountEl = document.getElementById('excludedCount');
    const langChartEl = document.getElementById('langChart');
    const topSaversEl = document.getElementById('topSavers');
    const coverageRingEl = document.getElementById('coverageRing');
    const coveragePercentEl = document.getElementById('coveragePercent');
    const analyzedCountEl = document.getElementById('analyzedCount');
    const excludedCountCoverageEl = document.getElementById('excludedCountCoverage');
    const donutFillEl = document.getElementById('donutFill');
    const donutPercentEl = document.getElementById('donutPercent');
    const severitySummaryEl = document.getElementById('severitySummary');
    const timelineCanvas = document.getElementById('timelineCanvas');

    // Animated counter
    function animateCounter(element, target, duration) {
      const start = parseInt(element.textContent.replace(/,/g, '')) || 0;
      const diff = target - start;
      if (diff === 0) return;
      const startTime = performance.now();
      function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + diff * eased);
        element.textContent = current.toLocaleString();
        if (progress < 1) requestAnimationFrame(update);
      }
      requestAnimationFrame(update);
    }

    // Draw sparkline on canvas
    function drawTimeline(data) {
      const ctx = timelineCanvas.getContext('2d');
      const w = timelineCanvas.width;
      const h = timelineCanvas.height;
      ctx.clearRect(0, 0, w, h);

      if (!data || data.length < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Activity will appear here', w/2, h/2 + 3);
        return;
      }

      const values = data.map(function(d) { return d.tokensSaved; });
      const max = Math.max.apply(null, values) || 1;
      const stepX = w / (values.length - 1);

      // Gradient fill
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(0, 200, 120, 0.35)');
      grad.addColorStop(1, 'rgba(0, 200, 120, 0.02)');

      ctx.beginPath();
      ctx.moveTo(0, h);
      for (var i = 0; i < values.length; i++) {
        var x = i * stepX;
        var y = h - (values[i] / max) * (h - 8) - 4;
        if (i === 0) ctx.lineTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      for (var i = 0; i < values.length; i++) {
        var x = i * stepX;
        var y = h - (values[i] / max) * (h - 8) - 4;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(0, 200, 120, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Dots on last 3 points
      for (var i = Math.max(0, values.length - 3); i < values.length; i++) {
        var x = i * stepX;
        var y = h - (values[i] / max) * (h - 8) - 4;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#00c878';
        ctx.fill();
      }
    }

    // Language icons
    var langIcons = {
      typescript: '🔷', typescriptreact: '🔷',
      javascript: '🟡', javascriptreact: '🟡',
      python: '🐍', go: '🔵', java: '☕', rust: '🦀',
      csharp: '🟪', kotlin: '🟠', html: '🌐', css: '🎨',
      scss: '🎨', sass: '🎨', less: '🎨',
    };

    // Handle messages from extension
    window.addEventListener('message', function(event) {
      var message = event.data;

      if (message.type === 'update') {
        var savings = message.savings;
        var cacheStats = message.cacheStats;
        var recentAnalyses = message.recentAnalyses;

        // Hero stat
        animateCounter(tokensSavedEl, savings.totalSaved, 800);

        // Stats grid
        reductionPercentEl.textContent = savings.reductionPercent + '%';
        filesAnalyzedEl.textContent = savings.filesAnalyzed.toString();
        cacheHitRateEl.textContent = cacheStats.hitRate + '%';
        cacheEntriesEl.textContent = cacheStats.totalEntries.toString();

        // Extended stats
        animateCounter(totalTokensProcessedEl, savings.totalOriginalTokens, 600);
        estCostSavedEl.textContent = savings.estimatedCost ? savings.estimatedCost.label : '<$0.01';
        animateCounter(avgSavedPerFileEl, savings.avgSavedPerFile || 0, 600);
        totalAnalysesEl.textContent = savings.filesAnalyzed.toString();

        // Donut chart
        var circumference = 238.8;
        var donutOffset = circumference - (savings.reductionPercent / 100) * circumference;
        donutFillEl.style.strokeDashoffset = donutOffset;
        donutPercentEl.textContent = savings.reductionPercent + '%';
        originalTokensEl.textContent = savings.totalOriginalTokens.toLocaleString() + ' original';
        compactedTokensEl.textContent = savings.totalCompactedTokens.toLocaleString() + ' compacted';

        // Workspace coverage
        var analyzedCount = message.analyzedFileCount || 0;
        var excludedCount = message.excludedCount || 0;
        var totalKnown = analyzedCount + excludedCount;
        var coveragePercent = totalKnown > 0 ? Math.round((analyzedCount / Math.max(totalKnown, 1)) * 100) : 0;
        var ringCircumference = 263.9;
        var ringOffset = ringCircumference - (coveragePercent / 100) * ringCircumference;
        coverageRingEl.style.strokeDashoffset = ringOffset;
        coveragePercentEl.textContent = coveragePercent + '%';
        analyzedCountEl.textContent = analyzedCount;
        excludedCountCoverageEl.textContent = excludedCount;

        // Language breakdown chart
        var langStats = message.languageStats;
        if (langStats && langStats.length > 0) {
          var maxSaved = langStats[0].savedTokens || 1;
          langChartEl.innerHTML = langStats.map(function(l) {
            var icon = langIcons[l.language] || '📄';
            var barWidth = Math.max(4, Math.round((l.savedTokens / maxSaved) * 100));
            var displayName = l.language.replace('react', '').replace('typescript', 'TS').replace('javascript', 'JS').replace('python', 'Py').replace('java', 'Java').replace('rust', 'Rust').replace('go', 'Go').replace('csharp', 'C#').replace('kotlin', 'Kt').replace('html', 'HTML').replace('css', 'CSS').replace('scss', 'SCSS').replace('sass', 'Sass').replace('less', 'Less');
            return '<div class="lang-row">'
              + '<span class="lang-icon">' + icon + '</span>'
              + '<span class="lang-name">' + displayName + '</span>'
              + '<div class="lang-bar-bg"><div class="lang-bar-fill" style="width:' + barWidth + '%"></div></div>'
              + '<span class="lang-value">' + l.savedTokens.toLocaleString() + '</span>'
              + '</div>';
          }).join('');
        }

        // Copilot tool take-up
        var takeup = message.toolInvocations || {};
        var takeupNames = Object.keys(takeup);
        var takeupTotal = takeupNames.reduce(function(s, k) { return s + takeup[k]; }, 0);
        document.getElementById('toolTakeupTotal').textContent =
          takeupTotal + (takeupTotal === 1 ? ' call' : ' calls');
        document.getElementById('toolTakeupChart').innerHTML = takeupNames.length === 0
          ? '<div class="empty-state">No LM tool calls in this workspace yet — if this stays 0 while you use Copilot agent mode, check the tools picker.</div>'
          : takeupNames.sort(function(a, b) { return takeup[b] - takeup[a]; }).map(function(k) {
              return '<div class="lang-row">'
                + '<span class="lang-name">' + escapeHtml(k.replace('tokenslayer-', '')) + '</span>'
                + '<span class="lang-value">' + takeup[k] + '</span>'
                + '</div>';
            }).join('');

        // LLM usage (Claude Code transcripts)
        var llm = message.llmUsage;
        var llmBody = document.getElementById('llmUsageBody');
        var llmEmpty = document.getElementById('llmEmpty');
        if (llm && llm.available && llm.totalTokens > 0) {
          llmBody.style.display = '';
          llmEmpty.style.display = 'none';
          document.getElementById('llmSessionCount').textContent =
            llm.sessionCount + (llm.sessionCount === 1 ? ' session' : ' sessions')
            + (llm.requests ? ' \u00b7 ' + llm.requests + ' requests' : '');
          document.getElementById('llmInput').textContent = compactNum(llm.inputTokens);
          document.getElementById('llmOutput').textContent = compactNum(llm.outputTokens);
          document.getElementById('llmCacheRead').textContent = compactNum(llm.cacheReadTokens);
          document.getElementById('llmCacheWrite').textContent = compactNum(llm.cacheCreationTokens);
          document.getElementById('llmTotal').textContent = llm.totalTokens.toLocaleString() + ' total';
          document.getElementById('llmLastActivity').textContent =
            llm.lastActivity ? getTimeAgo(llm.lastActivity) : '';

          var modelChart = document.getElementById('llmModelChart');
          if (llm.byModel && llm.byModel.length > 0) {
            var maxModel = llm.byModel[0].totalTokens || 1;
            modelChart.innerHTML = llm.byModel.map(function(m) {
              var name = m.model.replace(/^claude-/, '').replace(/-\\d{8}$/, '');
              var barWidth = Math.max(4, Math.round((m.totalTokens / maxModel) * 100));
              return '<div class="lang-row">'
                + '<span class="lang-name" title="' + escapeHtml(m.model) + '">' + escapeHtml(name) + '</span>'
                + '<div class="lang-bar-bg"><div class="lang-bar-fill" style="width:' + barWidth + '%"></div></div>'
                + '<span class="lang-value">' + compactNum(m.totalTokens) + '</span>'
                + '</div>';
            }).join('');
          } else {
            modelChart.innerHTML = '';
          }
        } else {
          llmBody.style.display = 'none';
          llmEmpty.style.display = '';
        }

        // Timeline sparkline
        drawTimeline(message.timeline);

        // Top savers leaderboard
        var topSavers = message.topSavers;
        if (topSavers && topSavers.length > 0) {
          topSaversEl.innerHTML = topSavers.map(function(s, idx) {
            var medals = ['🥇', '🥈', '🥉', '4.', '5.'];
            var saved = s.originalTokens - s.compactedTokens;
            return '<div class="saver-row">'
              + '<span class="saver-rank">' + medals[idx] + '</span>'
              + '<span class="saver-name">' + escapeHtml(s.fileName) + '</span>'
              + '<span class="saver-saved">' + saved.toLocaleString() + '</span>'
              + '</div>';
          }).join('');
        }

        // Recent activity
        if (recentAnalyses && recentAnalyses.length > 0) {
          activityListEl.innerHTML = recentAnalyses.map(function(a) {
            var timeAgo = getTimeAgo(a.timestamp);
            return '<div class="activity-item" data-filepath="' + a.filePath + '">'
              + '<div class="activity-header">'
              + '<span class="activity-name">' + escapeHtml(a.fileName) + '</span>'
              + '<span class="activity-badge">' + a.reductionPercent + '%</span>'
              + '</div>'
              + '<div class="activity-detail">'
              + a.originalTokens.toLocaleString() + ' → ' + a.compactedTokens.toLocaleString() + ' tokens'
              + '<span class="activity-time">' + timeAgo + '</span>'
              + '</div>'
              + '</div>';
          }).join('');

          // Click handlers
          document.querySelectorAll('.activity-item').forEach(function(item) {
            item.addEventListener('click', function() {
              var fp = item.getAttribute('data-filepath');
              if (fp) vscode.postMessage({ type: 'openFile', filePath: fp });
            });
          });
        }

        // Excluded files
        var excludedFiles = message.excludedFiles;
        var exCount = message.excludedCount || 0;
        excludedCountEl.textContent = exCount.toString();

        // Severity summary badges
        if (excludedFiles && excludedFiles.length > 0) {
          var highCount = 0, medCount = 0, lowCount = 0;
          excludedFiles.forEach(function(f) {
            if (f.severity === 'high') highCount++;
            else if (f.severity === 'medium') medCount++;
            else lowCount++;
          });
          var badges = [];
          if (highCount > 0) badges.push('<span class="sev-badge sev-high">🔴 ' + highCount + ' HIGH</span>');
          if (medCount > 0) badges.push('<span class="sev-badge sev-medium">🟡 ' + medCount + ' MEDIUM</span>');
          if (lowCount > 0) badges.push('<span class="sev-badge sev-low">🟢 ' + lowCount + ' LOW</span>');
          severitySummaryEl.innerHTML = badges.join('');

          excludedListEl.innerHTML = excludedFiles.map(function(f) {
            var severityClass = 'severity-' + f.severity;
            var severityIcon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : '🟢';
            var timeAgo = getTimeAgo(f.timestamp);
            return '<div class="excluded-item ' + severityClass + '">'
              + '<div class="excluded-header">'
              + '<span class="excluded-icon">' + severityIcon + '</span>'
              + '<span class="excluded-name">' + escapeHtml(f.fileName) + '</span>'
              + '<span class="excluded-severity">' + f.severity.toUpperCase() + '</span>'
              + '</div>'
              + '<div class="excluded-reasons">'
              + f.reasons.map(function(r) { return '<span class="excluded-reason">' + escapeHtml(r) + '</span>'; }).join('')
              + '</div>'
              + '<div class="excluded-time">' + timeAgo + '</div>'
              + '</div>';
          }).join('');
        } else {
          severitySummaryEl.innerHTML = '';
          excludedListEl.innerHTML = '<div class="empty-state secure-state">✅ No secrets detected — all files are clean.</div>';
        }
      }
    });

    function compactNum(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 10000) return Math.round(n / 1000) + 'K';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return n.toString();
    }

    function getTimeAgo(timestamp) {
      var seconds = Math.floor((Date.now() - timestamp) / 1000);
      if (seconds < 60) return 'just now';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      return Math.floor(seconds / 86400) + 'd ago';
    }

    function escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Button handlers
    document.getElementById('refreshBtn').addEventListener('click', function() {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('clearBtn').addEventListener('click', function() {
      vscode.postMessage({ type: 'clearCache' });
    });
    document.getElementById('exportBtn').addEventListener('click', function() {
      vscode.postMessage({ type: 'exportReport' });
    });

    // Request initial data
    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
