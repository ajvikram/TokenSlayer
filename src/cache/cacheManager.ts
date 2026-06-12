import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CacheEntry, CacheStats, CompactedResult, TokenSavings, RecentAnalysis, ExcludedFile } from '../types';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * LRU cache for structural summaries.
 * Keyed by content hash — automatically invalidated when file content changes.
 * Backed by in-memory Map with periodic persistence to disk.
 */
export class CacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private maxEntries: number;
  private storagePath: vscode.Uri | undefined;
  private hitCount = 0;
  private missCount = 0;
  private totalOriginalTokens = 0;
  private totalCompactedTokens = 0;
  private recentAnalyses: RecentAnalysis[] = [];
  private excludedFiles: ExcludedFile[] = [];
  private languageStats: Map<string, { files: number; originalTokens: number; compactedTokens: number }> = new Map();
  private timeline: Array<{ timestamp: number; tokensSaved: number }> = [];
  private analyzedFilePaths: Set<string> = new Set();

  constructor(private context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('tokenslayer');
    this.maxEntries = config.get<number>('cacheMaxEntries', 500);
    this.storagePath = context.storageUri;
  }

  /**
   * Initialize the cache — load from disk if available.
   */
  async initialize(): Promise<void> {
    try {
      if (this.storagePath) {
        // Ensure storage directory exists
        await vscode.workspace.fs.createDirectory(this.storagePath);
        const cacheFileUri = vscode.Uri.joinPath(this.storagePath, 'cache.json');

        try {
          const data = await vscode.workspace.fs.readFile(cacheFileUri);
          const parsed = JSON.parse(Buffer.from(data).toString('utf-8'));

          if (parsed.entries && Array.isArray(parsed.entries)) {
            for (const entry of parsed.entries) {
              this.cache.set(entry.key, entry);
            }
          }

          this.hitCount = parsed.hitCount || 0;
          this.missCount = parsed.missCount || 0;
          this.totalOriginalTokens = parsed.totalOriginalTokens || 0;
          this.totalCompactedTokens = parsed.totalCompactedTokens || 0;
          this.recentAnalyses = parsed.recentAnalyses || [];
          this.excludedFiles = parsed.excludedFiles || [];
          if (parsed.languageStats) {
            this.languageStats = new Map(Object.entries(parsed.languageStats));
          }
          this.timeline = parsed.timeline || [];
          if (parsed.analyzedFilePaths) {
            this.analyzedFilePaths = new Set(parsed.analyzedFilePaths);
          }

          logger.info(`Cache loaded: ${this.cache.size} entries`);
        } catch {
          // No cache file yet — that's fine
          logger.debug('No existing cache file, starting fresh');
        }
      }
    } catch (error) {
      logger.error('Failed to load cache', error);
    }
  }

  /**
   * Generate a cache key from file URI and content.
   */
  generateKey(fileUri: string, content: string): string {
    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    return `${fileUri}::${contentHash}`;
  }

  /**
   * Get a cached result.
   */
  get(key: string): CompactedResult | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Update LRU access time
      entry.lastAccessedAt = Date.now();
      this.hitCount++;
      logger.debug(`Cache HIT: ${entry.fileUri}`);
      return entry.result;
    }
    this.missCount++;
    return undefined;
  }

  /**
   * Store a result in the cache.
   */
  set(key: string, fileUri: string, contentHash: string, result: CompactedResult): void {
    // LRU eviction
    if (this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }

    const entry: CacheEntry = {
      key,
      fileUri,
      contentHash,
      result,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.cache.set(key, entry);

    // Track savings
    this.totalOriginalTokens += result.originalTokens;
    this.totalCompactedTokens += result.compactedTokens;

    // Track language stats
    const lang = result.languageId || 'unknown';
    const existing = this.languageStats.get(lang) || { files: 0, originalTokens: 0, compactedTokens: 0 };
    existing.files++;
    existing.originalTokens += result.originalTokens;
    existing.compactedTokens += result.compactedTokens;
    this.languageStats.set(lang, existing);

    // Track timeline
    this.timeline.push({
      timestamp: Date.now(),
      tokensSaved: result.originalTokens - result.compactedTokens,
    });
    if (this.timeline.length > 200) {
      this.timeline = this.timeline.slice(-200);
    }

    // Track analyzed file paths
    this.analyzedFilePaths.add(fileUri);

    // Track recent analyses
    const fileName = fileUri.split(/[/\\]/).pop() || fileUri;
    this.recentAnalyses.unshift({
      fileName,
      filePath: fileUri,
      originalTokens: result.originalTokens,
      compactedTokens: result.compactedTokens,
      reductionPercent: result.reductionPercent,
      timestamp: Date.now(),
    });

    // Keep only last 50 analyses
    if (this.recentAnalyses.length > 50) {
      this.recentAnalyses = this.recentAnalyses.slice(0, 50);
    }

    logger.debug(`Cache SET: ${fileUri} (${result.reductionPercent}% reduction)`);
  }

  /**
   * Invalidate cache entries for a specific file URI.
   */
  invalidateFile(fileUri: string): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.fileUri === fileUri) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
    if (keysToDelete.length > 0) {
      logger.debug(`Invalidated ${keysToDelete.length} cache entries for ${fileUri}`);
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.totalOriginalTokens = 0;
    this.totalCompactedTokens = 0;
    this.recentAnalyses = [];
    this.excludedFiles = [];
    this.languageStats.clear();
    this.timeline = [];
    this.analyzedFilePaths.clear();
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const totalRequests = this.hitCount + this.missCount;
    return {
      totalEntries: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: totalRequests > 0 ? Math.round((this.hitCount / totalRequests) * 100) : 0,
      storageSizeBytes: this.estimateStorageSize(),
    };
  }

  /**
   * Get token savings statistics.
   */
  getSavings(): TokenSavings {
    const totalSaved = this.totalOriginalTokens - this.totalCompactedTokens;
    const fileCount = this.analyzedFilePaths.size;
    const m = totalSaved / 1_000_000;
    const gpt4o = Math.round(m * 2.50 * 100) / 100;
    const claudeSonnet = Math.round(m * 3.00 * 100) / 100;
    const best = Math.max(gpt4o, claudeSonnet);
    return {
      totalOriginalTokens: this.totalOriginalTokens,
      totalCompactedTokens: this.totalCompactedTokens,
      totalSaved,
      reductionPercent:
        this.totalOriginalTokens > 0
          ? Math.round(
              ((this.totalOriginalTokens - this.totalCompactedTokens) / this.totalOriginalTokens) *
                100
            )
          : 0,
      avgSavedPerFile: fileCount > 0 ? Math.round(totalSaved / fileCount) : 0,
      estimatedCost: {
        gpt4o,
        claudeSonnet,
        label: best < 0.01 ? '<$0.01' : `~$${best.toFixed(2)}`,
      },
      filesAnalyzed: this.recentAnalyses.length,
      cacheHits: this.hitCount,
      cacheMisses: this.missCount,
    };
  }

  /**
   * Get recent analyses list.
   */
  getRecentAnalyses(): RecentAnalysis[] {
    return this.recentAnalyses.slice(0, 20);
  }

  /**
   * Add a file to the excluded list (contains secrets).
   */
  addExcludedFile(filePath: string, reasons: string[], severity: 'low' | 'medium' | 'high'): void {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    // Don't add duplicates
    if (this.excludedFiles.some(f => f.filePath === filePath)) {
      return;
    }

    this.excludedFiles.unshift({
      fileName,
      filePath,
      reasons,
      severity,
      timestamp: Date.now(),
    });

    // Keep only last 100 excluded files
    if (this.excludedFiles.length > 100) {
      this.excludedFiles = this.excludedFiles.slice(0, 100);
    }

    logger.warn(`Excluded file (${severity}): ${filePath} — ${reasons.join(', ')}`);
  }

  /**
   * Get excluded files list.
   */
  getExcludedFiles(): ExcludedFile[] {
    return this.excludedFiles.slice(0, 20);
  }

  /**
   * Get count of excluded files.
   */
  getExcludedCount(): number {
    return this.excludedFiles.length;
  }

  /**
   * Get language breakdown stats.
   */
  getLanguageStats(): Array<{ language: string; files: number; originalTokens: number; compactedTokens: number; savedTokens: number; reductionPercent: number }> {
    const result: Array<{ language: string; files: number; originalTokens: number; compactedTokens: number; savedTokens: number; reductionPercent: number }> = [];
    for (const [lang, stats] of this.languageStats) {
      result.push({
        language: lang,
        files: stats.files,
        originalTokens: stats.originalTokens,
        compactedTokens: stats.compactedTokens,
        savedTokens: stats.originalTokens - stats.compactedTokens,
        reductionPercent: stats.originalTokens > 0 ? Math.round(((stats.originalTokens - stats.compactedTokens) / stats.originalTokens) * 100) : 0,
      });
    }
    return result.sort((a, b) => b.savedTokens - a.savedTokens);
  }

  /**
   * Get top N files by token savings.
   */
  getTopSavers(n: number = 5): RecentAnalysis[] {
    // Deduplicate by fileName — keep best result per file
    const bestByFile = new Map<string, RecentAnalysis>();
    for (const a of this.recentAnalyses) {
      const existing = bestByFile.get(a.fileName);
      const saved = a.originalTokens - a.compactedTokens;
      if (!existing || saved > (existing.originalTokens - existing.compactedTokens)) {
        bestByFile.set(a.fileName, a);
      }
    }
    return Array.from(bestByFile.values())
      .sort((a, b) => (b.originalTokens - b.compactedTokens) - (a.originalTokens - a.compactedTokens))
      .slice(0, n);
  }

  /**
   * Get timeline data (last N events).
   */
  getTimeline(n: number = 30): Array<{ timestamp: number; tokensSaved: number }> {
    return this.timeline.slice(-n);
  }

  /** Token savings rolled up by calendar month (`YYYY-MM`, local time). */
  getSavingsByMonth(): Record<string, number> {
    const byMonth: Record<string, number> = {};
    for (const pt of this.timeline) {
      const d = new Date(pt.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] ?? 0) + pt.tokensSaved;
    }
    return byMonth;
  }

  /**
   * Get workspace coverage info.
   */
  getAnalyzedFileCount(): number {
    return this.analyzedFilePaths.size;
  }

  /**
   * Check if a file has been analyzed.
   */
  isFileAnalyzed(filePath: string): boolean {
    return this.analyzedFilePaths.has(filePath);
  }

  /**
   * Check if a file is excluded.
   */
  isFileExcluded(filePath: string): boolean {
    return this.excludedFiles.some(f => f.filePath === filePath);
  }

  /**
   * Get the compaction result for a file from cache (by file path, latest).
   */
  getFileResult(filePath: string): CompactedResult | undefined {
    for (const [, entry] of this.cache) {
      if (entry.fileUri === filePath) {
        return entry.result;
      }
    }
    return undefined;
  }

  /**
   * Persist cache to disk.
   */
  async persist(): Promise<void> {
    try {
      if (this.storagePath) {
        const cacheFileUri = vscode.Uri.joinPath(this.storagePath, 'cache.json');
        const data = {
          entries: Array.from(this.cache.values()),
          hitCount: this.hitCount,
          missCount: this.missCount,
          totalOriginalTokens: this.totalOriginalTokens,
          totalCompactedTokens: this.totalCompactedTokens,
          recentAnalyses: this.recentAnalyses,
          excludedFiles: this.excludedFiles,
          languageStats: Object.fromEntries(this.languageStats),
          timeline: this.timeline,
          analyzedFilePaths: Array.from(this.analyzedFilePaths),
        };

        await vscode.workspace.fs.writeFile(
          cacheFileUri,
          Buffer.from(JSON.stringify(data, null, 2), 'utf-8')
        );

        logger.debug(`Cache persisted: ${this.cache.size} entries`);
      }
    } catch (error) {
      logger.error('Failed to persist cache', error);
    }
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug(`LRU evicted: ${oldestKey}`);
    }
  }

  /**
   * Estimate the in-memory size of the cache.
   */
  private estimateStorageSize(): number {
    let size = 0;
    for (const [, entry] of this.cache) {
      size += entry.result.skeleton.length * 2; // UTF-16 chars
      size += entry.key.length * 2;
      size += 200; // metadata overhead estimate
    }
    return size;
  }
}
