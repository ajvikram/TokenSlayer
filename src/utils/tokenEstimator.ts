/**
 * Accurate token counter with lazy-loaded BPE tokenizer.
 * Falls back to character-based estimation until the tokenizer is ready,
 * ensuring zero-delay extension activation.
 */
export class TokenEstimator {
  /** Fallback: average characters per token for code */
  private static readonly CHARS_PER_TOKEN_FALLBACK = 4;

  /** Lazy-loaded encode function */
  private static encodeFn: ((text: string) => number[]) | null = null;
  private static loadAttempted = false;

  /**
   * Lazy-load the BPE tokenizer in the background.
   * Called once — subsequent calls use the cached function.
   */
  private static async loadTokenizer(): Promise<void> {
    if (TokenEstimator.loadAttempted) return;
    TokenEstimator.loadAttempted = true;

    try {
      const mod = await import('gpt-tokenizer');
      TokenEstimator.encodeFn = mod.encode;
    } catch {
      // gpt-tokenizer not available — stick with fallback
      TokenEstimator.encodeFn = null;
    }
  }

  /**
   * Initialize the tokenizer in the background.
   * Call this once during extension activation (non-blocking).
   */
  static initAsync(): void {
    TokenEstimator.loadTokenizer();
  }

  /**
   * Estimate the number of tokens in a string.
   * Uses BPE tokenizer if loaded, otherwise falls back to chars/4.
   */
  static estimate(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    // Use BPE tokenizer if available and text isn't too large
    if (TokenEstimator.encodeFn && text.length <= 500_000) {
      try {
        return TokenEstimator.encodeFn(text).length;
      } catch {
        // Fall through to estimation
      }
    }

    return Math.ceil(text.length / TokenEstimator.CHARS_PER_TOKEN_FALLBACK);
  }

  /**
   * Calculate the reduction percentage between original and compacted text.
   */
  static reductionPercent(originalTokens: number, compactedTokens: number): number {
    if (originalTokens === 0) {
      return 0;
    }
    const reduction = ((originalTokens - compactedTokens) / originalTokens) * 100;
    return Math.round(reduction * 10) / 10; // 1 decimal place
  }

  /**
   * Format a token count with thousands separators.
   */
  static formatCount(tokens: number): string {
    return tokens.toLocaleString('en-US');
  }

  /**
   * Get a human-readable savings summary.
   */
  static savingsSummary(originalTokens: number, compactedTokens: number): string {
    const saved = originalTokens - compactedTokens;
    const percent = TokenEstimator.reductionPercent(originalTokens, compactedTokens);
    return `${TokenEstimator.formatCount(saved)} tokens saved (${percent}% reduction)`;
  }
}
