import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';
import * as vscode from 'vscode';

/**
 * Java-specific compactor.
 * Keeps class/interface/enum declarations, method signatures,
 * field declarations, and annotations. Strips method bodies.
 */
export class JavaCompactor implements ICompactor {
  languageIds = ['java'];

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

    switch (symbol.kind) {
      case vscode.SymbolKind.Class:
        // Check for annotations
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

      case vscode.SymbolKind.Interface:
        lines.push(`${indent}${symbol.signatureLine} {`);
        for (const child of symbol.children) {
          lines.push(`${indent}    ${child.signatureLine};`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Enum:
        lines.push(`${indent}enum ${symbol.name} {`);
        for (const child of symbol.children) {
          lines.push(`${indent}    ${child.name},`);
        }
        lines.push(`${indent}}`);
        lines.push('');
        break;

      case vscode.SymbolKind.Method:
      case vscode.SymbolKind.Constructor:
        // Check for annotations like @Override, @Transactional, etc.
        const methodAnnotations = this.extractAnnotations(fileLines, symbol.range.startLine);
        for (const ann of methodAnnotations) {
          lines.push(`${indent}${ann}`);
        }
        lines.push(`${indent}${symbol.signatureLine} { /* ... */ }`);
        break;

      case vscode.SymbolKind.Field:
      case vscode.SymbolKind.Property:
        lines.push(`${indent}${symbol.signatureLine};`);
        break;

      case vscode.SymbolKind.Constant:
        lines.push(`${indent}${symbol.signatureLine};`);
        break;

      default:
        lines.push(`${indent}${symbol.signatureLine}`);
        break;
    }
  }

  /**
   * Extract Java import statements.
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
      if (pastPackage && trimmed.startsWith('import ')) {
        imports.push(trimmed);
      }
      // Stop after imports end
      if (
        pastPackage &&
        imports.length > 0 &&
        !trimmed.startsWith('import ') &&
        !trimmed.startsWith('//') &&
        trimmed.length > 0
      ) {
        break;
      }
    }

    return imports;
  }

  /**
   * Extract annotations above a symbol (e.g., @Override, @Service, @GetMapping).
   */
  private extractAnnotations(fileLines: string[], symbolStartLine: number): string[] {
    const annotations: string[] = [];
    let lineIdx = symbolStartLine - 1;

    while (lineIdx >= 0) {
      const line = fileLines[lineIdx]?.trim() || '';
      if (line.startsWith('@')) {
        annotations.unshift(line);
        lineIdx--;
      } else if (line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
        lineIdx--;
      } else {
        break;
      }
    }

    // Keep important annotations
    return annotations.filter(a =>
      a.startsWith('@Override') ||
      a.startsWith('@Deprecated') ||
      a.startsWith('@FunctionalInterface') ||
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
      a.startsWith('@Data') ||
      a.startsWith('@Builder') ||
      a.startsWith('@Getter') ||
      a.startsWith('@Setter') ||
      a.startsWith('@AllArgsConstructor') ||
      a.startsWith('@NoArgsConstructor') ||
      a.startsWith('@Slf4j') ||
      a.startsWith('@Test')
    );
  }
}
