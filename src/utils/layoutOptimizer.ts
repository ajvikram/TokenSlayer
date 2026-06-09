import * as vscode from 'vscode';

/**
 * Optimize skeleton layout to minimize BPE token count.
 * Only applies when a targetModel is specified.
 */
export function optimizeLayout(skeleton: string, targetModel?: string): string {
  if (!targetModel) return skeleton;

  let result = skeleton;

  // Pass 1: collapse 3+ blank lines to 1 blank line, strip trailing spaces
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/[ \t]+$/gm, '');

  // Pass 2: compact braces — remove blank line between closing brace and next declaration
  result = result.replace(
    /\}\n\n(?=\s*(export |public |private |protected |function |class |interface |struct |enum |fn |func |def |async ))/g,
    '}\n'
  );

  // Pass 3: minify indentation — 4-space/tab to 2-space
  result = result.replace(/^(\t+)/gm, (_m, tabs: string) => '  '.repeat(tabs.length));
  result = result.replace(/^((?:    )+)/gm, (_m, spaces: string) => '  '.repeat(spaces.length / 4));

  // Pass 4: collapse single-line-able multi-line signatures
  result = result.replace(
    /^(\s*(?:export |public |private |protected |static |async |override )*(?:function|func|fn|fun|def|method)\s+\w+)\(\s*\n((?:\s+\w[^,\n]*,?\s*\n){1,5})\s*\)/gm,
    (_match, prefix: string, paramBlock: string) => {
      const params = paramBlock.split('\n').map(l => l.trim()).filter(Boolean).join(' ');
      const collapsed = `${prefix}(${params})`;
      return collapsed.length <= 120 ? collapsed : _match;
    }
  );

  return result;
}

/**
 * Read the targetModel from VS Code settings.
 */
export function getTargetModel(): string | undefined {
  const config = vscode.workspace.getConfiguration('tokenslayer');
  const model = config.get<string>('targetModel', '');
  return model || undefined;
}
