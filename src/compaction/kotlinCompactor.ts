import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';
import * as vscode from 'vscode';
import { extractBlockDocComment } from './docCommentExtractor';

/**
 * Kotlin-specific compactor.
 * Keeps class/interface/object/data class declarations, method signatures,
 * val/var declarations, and annotations. Strips function bodies.
 */
export class KotlinCompactor implements ICompactor {
  languageIds = ['kotlin'];

  compact(symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const lines: string[] = [];
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;
    const fileLines = fileContent.split('\n');

    // Extract package declaration
    const packageLine = fileLines.find(l => l.trim().startsWith('package '));
    if (packageLine) {
      lines.push(packageLine.trim());
      lines.push('');
    }

    // Extract imports (compacted)
    const imports = this.extractImports(fileLines);
    if (imports.length > 0) {
      lines.push('// Imports');
      for (const imp of imports) {
        lines.push(imp);
      }
      lines.push('');
    }

    // Process top-level symbols
    for (const symbol of symbols) {
      this.processSymbol(symbol, lines, 0, fileLines);
    }

    const skeletonLines = lines.filter(l => l.trim().length > 0).length;
    const header = `// ${fileName} (${totalLines} lines → ${skeletonLines}-line skeleton)`;

    return [header, '', ...lines].join('\n');
  }

  private processSymbol(
    symbol: StructuralSymbol,
    lines: string[],
    depth: number,
    fileLines: string[]
  ): void {
    const indent = '    '.repeat(depth);

    const doc = extractBlockDocComment(fileLines, symbol.range.startLine);

    switch (symbol.kind) {
      case vscode.SymbolKind.Class:
      case vscode.SymbolKind.Interface:
      case vscode.SymbolKind.Struct: // Some LSPs map objects/data classes to Struct
        if (doc) { lines.push(`${indent}/** ${doc} */`); }
        const classAnnotations = this.extractAnnotations(fileLines, symbol.range.startLine);
        for (const ann of classAnnotations) {
          lines.push(`${indent}${ann}`);
        }
        lines.push(`${indent}${symbol.signatureLine} {`);
        for (const child of symbol.children) {
          this.processSymbol(child, lines, depth + 1, fileLines);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Enum:
        if (doc) { lines.push(`${indent}/** ${doc} */`); }
        lines.push(`${indent}enum class ${symbol.name} {`);
        for (const child of symbol.children) {
          lines.push(`${indent}    ${child.name},`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Function:
      case vscode.SymbolKind.Method:
      case vscode.SymbolKind.Constructor:
        if (doc) { lines.push(`${indent}/** ${doc} */`); }
        const methodAnnotations = this.extractAnnotations(fileLines, symbol.range.startLine);
        for (const ann of methodAnnotations) {
          lines.push(`${indent}${ann}`);
        }
        lines.push(`${indent}${symbol.signatureLine} { /* ... */ }`);
        break;

      case vscode.SymbolKind.Field:
      case vscode.SymbolKind.Property:
      case vscode.SymbolKind.Variable:
      case vscode.SymbolKind.Constant:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;

      default:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;
    }
  }

  /**
   * Extract Kotlin import statements.
   */
  private extractImports(fileLines: string[]): string[] {
    const imports: string[] = [];
    let pastPackage = false;

    for (const line of fileLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('package ')) {
        pastPackage = true;
        continue;
      }
      if (trimmed.startsWith('import ')) {
        imports.push(trimmed);
      }
      // Stop after imports end
      if (
        (pastPackage || imports.length > 0) &&
        !trimmed.startsWith('import ') &&
        !trimmed.startsWith('package ') &&
        !trimmed.startsWith('//') &&
        trimmed.length > 0
      ) {
        break;
      }
    }

    return imports;
  }

  /**
   * Extract annotations above a symbol (e.g., @JvmStatic, @Service).
   */
  private extractAnnotations(fileLines: string[], symbolStartLine: number): string[] {
    const annotations: string[] = [];
    let lineIdx = symbolStartLine - 1;

    while (lineIdx >= 0) {
      const line = fileLines[lineIdx]?.trim() || '';
      if (line.startsWith('@')) {
        annotations.unshift(line);
        lineIdx--;
      } else if (line === '' || line.startsWith('//') || line.startsWith('/*')) {
        lineIdx--;
      } else {
        break;
      }
    }

    // Keep important architectural/framework annotations
    return annotations.filter(a =>
      a.startsWith('@Jvm') ||
      a.startsWith('@Service') ||
      a.startsWith('@Component') ||
      a.startsWith('@Repository') ||
      a.startsWith('@Controller') ||
      a.startsWith('@RestController') ||
      a.startsWith('@Entity') ||
      a.startsWith('@Table') ||
      a.startsWith('@Bean') ||
      a.startsWith('@Autowired') ||
      a.startsWith('@Inject') ||
      a.startsWith('@Transactional') ||
      a.startsWith('@GetMapping') ||
      a.startsWith('@PostMapping') ||
      a.startsWith('@PutMapping') ||
      a.startsWith('@DeleteMapping') ||
      a.startsWith('@RequestMapping') ||
      a.startsWith('@PathVariable') ||
      a.startsWith('@RequestBody') ||
      a.startsWith('@Test')
    );
  }
}
