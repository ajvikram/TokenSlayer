import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Counts GitHub Copilot chat requests for the current workspace by parsing the
 * chat session logs VS Code persists under
 * `<app-data>/Code/User/workspaceStorage/<hash>/chatSessions/`.
 *
 * VS Code exposes no API for Copilot usage, but the session files are local
 * ground truth for "how many chat requests were sent in this workspace". Each
 * `.jsonl` file is an op-log: line one is `{kind: 0, v: <session snapshot>}`,
 * then `{kind: 1, k: [path...], v}` set-operations and `{kind: 2, k: [path...], v}`
 * array-appends (new requests arrive as kind-2 appends to `['requests']`, with
 * `v` being a list of request items). Older VS Code versions wrote plain
 * `.json` session objects; both are handled.
 *
 * Caveats (documented in the dashboard): this counts chat/agent requests made
 * from this machine + workspace. It is not GitHub's billed premium-request
 * meter (no model multipliers, no other devices, no inline completions), and
 * deleting a chat session removes its history.
 */

export interface CopilotModelRequests {
  model: string;
  requests: number;
}

export interface CopilotMonthlyRequests {
  /** Calendar month key, `YYYY-MM`. */
  month: string;
  requests: number;
  models: CopilotModelRequests[];
}

export interface CopilotUsage {
  totalRequests: number;
  /** Newest month first — subscriptions and premium-request budgets roll monthly. */
  byMonth: CopilotMonthlyRequests[];
  byModel: CopilotModelRequests[];
  /** Sessions with at least one request. */
  sessionCount: number;
  /** Epoch ms of the most recent request, or null. */
  lastActivity: number | null;
  /** False when no VS Code workspace-storage folder matches this workspace. */
  available: boolean;
}

interface RequestItem {
  timestamp: number | null;
  model: string;
}

interface FileCacheEntry {
  size: number;
  mtimeMs: number;
  items: RequestItem[];
}

/** Where VS Code variants keep `User/workspaceStorage` on this platform. */
export function defaultStorageRoots(platform: NodeJS.Platform = process.platform): string[] {
  const home = os.homedir();
  let base: string;
  if (platform === 'darwin') {
    base = path.join(home, 'Library', 'Application Support');
  } else if (platform === 'win32') {
    base = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  } else {
    base = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  }
  return ['Code', 'Code - Insiders', 'VSCodium'].map((variant) =>
    path.join(base, variant, 'User', 'workspaceStorage'),
  );
}

function normalizeFsPath(p: string): string {
  // macOS and Windows file systems are case-insensitive by default.
  const resolved = path.resolve(p).replace(/[/\\]+$/, '');
  return process.platform === 'linux' ? resolved : resolved.toLowerCase();
}

/** Decode the `folder` URI from a workspace.json into a normalized fs path. */
function folderUriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) {
    return null;
  }
  try {
    let p = decodeURIComponent(uri.slice('file://'.length));
    // Windows URIs look like file:///c%3A/...; strip the leading slash.
    if (/^\/[a-zA-Z]:/.test(p)) {
      p = p.slice(1);
    }
    return normalizeFsPath(p);
  } catch {
    return null;
  }
}

/**
 * Find every `chatSessions` directory whose workspace-storage folder points at
 * the given workspace root. Exposed for tests via injectable storage roots.
 */
export function findChatSessionDirs(
  workspaceRoot: string,
  storageRoots: string[] = defaultStorageRoots(),
): string[] {
  const wanted = normalizeFsPath(workspaceRoot);
  const found: string[] = [];
  for (const root of storageRoots) {
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const metaPath = path.join(root, entry, 'workspace.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const folder = typeof meta?.folder === 'string' ? folderUriToPath(meta.folder) : null;
        if (folder === wanted) {
          found.push(path.join(root, entry, 'chatSessions'));
        }
      } catch {
        continue;
      }
    }
  }
  return found;
}

function nodeAtParent(target: any, keys: (string | number)[]): any {
  let node = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (node[key] === null || typeof node[key] !== 'object') {
      node[key] = typeof keys[i + 1] === 'number' ? [] : {};
    }
    node = node[key];
  }
  return node;
}

/** Apply one `{kind: 1, k: [path...], v}` set-operation onto the session object. */
function setPath(target: any, keys: (string | number)[], value: unknown): void {
  nodeAtParent(target, keys)[keys[keys.length - 1]] = value;
}

/** Apply one `{kind: 2, k: [path...], v}` append: push v's items onto the array at k. */
function appendPath(target: any, keys: (string | number)[], value: unknown): void {
  const parent = nodeAtParent(target, keys);
  const last = keys[keys.length - 1];
  if (!Array.isArray(parent[last])) {
    parent[last] = [];
  }
  if (Array.isArray(value)) {
    parent[last].push(...value);
  } else {
    parent[last].push(value);
  }
}

/** Bounded search for a `modelId` string anywhere shallow in a request item. */
function findModelId(node: unknown, depth = 0): string | undefined {
  if (!node || typeof node !== 'object' || depth > 3) {
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.modelId === 'string') {
    return obj.modelId;
  }
  for (const value of Object.values(obj)) {
    const hit = findModelId(value, depth + 1);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

/**
 * Replay a chat-session log (`.jsonl` op-log or legacy `.json` snapshot) into
 * the list of requests. Exposed for tests.
 */
export function parseChatSessionText(text: string): { requests: unknown[]; creationDate: number | null } {
  const trimmed = text.trim();
  let session: any = {};

  if (trimmed.startsWith('{') && !trimmed.includes('\n')) {
    // Could be a one-line op-log or a legacy single-object .json file.
    try {
      const parsed = JSON.parse(trimmed);
      session = parsed?.kind === 0 ? parsed.v ?? {} : parsed;
    } catch {
      return { requests: [], creationDate: null };
    }
  } else {
    for (const line of text.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      let op: any;
      try {
        op = JSON.parse(line);
      } catch {
        continue;
      }
      if (op?.kind === 0 && op.v && typeof op.v === 'object') {
        session = op.v;
      } else if (op?.kind === 1 && Array.isArray(op.k) && op.k.length > 0) {
        setPath(session, op.k, op.v);
      } else if (op?.kind === 2 && Array.isArray(op.k) && op.k.length > 0) {
        appendPath(session, op.k, op.v);
      }
      // Other kinds (if any) are ignored — request counting needs sets + appends.
    }
  }

  const requests = Array.isArray(session.requests) ? session.requests : [];
  const creationDate = typeof session.creationDate === 'number' ? session.creationDate : null;
  return { requests, creationDate };
}

function extractItems(text: string, fileMtimeMs: number): RequestItem[] {
  const { requests, creationDate } = parseChatSessionText(text);
  const items: RequestItem[] = [];
  for (const r of requests) {
    // Skip null/empty placeholders left by sparse op replays.
    if (!r || typeof r !== 'object' || Object.keys(r as object).length === 0) {
      continue;
    }
    const req = r as Record<string, unknown>;
    const ts = typeof req.timestamp === 'number' ? req.timestamp : creationDate ?? fileMtimeMs;
    items.push({
      timestamp: ts,
      model: findModelId(req) ?? 'unknown',
    });
  }
  return items;
}

function monthKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export class CopilotUsageTracker {
  private fileCache = new Map<string, FileCacheEntry>();
  private dirCache = new Map<string, string[]>();

  constructor(private readonly storageRoots?: string[]) {}

  /**
   * Aggregate Copilot chat requests across every session log for the
   * workspace. Re-parses only files whose size/mtime changed, so the
   * dashboard's 5s polling stays cheap.
   */
  getUsage(workspaceRoot: string): CopilotUsage {
    let dirs = this.dirCache.get(workspaceRoot);
    if (!dirs) {
      dirs = findChatSessionDirs(workspaceRoot, this.storageRoots ?? defaultStorageRoots());
      this.dirCache.set(workspaceRoot, dirs);
    }
    if (dirs.length === 0) {
      return {
        totalRequests: 0, byMonth: [], byModel: [],
        sessionCount: 0, lastActivity: null, available: false,
      };
    }

    const byMonthModel = new Map<string, Map<string, number>>();
    const byModel = new Map<string, number>();
    let total = 0;
    let sessionCount = 0;
    let lastActivity: number | null = null;

    for (const dir of dirs) {
      let names: string[];
      try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl') || n.endsWith('.json'));
      } catch {
        continue;
      }
      for (const name of names) {
        const filePath = path.join(dir, name);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        let entry = this.fileCache.get(filePath);
        if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
          let text: string;
          try {
            text = fs.readFileSync(filePath, 'utf8');
          } catch {
            continue;
          }
          entry = { size: stat.size, mtimeMs: stat.mtimeMs, items: extractItems(text, stat.mtimeMs) };
          this.fileCache.set(filePath, entry);
        }
        if (entry.items.length > 0) {
          sessionCount++;
        }
        for (const item of entry.items) {
          total++;
          byModel.set(item.model, (byModel.get(item.model) ?? 0) + 1);
          if (item.timestamp !== null) {
            if (lastActivity === null || item.timestamp > lastActivity) {
              lastActivity = item.timestamp;
            }
            const mk = monthKey(item.timestamp);
            const bucket = byMonthModel.get(mk) ?? new Map<string, number>();
            bucket.set(item.model, (bucket.get(item.model) ?? 0) + 1);
            byMonthModel.set(mk, bucket);
          }
        }
      }
    }

    const byMonth: CopilotMonthlyRequests[] = [...byMonthModel.entries()]
      .map(([month, models]) => ({
        month,
        requests: [...models.values()].reduce((s, n) => s + n, 0),
        models: [...models.entries()]
          .map(([model, requests]) => ({ model, requests }))
          .sort((a, b) => b.requests - a.requests),
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    return {
      totalRequests: total,
      byMonth,
      byModel: [...byModel.entries()]
        .map(([model, requests]) => ({ model, requests }))
        .sort((a, b) => b.requests - a.requests),
      sessionCount,
      lastActivity,
      available: true,
    };
  }
}
