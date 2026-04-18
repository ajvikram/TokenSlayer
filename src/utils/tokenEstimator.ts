import { encode } from 'gpt-tokenizer';

/**
 * Accurate BPE token counter using GPT tokenizer.
 * Uses the real cl100k_base encoding (GPT-4/GPT-3.5) for exact counts.
 * Falls back to character-based estimation for very large inputs.
 */
export class TokenEstimator {
  /** Fallback: average characters per token for code */
  private static readonly CHARS_PER_TOKEN_FALLBACK = 4;

  /** Max chars before falling back to estimation (performance guard) */
  private static readonly MAX_EXACT_CHARS = 500_000;

  /**
   * Count the exact number of BPE tokens in a string.
   * Uses gpt-tokenizer (cl100k_base) for accuracy.
   */
  static estimate(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    // For very large inputs, fall back to estimation to avoid blocking
    if (text.length > TokenEstimator.MAX_EXACT_CHARS) {
      return Math.ceil(text.length / TokenEstimator.CHARS_PER_TOKEN_FALLBACK);
    }

    try {
      return encode(text).length;
    } catch {
      // Fallback if tokenizer fails for any reason
      return Math.ceil(text.length / TokenEstimator.CHARS_PER_TOKEN_FALLBACK);
    }
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
