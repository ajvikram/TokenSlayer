/**
 * Pure call-graph traversal and formatting.
 *
 * The deterministic, zero-LLM answer to "what calls X?" and "what breaks if I
 * change X?". grep can't answer these — a text match for `foo(` is not the same
 * as the call graph (overloads, re-exports, methods sharing a name, dynamic
 * dispatch). This module owns the graph logic so it can be unit-tested against a
 * fake edge source; the VS Code call-hierarchy API is adapted into CallEdgeSource
 * by the LM tool.
 */

export interface CallNode {
  name: string;
  /** Absolute file path. */
  file: string;
  /** 1-based line. */
  line: number;
}

export interface CallEdgeSource {
  /** Direct callers of node (incoming edges). */
  incoming(node: CallNode): Promise<CallNode[]>;
  /** Direct callees of node (outgoing edges). */
  outgoing(node: CallNode): Promise<CallNode[]>;
}

export interface RankedNode {
  node: CallNode;
  depth: number;
}

const key = (n: CallNode): string => `${n.file}:${n.line}:${n.name}`;

/**
 * Breadth-first transitive callers up to maxDepth, deduped, capped at maxNodes.
 * Cycle-safe (a visited set), and the root itself is never included. Returned in
 * BFS order so nearest callers (most directly affected) come first.
 */
export async function transitiveCallers(
  root: CallNode,
  src: CallEdgeSource,
  maxDepth: number,
  maxNodes = 100,
): Promise<RankedNode[]> {
  const visited = new Set<string>([key(root)]);
  const out: RankedNode[] = [];
  let frontier: CallNode[] = [root];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: CallNode[] = [];
    for (const node of frontier) {
      const callers = await src.incoming(node);
      for (const c of callers) {
        const k = key(c);
        if (visited.has(k)) { continue; }
        visited.add(k);
        out.push({ node: c, depth });
        next.push(c);
        if (out.length >= maxNodes) { return out; }
      }
    }
    frontier = next;
  }
  return out;
}

function loc(n: CallNode): string {
  // Show a workspace-relative-ish tail; the tool passes already-shortened paths.
  return `${n.file}:${n.line}`;
}

export function formatCallers(root: CallNode, callers: CallNode[]): string {
  if (callers.length === 0) {
    return `No callers found for ${root.name} — it may be an entry point, exported for external use, dead code, or only called dynamically.`;
  }
  const lines = callers.map((c) => `  - ${c.name} (${loc(c)})`);
  return `${root.name} is called by ${callers.length} site(s):\n${lines.join('\n')}`;
}

export function formatCallees(root: CallNode, callees: CallNode[]): string {
  if (callees.length === 0) {
    return `${root.name} calls no other tracked functions (it may only use built-ins or external libraries).`;
  }
  const lines = callees.map((c) => `  - ${c.name} (${loc(c)})`);
  return `${root.name} calls ${callees.length} function(s):\n${lines.join('\n')}`;
}

export function formatImpact(root: CallNode, ranked: RankedNode[]): string {
  if (ranked.length === 0) {
    return `Changing ${root.name} has no tracked callers — impact appears local to itself.`;
  }
  const byDepth = new Map<number, CallNode[]>();
  for (const r of ranked) {
    (byDepth.get(r.depth) ?? byDepth.set(r.depth, []).get(r.depth)!).push(r.node);
  }
  const sections: string[] = [
    `Changing ${root.name} could affect ${ranked.length} dependent site(s):`,
  ];
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const label = depth === 1 ? 'direct callers' : `depth ${depth} (indirect)`;
    const nodes = byDepth.get(depth)!;
    sections.push(`  ${label}:`);
    for (const n of nodes) { sections.push(`    - ${n.name} (${loc(n)})`); }
  }
  return sections.join('\n');
}
