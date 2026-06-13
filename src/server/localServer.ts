import * as http from 'http';
import * as url from 'url';
import * as vscode from 'vscode';
import { CacheManager } from '../cache/cacheManager';
import { StructuralSummaryTool } from '../tools/structuralSummaryTool';
import { ContextRotAnalyzer } from '../health/contextRotAnalyzer';
import { RotScoreEngine } from '../health/rotScoreEngine';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * A lightweight, dependency-free local HTTP server.
 * Exposes TokenSlayer's AST extraction to external agents and IDEs.
 */
export class LocalServer {
  private server: http.Server | null = null;
  private port = 4733; // Default port for TokenSlayer API
  private cacheManager: CacheManager;
  private tool: StructuralSummaryTool;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
    this.tool = new StructuralSummaryTool(cacheManager);
  }

  /**
   * Start the HTTP server.
   */
  start(): void {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      // Set CORS headers so other IDEs/web apps can query it
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (!req.url) {
        this.sendError(res, 400, 'Invalid request URL');
        return;
      }

      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      try {
        if (pathname === '/analyze') {
          await this.handleAnalyze(parsedUrl.query, res);
        } else if (pathname === '/stats') {
          this.handleStats(res);
        } else if (pathname === '/session-health') {
          this.handleSessionHealth(parsedUrl.query, res);
        } else {
          this.sendError(res, 404, 'Endpoint not found. Available: /analyze, /stats, /session-health');
        }
      } catch (error) {
        logger.error(`API Error on ${pathname}`, error);
        this.sendError(res, 500, `Internal server error: ${error}`);
      }
    });

    this.server.listen(this.port, '127.0.0.1', () => {
      logger.info(`TokenSlayer Local API listening at http://127.0.0.1:${this.port}`);
    });

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Port ${this.port} is in use. TokenSlayer API will not start.`);
      } else {
        logger.error('TokenSlayer API server error', err);
      }
    });
  }

  /**
   * Stop the HTTP server.
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info('TokenSlayer Local API stopped');
    }
  }

  /**
   * Handle GET /analyze?path=/path/to/file
   */
  private async handleAnalyze(query: NodeJS.Dict<string | string[]>, res: http.ServerResponse): Promise<void> {
    const filePath = query.path;

    if (!filePath || typeof filePath !== 'string') {
      this.sendError(res, 400, 'Missing or invalid "path" query parameter');
      return;
    }

    const tokenSource = new vscode.CancellationTokenSource();

    try {
      // Analyze the file
      const skeleton = await this.tool.analyzeFile(filePath, 'standard', tokenSource.token);

      if (!skeleton || skeleton.length === 0 || skeleton.includes('skipped') || skeleton.includes('EXCLUDED')) {
        this.sendError(res, 422, `Could not extract structural skeleton for ${filePath}. Note: ${skeleton}`);
        return;
      }

      // We successfully got the skeleton. Let's look up the stats in the cache.
      // We don't have the exact content hash here easily without reading the file again, 
      // but the tool just cached it. We can find it by path.
      let stats = {
        originalTokens: 0,
        compactedTokens: 0,
        reductionPercent: 0,
        languageId: 'unknown'
      };

      const result = this.cacheManager.getFileResult(filePath);
      if (result) {
        stats.originalTokens = result.originalTokens;
        stats.compactedTokens = result.compactedTokens;
        stats.reductionPercent = result.reductionPercent;
        stats.languageId = result.languageId;
      }

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        path: filePath,
        languageId: stats.languageId,
        skeleton: skeleton,
        stats: {
          originalTokens: stats.originalTokens,
          compactedTokens: stats.compactedTokens,
          reductionPercent: stats.reductionPercent
        }
      }));
    } finally {
      tokenSource.dispose();
    }
  }

  /**
   * Handle GET /stats
   */
  private handleStats(res: http.ServerResponse): void {
    const savings = this.cacheManager.getSavings();
    
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      totalSaved: savings.totalSaved,
      filesAnalyzed: savings.filesAnalyzed,
      reductionPercent: savings.reductionPercent
    }));
  }

  /**
   * Handle GET /session-health?workspaceRoot=/abs/path
   *
   * Falls back to the first VS Code workspace folder if workspaceRoot is omitted.
   * Pure Node.js — no VS Code API needed, so this also works from the MCP server.
   */
  private handleSessionHealth(query: NodeJS.Dict<string | string[]>, res: http.ServerResponse): void {
    const workspaceRoot =
      (typeof query.workspaceRoot === 'string' ? query.workspaceRoot : null) ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
      this.sendError(res, 400, 'No workspaceRoot provided and no VS Code workspace open');
      return;
    }

    const analyzer = new ContextRotAnalyzer();
    const engine   = new RotScoreEngine();

    const result = analyzer.analyze(workspaceRoot);
    if (!result) {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        available: false,
        message: 'No active Claude Code session found for this workspace',
        workspaceRoot,
      }));
      return;
    }

    const health = engine.compute(result);
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      available: true,
      workspaceRoot,
      health,
    }));
  }

  /**
   * Send a JSON error response.
   */
  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    res.writeHead(statusCode);
    res.end(JSON.stringify({
      success: false,
      error: message
    }));
  }
}
