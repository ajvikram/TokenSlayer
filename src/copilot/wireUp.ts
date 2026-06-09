import * as vscode from 'vscode';
import * as path from 'path';

const INSTRUCTIONS_START = '<!-- TOKENSLAYER:START — managed block, do not edit between markers -->';
const INSTRUCTIONS_END = '<!-- TOKENSLAYER:END -->';

const INSTRUCTIONS_BLOCK = `${INSTRUCTIONS_START}
## TokenSlayer — Structural-First Reading

This workspace has the **TokenSlayer** extension installed. It exposes a compact AST-driven skeleton of any source file at a fraction of the token cost of reading the raw file.

When you need to understand code in this repository, follow these rules:

1. **For orientation, navigation, or "where is X defined" questions** — call \`#tokenslayer-structural-summary\` BEFORE reading raw files. The skeleton gives you class hierarchies, function signatures, and type relationships in 5–10% of the tokens.
2. **For implementation questions or edits** — first call \`#tokenslayer-structural-summary\` to locate the relevant symbol, then use \`read_file\` with a narrow line range for just the body you need to edit. Do not read entire files cold.
3. **For workspace-wide questions** — call \`#tokenslayer-structural-summary\` with \`scope: "workspace"\` for a project-level map before fanning out to individual files.

**Examples of when to call \`#tokenslayer-structural-summary\` first:**
- "How is authentication structured?"
- "Where is the cache invalidated?"
- "What does \`FooService\` expose?"
- "Show me the class hierarchy in \`src/auth/\`"
- "What modules import \`tokenEstimator\`?"

**Skip the tool only when:**
- You already have the exact file + line range from a previous turn.
- The file is under ~20 lines (skeleton overhead exceeds the savings).
- The user explicitly asked for the raw file.
${INSTRUCTIONS_END}`;

const MCP_SERVER_KEY = 'tokenslayer';

interface McpServerEntry {
  command: string;
  args: string[];
  type?: string;
}

interface McpConfig {
  servers?: Record<string, McpServerEntry>;
  inputs?: unknown[];
}

/**
 * Wire up GitHub Copilot to prefer TokenSlayer:
 *   1. Write/update `.github/copilot-instructions.md` with skeleton-first directives.
 *   2. Write/update `.vscode/mcp.json` to register the standalone MCP server for Copilot agent mode.
 *
 * Both operations are idempotent. The instructions file uses a managed-block delimiter
 * so re-runs only touch TokenSlayer's section, leaving any other user content alone.
 */
export async function wireUpCopilot(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('TokenSlayer: open a workspace folder before wiring up Copilot.');
    return;
  }

  const root = workspaceFolder.uri;
  const instructionsUri = vscode.Uri.joinPath(root, '.github', 'copilot-instructions.md');
  const mcpUri = vscode.Uri.joinPath(root, '.vscode', 'mcp.json');

  const mcpServerPath = path.join(context.extensionPath, 'mcp-server', 'build', 'index.js');

  const wroteInstructions = await writeInstructions(instructionsUri);
  const wroteMcp = await writeMcpConfig(mcpUri, mcpServerPath);

  const parts: string[] = [];
  if (wroteInstructions) { parts.push('.github/copilot-instructions.md'); }
  if (wroteMcp) { parts.push('.vscode/mcp.json'); }

  if (parts.length === 0) {
    vscode.window.showInformationMessage('TokenSlayer: Copilot wiring already up to date.');
    return;
  }

  const action = await vscode.window.showInformationMessage(
    `TokenSlayer: wired up Copilot — updated ${parts.join(' and ')}.`,
    'Open Instructions',
    'Open MCP Config'
  );
  if (action === 'Open Instructions') {
    await vscode.window.showTextDocument(instructionsUri);
  } else if (action === 'Open MCP Config') {
    await vscode.window.showTextDocument(mcpUri);
  }
}

async function writeInstructions(uri: vscode.Uri): Promise<boolean> {
  await ensureParent(uri);

  let existing = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    existing = new TextDecoder().decode(bytes);
  } catch {
    // File does not exist yet.
  }

  let next: string;
  if (existing.length === 0) {
    next = INSTRUCTIONS_BLOCK + '\n';
  } else if (existing.includes(INSTRUCTIONS_START) && existing.includes(INSTRUCTIONS_END)) {
    const before = existing.slice(0, existing.indexOf(INSTRUCTIONS_START));
    const after = existing.slice(existing.indexOf(INSTRUCTIONS_END) + INSTRUCTIONS_END.length);
    next = before + INSTRUCTIONS_BLOCK + after;
  } else {
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    next = existing + sep + INSTRUCTIONS_BLOCK + '\n';
  }

  if (next === existing) {
    return false;
  }

  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(next));
  return true;
}

async function writeMcpConfig(uri: vscode.Uri, serverPath: string): Promise<boolean> {
  await ensureParent(uri);

  let config: McpConfig = {};
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(bytes).trim();
    if (text.length > 0) {
      config = JSON.parse(text) as McpConfig;
    }
  } catch {
    // File does not exist or is invalid JSON — start fresh.
  }

  config.servers = config.servers || {};
  const desired: McpServerEntry = {
    type: 'stdio',
    command: 'node',
    args: [serverPath],
  };

  const current = config.servers[MCP_SERVER_KEY];
  const unchanged = current
    && current.command === desired.command
    && Array.isArray(current.args)
    && current.args.length === desired.args.length
    && current.args.every((a, i) => a === desired.args[i])
    && current.type === desired.type;

  if (unchanged) {
    return false;
  }

  config.servers[MCP_SERVER_KEY] = desired;
  const json = JSON.stringify(config, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(json));
  return true;
}

async function ensureParent(uri: vscode.Uri): Promise<void> {
  const parent = vscode.Uri.joinPath(uri, '..');
  try {
    await vscode.workspace.fs.createDirectory(parent);
  } catch {
    // Already exists.
  }
}
