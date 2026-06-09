#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { analyzeFile, getLanguage, extractSymbol, scoreRelevance, pruneToFit, tagPrunedNodes, tagAllNodes, expandNode, optimizeLayout, tokenize, buildDependencyChain, applyPatches, } from "./parser.js";
import { recordStats, readStats, aggregate, formatMarkdown, formatTerminal, clearStats, getStatsFilePath, } from "./stats.js";
import { startDashboard } from "./dashboard.js";
import * as fs from 'fs';
import * as path from 'path';
/**
 * TokenSlayer Standalone MCP Server
 */
class TokenSlayerServer {
    server;
    constructor() {
        this.server = new Server({
            name: "tokenslayer-mcp-server",
            version: "3.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        // Error handling
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "analyze_files",
                    description: "Analyze file paths to extract high-density structural skeletons. Supports symbol-level addressing, query ranking, budget constraints, JSON output, and expandable node IDs.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePaths: {
                                type: "array",
                                items: { type: "string" },
                                description: "Array of absolute file paths to analyze."
                            },
                            symbol: {
                                type: "string",
                                description: "Optional. Extract only the named symbol (class, function, struct, etc.) from each file."
                            },
                            query: {
                                type: "string",
                                description: "Optional. Rank results by relevance to this query. Most relevant files appear first."
                            },
                            maxTokens: {
                                type: "number",
                                description: "Optional. Token budget — progressively prune skeletons to fit within this limit."
                            },
                            format: {
                                type: "string",
                                enum: ["text", "json"],
                                description: "Output format. 'text' (default) returns readable skeletons. 'json' returns structured data."
                            },
                            expandable: {
                                type: "boolean",
                                description: "If true, pruned blocks are tagged with node IDs that can be expanded via expand_node."
                            },
                            targetModel: {
                                type: "string",
                                enum: ["gpt-4o", "gpt-4", "claude"],
                                description: "Optional. Use a real BPE tokenizer for the target model for accurate token counting and layout optimization."
                            }
                        },
                        required: ["filePaths"]
                    }
                },
                {
                    name: "analyze_workspace",
                    description: "Map an entire workspace directory. Recursively finds supported files and returns structural skeletons. Supports query-based ranking to surface the most relevant files first.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            directoryPath: {
                                type: "string",
                                description: "Absolute path to the directory to scan."
                            },
                            query: {
                                type: "string",
                                description: "Optional. Rank files by relevance to this query — most relevant files appear first."
                            },
                            maxTokens: {
                                type: "number",
                                description: "Optional. Total token budget for the entire workspace output."
                            },
                            format: {
                                type: "string",
                                enum: ["text", "json"],
                                description: "Output format. 'text' (default) or 'json' for structured data."
                            },
                            maxFiles: {
                                type: "number",
                                description: "Maximum files to analyze (default 100)."
                            },
                            targetModel: {
                                type: "string",
                                enum: ["gpt-4o", "gpt-4", "claude"],
                                description: "Optional. Use a real BPE tokenizer for accurate token counting and layout optimization."
                            }
                        },
                        required: ["directoryPath"]
                    }
                },
                {
                    name: "analyze_dependency_chain",
                    description: "Follow imports from a seed file to build a merged skeleton of the dependency chain. Traverses local (relative) imports via BFS up to the specified depth.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            seedFile: {
                                type: "string",
                                description: "Absolute path to the entry-point file."
                            },
                            depth: {
                                type: "number",
                                description: "How many levels of imports to follow (default 2, max 5)."
                            },
                            query: {
                                type: "string",
                                description: "Optional. Rank results by relevance to this query."
                            },
                            maxTokens: {
                                type: "number",
                                description: "Optional. Token budget for the entire merged output."
                            },
                            format: {
                                type: "string",
                                enum: ["text", "json"],
                                description: "Output format. 'text' (default) or 'json'."
                            },
                            expandable: {
                                type: "boolean",
                                description: "If true, tag pruned blocks with expandable node IDs."
                            },
                            targetModel: {
                                type: "string",
                                enum: ["gpt-4o", "gpt-4", "claude"],
                                description: "Optional. Use a real BPE tokenizer for accurate token counting."
                            }
                        },
                        required: ["seedFile"]
                    }
                },
                {
                    name: "apply_patch",
                    description: "Apply structural patches to source files using node IDs from skeletons. Returns a unified diff showing the changes. Default is dry-run (no writes).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            patches: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        nodeId: { type: "string", description: "Node ID from a /* NODE:... */ or /* EXPAND:... */ tag." },
                                        action: { type: "string", enum: ["replace", "insert_after", "delete"], description: "Patch action." },
                                        content: { type: "string", description: "New content (required for replace and insert_after)." }
                                    },
                                    required: ["nodeId", "action"]
                                },
                                description: "Array of patches to apply (max 10)."
                            },
                            dryRun: {
                                type: "boolean",
                                description: "If true (default), return the diff without writing files."
                            }
                        },
                        required: ["patches"]
                    }
                },
                {
                    name: "expand_node",
                    description: "Expand a pruned AST node to reveal its full source code. Use this when a skeleton contains a /* EXPAND:nodeId */ tag and you need to see the implementation details of that specific function or block.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            nodeId: {
                                type: "string",
                                description: "The node ID from a /* EXPAND:nodeId */ tag in a skeleton."
                            }
                        },
                        required: ["nodeId"]
                    }
                },
                {
                    name: "get_stats",
                    description: "Return cumulative TokenSlayer savings statistics across all MCP calls (total tokens saved, cost estimate, reduction %, language breakdown, timeline, top files).",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    }
                },
                {
                    name: "clear_stats",
                    description: "Reset the TokenSlayer stats file, deleting all historical savings records. Only use when the user explicitly asks to clear or reset stats.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    }
                }
            ]
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const args = request.params.arguments ?? {};
            if (request.params.name === "analyze_files") {
                const filePaths = args.filePaths;
                if (!Array.isArray(filePaths)) {
                    throw new Error("filePaths array is required");
                }
                const symbol = args.symbol;
                const query = args.query;
                const maxTokens = args.maxTokens;
                const format = args.format || 'text';
                const expandable = args.expandable;
                const targetModel = args.targetModel;
                let results = filePaths.map(p => analyzeFile(p));
                if (symbol) {
                    results = results.map(r => {
                        if (r.error)
                            return r;
                        r.skeleton = extractSymbol(r.skeleton, symbol);
                        r.compactedTokens = tokenize(r.skeleton, targetModel);
                        return r;
                    });
                }
                if (expandable) {
                    results = results.map(r => {
                        if (r.error)
                            return r;
                        try {
                            const content = fs.readFileSync(r.filePath, 'utf-8');
                            r.skeleton = tagAllNodes(tagPrunedNodes(r.skeleton, r.filePath, content), r.filePath, content);
                        }
                        catch { /* ignore */ }
                        return r;
                    });
                }
                if (targetModel) {
                    results = results.map(r => {
                        if (r.error)
                            return r;
                        r.skeleton = optimizeLayout(r.skeleton, targetModel);
                        r.compactedTokens = tokenize(r.skeleton, targetModel);
                        return r;
                    });
                }
                if (query) {
                    results.sort((a, b) => scoreRelevance(b.skeleton, b.filePath, query) -
                        scoreRelevance(a.skeleton, a.filePath, query));
                }
                return this.formatResults(results, "analyze_files", format, maxTokens, targetModel);
            }
            if (request.params.name === "analyze_workspace") {
                const directoryPath = args.directoryPath;
                if (!directoryPath || typeof directoryPath !== 'string') {
                    throw new Error("directoryPath is required");
                }
                const query = args.query;
                const maxTokens = args.maxTokens;
                const format = args.format || 'text';
                const maxFiles = args.maxFiles || 100;
                const targetModel = args.targetModel;
                const files = this.findSupportedFiles(directoryPath);
                let results = files.slice(0, maxFiles).map(p => analyzeFile(p));
                if (targetModel) {
                    results = results.map(r => {
                        if (r.error)
                            return r;
                        r.skeleton = optimizeLayout(r.skeleton, targetModel);
                        r.compactedTokens = tokenize(r.skeleton, targetModel);
                        return r;
                    });
                }
                if (query) {
                    results.sort((a, b) => scoreRelevance(b.skeleton, b.filePath, query) -
                        scoreRelevance(a.skeleton, a.filePath, query));
                }
                return this.formatResults(results, "analyze_workspace", format, maxTokens, targetModel);
            }
            if (request.params.name === "expand_node") {
                const nodeId = args.nodeId;
                if (!nodeId)
                    throw new Error("nodeId is required");
                const result = expandNode(nodeId);
                if (!result) {
                    return { content: [{ type: "text", text: "❌ Could not expand node — file may have been modified since analysis." }] };
                }
                return {
                    content: [{ type: "text", text: `// ${path.basename(result.filePath)} lines ${result.startLine}–${result.endLine}\n\n${result.content}` }]
                };
            }
            if (request.params.name === "analyze_dependency_chain") {
                const seedFile = args.seedFile;
                if (!seedFile)
                    throw new Error("seedFile is required");
                const depth = Math.min(args.depth || 2, 5);
                const query = args.query;
                const maxTokens = args.maxTokens;
                const format = args.format || 'text';
                const expandable = args.expandable;
                const targetModel = args.targetModel;
                let results = buildDependencyChain(seedFile, depth);
                if (expandable) {
                    results = results.map(r => {
                        if (r.error)
                            return r;
                        try {
                            const content = fs.readFileSync(r.filePath, 'utf-8');
                            r.skeleton = tagAllNodes(tagPrunedNodes(r.skeleton, r.filePath, content), r.filePath, content);
                        }
                        catch { /* ignore */ }
                        return r;
                    });
                }
                if (targetModel) {
                    results = results.map(r => {
                        if (r.error)
                            return r;
                        r.skeleton = optimizeLayout(r.skeleton, targetModel);
                        r.compactedTokens = tokenize(r.skeleton, targetModel);
                        return r;
                    });
                }
                if (query) {
                    results.sort((a, b) => scoreRelevance(b.skeleton, b.filePath, query) -
                        scoreRelevance(a.skeleton, a.filePath, query));
                }
                return this.formatResults(results, "analyze_dependency_chain", format, maxTokens, targetModel);
            }
            if (request.params.name === "apply_patch") {
                const patches = args.patches;
                if (!Array.isArray(patches) || patches.length === 0) {
                    throw new Error("patches array is required and must not be empty");
                }
                const dryRun = args.dryRun !== false;
                const results = applyPatches(patches, dryRun);
                if (results.length === 0) {
                    return { content: [{ type: "text", text: "❌ No patches could be applied — node IDs may be invalid or files may have changed." }] };
                }
                const output = results.map(r => {
                    const header = dryRun ? `// DRY RUN — ${path.basename(r.filePath)} (no files modified)` : `// APPLIED — ${path.basename(r.filePath)}`;
                    return `${header}\n\n${r.diff}`;
                }).join('\n\n---\n\n');
                return { content: [{ type: "text", text: output }] };
            }
            if (request.params.name === "get_stats") {
                const agg = aggregate(readStats());
                return {
                    content: [{ type: "text", text: formatMarkdown(agg) }]
                };
            }
            if (request.params.name === "clear_stats") {
                clearStats();
                return {
                    content: [{ type: "text", text: "✅ TokenSlayer stats cleared." }]
                };
            }
            throw new Error(`Unknown tool: ${request.params.name}`);
        });
    }
    findSupportedFiles(dir, files = []) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!['node_modules', '.git', 'dist', 'out', 'build', '__pycache__', 'venv', '.venv', 'vendor', 'target', 'coverage', '.next', '.nuxt'].includes(entry.name)) {
                        this.findSupportedFiles(fullPath, files);
                    }
                }
                else {
                    if (getLanguage(fullPath) !== 'unknown') {
                        files.push(fullPath);
                    }
                }
            }
        }
        catch (e) {
            // ignore read errors
        }
        return files;
    }
    formatResults(results, tool, format = 'text', maxTokens, targetModel) {
        let totalOriginal = 0;
        let totalCompacted = 0;
        const successful = [];
        const jsonResults = [];
        for (const r of results) {
            if (r.error) {
                jsonResults.push({ filePath: r.filePath, error: r.error });
                continue;
            }
            totalOriginal += r.originalTokens;
            totalCompacted += r.compactedTokens;
            const language = getLanguage(r.filePath);
            successful.push({
                filePath: r.filePath,
                language,
                originalTokens: r.originalTokens,
                compactedTokens: r.compactedTokens,
            });
            jsonResults.push({
                filePath: r.filePath,
                language,
                originalTokens: r.originalTokens,
                compactedTokens: r.compactedTokens,
                reductionPercent: r.reductionPercent,
                skeleton: r.skeleton,
            });
        }
        recordStats(successful, tool);
        const totalSaved = totalOriginal > 0
            ? Math.round(((totalOriginal - totalCompacted) / totalOriginal) * 100)
            : 0;
        if (format === 'json') {
            const payload = {
                summary: { totalOriginalTokens: totalOriginal, totalCompactedTokens: totalCompacted, reductionPercent: totalSaved, filesAnalyzed: results.length },
                files: jsonResults,
            };
            return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
        }
        let contents = results.map(r => r.error ? `[Error] ${r.filePath}: ${r.error}` : r.skeleton).join('\n\n---\n\n');
        if (maxTokens) {
            contents = pruneToFit(contents, maxTokens, targetModel);
        }
        const text = `📊 Session Stats: Saved ${totalSaved}% tokens (${totalOriginal} -> ${totalCompacted})\n\n${contents}`;
        return {
            content: [{ type: "text", text }]
        };
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
}
function parseArg(flag) {
    const args = process.argv.slice(2);
    const exact = args.indexOf(flag);
    if (exact !== -1 && args[exact + 1] && !args[exact + 1].startsWith('-')) {
        return args[exact + 1];
    }
    const prefixed = args.find(a => a.startsWith(flag + '='));
    if (prefixed)
        return prefixed.slice(flag.length + 1);
    return undefined;
}
function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`⚡ TokenSlayer MCP Server

Usage:
  node build/index.js                 Run as stdio MCP server (default)
  node build/index.js --stats         Print cumulative savings to terminal and exit
  node build/index.js --dashboard     Start local HTML dashboard (default port 4734)
  node build/index.js --dashboard --port=4735
  node build/index.js --clear-stats   Delete the stats file
  node build/index.js --stats-file    Print the stats file path

Stats file: ${getStatsFilePath()}
`);
        process.exit(0);
    }
    if (args.includes('--stats-file')) {
        console.log(getStatsFilePath());
        process.exit(0);
    }
    if (args.includes('--clear-stats')) {
        clearStats();
        console.log('✅ TokenSlayer stats cleared.');
        process.exit(0);
    }
    if (args.includes('--stats')) {
        const agg = aggregate(readStats());
        console.log(formatTerminal(agg));
        process.exit(0);
    }
    if (args.includes('--dashboard')) {
        const portArg = parseArg('--port');
        const port = portArg ? parseInt(portArg, 10) : 4734;
        if (Number.isNaN(port)) {
            console.error('Invalid --port value');
            process.exit(1);
        }
        startDashboard(port);
        return;
    }
    // Default: stdio MCP server
    const server = new TokenSlayerServer();
    server.run().catch(console.error);
}
main();
