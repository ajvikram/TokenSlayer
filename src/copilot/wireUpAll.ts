import * as vscode from 'vscode';
import * as path from 'path';

const MCP_SERVER_KEY = 'tokenslayer';

export interface ToolDefinition {
  id: string;
  label: string;
  configPath: string;
}

export const SUPPORTED_TOOLS: ToolDefinition[] = [
  { id: 'cursor',      label: 'Cursor',      configPath: '.cursor/mcp.json' },
  { id: 'cline',       label: 'Cline',       configPath: '.cline/mcp_settings.json' },
  { id: 'continue',    label: 'Continue',     configPath: '.continue/config.json' },
  { id: 'windsurf',    label: 'Windsurf',     configPath: '.windsurf/mcp.json' },
  { id: 'claude-code', label: 'Claude Code',  configPath: '.claude/settings.local.json' },
];

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Wire up a non-Copilot AI tool by writing/merging MCP server config
 * into the tool's project-level configuration file.
 *
 * Idempotent: merges with existing config and only writes when something changed.
 */
export async function wireUpTool(tool: string, workspaceRoot: string): Promise<void> {
  const def = SUPPORTED_TOOLS.find(t => t.id === tool);
  if (!def) {
    vscode.window.showWarningMessage(`TokenSlayer: unknown tool "${tool}".`);
    return;
  }

  const rootUri = vscode.Uri.file(workspaceRoot);
  const configUri = vscode.Uri.joinPath(rootUri, def.configPath);
  const serverPath = path.join(workspaceRoot, 'mcp-server', 'build', 'index.js');

  let wrote: boolean;
  switch (def.id) {
    case 'continue':
      wrote = await writeContinueConfig(configUri, serverPath);
      break;
    default:
      wrote = await writeMcpServersConfig(configUri, serverPath);
      break;
  }

  if (!wrote) {
    vscode.window.showInformationMessage(
      `TokenSlayer: ${def.label} config already up to date.`
    );
    return;
  }

  const action = await vscode.window.showInformationMessage(
    `TokenSlayer: wired up ${def.label} — updated ${def.configPath}.`,
    'Open Config'
  );
  if (action === 'Open Config') {
    await vscode.window.showTextDocument(configUri);
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

async function ensureParent(uri: vscode.Uri): Promise<void> {
  const parent = vscode.Uri.joinPath(uri, '..');
  try {
    await vscode.workspace.fs.createDirectory(parent);
  } catch {
    // Already exists.
  }
}

async function readJsonFile(uri: vscode.Uri): Promise<Record<string, unknown>> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(bytes).trim();
    if (text.length > 0) {
      return JSON.parse(text) as Record<string, unknown>;
    }
  } catch {
    // File does not exist or is invalid JSON — start fresh.
  }
  return {};
}

async function writeJsonFile(uri: vscode.Uri, data: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(data, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(json));
}

function buildServerEntry(serverPath: string): McpServerEntry {
  return { command: 'node', args: [serverPath], env: {} };
}

function serverEntryMatches(
  existing: McpServerEntry | undefined,
  desired: McpServerEntry,
): boolean {
  if (!existing) { return false; }
  return (
    existing.command === desired.command &&
    Array.isArray(existing.args) &&
    existing.args.length === desired.args.length &&
    existing.args.every((a, i) => a === desired.args[i])
  );
}

// ── Format: mcpServers object (Cursor, Cline, Windsurf, Claude Code) ──────

async function writeMcpServersConfig(
  uri: vscode.Uri,
  serverPath: string,
): Promise<boolean> {
  await ensureParent(uri);
  const config = await readJsonFile(uri);

  const servers = (config.mcpServers ?? {}) as Record<string, McpServerEntry>;
  const desired = buildServerEntry(serverPath);

  if (serverEntryMatches(servers[MCP_SERVER_KEY], desired)) {
    return false;
  }

  servers[MCP_SERVER_KEY] = desired;
  config.mcpServers = servers;
  await writeJsonFile(uri, config);
  return true;
}

// ── Format: mcpServers array (Continue) ──────────────────────────────────

interface ContinueServerEntry extends McpServerEntry {
  name: string;
}

async function writeContinueConfig(
  uri: vscode.Uri,
  serverPath: string,
): Promise<boolean> {
  await ensureParent(uri);
  const config = await readJsonFile(uri);

  if (!Array.isArray(config.mcpServers)) {
    config.mcpServers = [];
  }

  const list = config.mcpServers as ContinueServerEntry[];
  const desired = buildServerEntry(serverPath);
  const existingIdx = list.findIndex(s => s.name === MCP_SERVER_KEY);

  if (existingIdx >= 0 && serverEntryMatches(list[existingIdx], desired)) {
    return false;
  }

  const entry: ContinueServerEntry = { name: MCP_SERVER_KEY, ...desired };

  if (existingIdx >= 0) {
    list[existingIdx] = entry;
  } else {
    list.push(entry);
  }

  config.mcpServers = list;
  await writeJsonFile(uri, config);
  return true;
}
