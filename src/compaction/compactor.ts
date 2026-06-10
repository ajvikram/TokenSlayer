import { CompactedResult, StructuralSymbol } from '../types';
import { TokenEstimator } from '../utils/tokenEstimator';
import { optimizeLayout, getTargetModel } from '../utils/layoutOptimizer';
import { Logger } from '../utils/logger';
import { TypeScriptCompactor } from './typescriptCompactor';
import { PythonCompactor } from './pythonCompactor';
import { GoCompactor } from './goCompactor';
import { JavaCompactor } from './javaCompactor';
import { RustCompactor } from './rustCompactor';
import { CSharpCompactor } from './csharpCompactor';
import { KotlinCompactor } from './kotlinCompactor';
import { HtmlCompactor } from './htmlCompactor';
import { CssCompactor } from './cssCompactor';
import {
  PhpCompactor,
  RubyCompactor,
  SwiftCompactor,
  SqlCompactor,
  VueSvelteCompactor,
} from './lineBasedCompactor';

const logger = Logger.getInstance();

/**
 * Interface for language-specific compactors.
 */
export interface ICompactor {
  /** Language IDs this compactor handles */
  languageIds: string[];

  /**
   * Compact the file content using symbols and domain knowledge.
   * Returns a compressed skeleton string.
   */
  compact(
    symbols: StructuralSymbol[],
    fileContent: string,
    filePath: string
  ): string;
}

/**
 * Factory that maps language IDs to specific compactor implementations.
 */
export class CompactorFactory {
  private static compactors: ICompactor[] = [
    new TypeScriptCompactor(),
    new PythonCompactor(),
    new GoCompactor(),
    new JavaCompactor(),
    new RustCompactor(),
    new CSharpCompactor(),
    new KotlinCompactor(),
    new HtmlCompactor(),
    new CssCompactor(),
    new PhpCompactor(),
    new RubyCompactor(),
    new SwiftCompactor(),
    new SqlCompactor(),
    new VueSvelteCompactor(),
  ];

  /**
   * Get the compactor for a given language ID.
   * Returns undefined if no specialized compactor exists.
   */
  static getCompactor(languageId: string): ICompactor | undefined {
    return this.compactors.find(c => c.languageIds.includes(languageId));
  }

  /**
   * Check if a specialized compactor exists for a language.
   */
  static hasCompactor(languageId: string): boolean {
    return this.compactors.some(c => c.languageIds.includes(languageId));
  }

  /**
   * Run compaction on file content.
   * If a language-specific compactor exists, use it.
   * Otherwise, fall back to the skeleton builder output.
   */
  static compact(
    symbols: StructuralSymbol[],
    fileContent: string,
    filePath: string,
    languageId: string,
    skeletonFallback: string
  ): CompactedResult {
    const originalTokens = TokenEstimator.estimate(fileContent);
    let skeleton: string;

    const compactor = this.getCompactor(languageId);
    if (compactor) {
      logger.debug(`Using ${languageId} compactor for ${filePath}`);
      skeleton = compactor.compact(symbols, fileContent, filePath);
    } else {
      logger.debug(`No specific compactor for ${languageId}, using generic skeleton`);
      skeleton = skeletonFallback;
    }

    const targetModel = getTargetModel();
    if (targetModel) {
      skeleton = optimizeLayout(skeleton, targetModel);
    }

    const compactedTokens = TokenEstimator.estimate(skeleton);
    const reductionPercent = TokenEstimator.reductionPercent(originalTokens, compactedTokens);

    return {
      skeleton,
      originalTokens,
      compactedTokens,
      reductionPercent,
      fileUri: filePath,
      languageId,
      symbolCount: symbols.length,
      timestamp: Date.now(),
    };
  }
}
