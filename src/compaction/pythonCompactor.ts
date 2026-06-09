import { ICompactor } from './compactor';
import { StructuralSymbol } from '../types';
import * as vscode from 'vscode';

/**
 * Python-specific compactor.
 * Keeps class/function signatures with type hints, preserves
 * decorators and first-line docstrings, strips function bodies.
 */
export class PythonCompactor implements ICompactor {
  languageIds = ['python'];

  compact(symbols: StructuralSymbol[], fileContent: string, filePath: string): string {
    const lines: string[] = [];
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const totalLines = fileContent.split('\n').length;
    const fileLines = fileContent.split('\n');

    // Extract imports (compacted)
    const imports = this.extractImports(fileLines);
    if (imports.length > 0) {
      lines.push('# Imports');
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
    const header = `# ${fileName} (${totalLines} lines → ${skeletonLines}-line skeleton)`;

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
        // Check for decorators above the class
        const classDecorators = this.extractDecorators(fileLines, symbol.range.startLine);
        for (const dec of classDecorators) {
          lines.push(`${indent}${dec}`);
        }
        lines.push(`${indent}${symbol.signatureLine}:`);

        // Extract docstring
        const classDocstring = this.extractDocstring(fileLines, symbol.range.startLine);
        if (classDocstring) {
          lines.push(`${indent}    """${classDocstring}"""`);
        }

        for (const child of symbol.children) {
          this.processSymbol(child, lines, depth + 1, fileLines);
        }
        lines.push('');
        break;

      case vscode.SymbolKind.Function:
      case vscode.SymbolKind.Method:
        // Check for decorators
        const funcDecorators = this.extractDecorators(fileLines, symbol.range.startLine);
        for (const dec of funcDecorators) {
          lines.push(`${indent}${dec}`);
        }
        lines.push(`${indent}${symbol.signatureLine}:`);

        // Extract docstring (first line only)
        const docstring = this.extractDocstring(fileLines, symbol.range.startLine);
        if (docstring) {
          lines.push(`${indent}    """${docstring}"""`);
        }

        lines.push(`${indent}    ...`);
        lines.push('');
        break;

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
   * Extract import statements from the top of the file.
   */
  private extractImports(fileLines: string[]): string[] {
    const imports: string[] = [];

    for (const line of fileLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
        imports.push(trimmed);
      }
      // Stop after imports section
      if (
        imports.length > 0 &&
        !trimmed.startsWith('import ') &&
        !trimmed.startsWith('from ') &&
        !trimmed.startsWith('#') &&
        trimmed.length > 0
      ) {
        break;
      }
    }

    return imports;
  }

  /**
   * Extract decorator lines above a symbol.
   */
  private extractDecorators(fileLines: string[], symbolStartLine: number): string[] {
    const decorators: string[] = [];
    let lineIdx = symbolStartLine - 1;

    while (lineIdx >= 0) {
      const line = fileLines[lineIdx]?.trim() || '';
      if (line.startsWith('@')) {
        decorators.unshift(line);
        lineIdx--;
      } else {
        break;
      }
    }

    return decorators.filter(d => PythonCompactor.isSignificantDecorator(d));
  }

  /**
   * Decide whether a decorator carries enough signal to keep in the skeleton.
   *
   * Heuristic:
   *   1. Drop private decorators (`@_foo` / `@__foo`) — usually internal helpers.
   *   2. Keep an explicit allow-list of widely-used decorators that change
   *      semantics or register the function with a framework (route handlers,
   *      fixtures, abstract markers, cache wrappers, etc.).
   *   3. Keep any *qualified* decorator (`@module.name`) — framework
   *      decorators almost always look like this and act as registration
   *      pragmas the LLM needs to see.
   */
  static isSignificantDecorator(d: string): boolean {
    const body = d.replace(/^@/, '');
    if (body.startsWith('_')) { return false; }

    const allowedBare = [
      // stdlib: dataclasses
      'dataclass',
      // stdlib: builtins / standard descriptor protocol
      'property', 'staticmethod', 'classmethod', 'abstractmethod',
      // stdlib: functools
      'cache', 'cached_property', 'lru_cache', 'wraps', 'singledispatch',
      'singledispatchmethod', 'total_ordering', 'reduce',
      // stdlib: typing (PEP 484, 591, 593, 698)
      'overload', 'final', 'override', 'runtime_checkable', 'no_type_check',
      // stdlib: contextlib
      'contextmanager', 'asynccontextmanager',
      // stdlib: enum
      'unique', 'verify',
      // Django
      'login_required', 'permission_required', 'user_passes_test',
      'require_http_methods', 'require_GET', 'require_POST', 'require_safe',
      'csrf_exempt', 'csrf_protect', 'ensure_csrf_cookie',
      'cache_page', 'never_cache', 'cache_control', 'vary_on_cookie',
      'vary_on_headers', 'method_decorator', 'receiver',
      // Celery
      'task', 'shared_task', 'periodic_task',
      // tenacity / retry
      'retry',
      // pytest bare markers (rare but possible)
      'fixture',
    ];

    for (const name of allowedBare) {
      if (body === name || body.startsWith(name + '(')) { return true; }
    }

    // Qualified decorator: @module.name(...) — almost always a framework
    // registration (FastAPI routes, Flask blueprints, click commands,
    // pytest marks, celery tasks, SQLAlchemy events, etc.).
    if (/^[A-Za-z][\w]*\.[A-Za-z]/.test(body)) { return true; }

    return false;
  }

  /**
   * Extract the first line of a docstring after a def/class declaration.
   */
  private extractDocstring(fileLines: string[], symbolStartLine: number): string | null {
    // Look for a docstring 1-2 lines after the declaration
    for (let offset = 1; offset <= 2; offset++) {
      const lineIdx = symbolStartLine + offset;
      if (lineIdx >= fileLines.length) { break; }
      const line = fileLines[lineIdx]?.trim() || '';

      if (line.startsWith('"""') || line.startsWith("'''")) {
        // Single-line docstring
        const quote = line.startsWith('"""') ? '"""' : "'''";
        if (line.endsWith(quote) && line.length > 6) {
          return line.slice(3, -3).trim();
        }
        // Multi-line docstring — just take the first line
        return line.slice(3).trim() || null;
      }
    }

    return null;
  }
}
