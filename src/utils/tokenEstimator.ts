/**
 * Lightweight token count estimator.
 * Uses the ~4 characters per token heuristic for code/English text.
 * This avoids needing a tokenizer dependency (tiktoken, etc.).
 */
export class TokenEstimator {
  /** Average characters per token for code */
  private static readonly CHARS_PER_TOKEN = 4;

  /**
   * Estimate the number of tokens in a string.
   */
  static estimate(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }
    return Math.ceil(text.length / TokenEstimator.CHARS_PER_TOKEN);
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
