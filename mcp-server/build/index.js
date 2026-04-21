#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { analyzeFile, getLanguage } from "./parser.js";
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
            version: "1.0.0",
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
                    description: "Analyze an array of file paths to extract high-density structural skeletons. Use this to save tokens when you need to understand multiple files.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filePaths: {
                                type: "array",
                                items: { type: "string" },
                                description: "Array of absolute file paths to analyze."
                            }
                        },
                        required: ["filePaths"]
                    }
                },
                {
                    name: "analyze_workspace",
                    description: "Map an entire workspace directory. Recursively finds all supported files and returns their structural skeletons. Limits to 100 files to prevent token overflow.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            directoryPath: {
                                type: "string",
                                description: "Absolute path to the directory to scan."
                            }
                        },
                        required: ["directoryPath"]
                    }
                }
            ]
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (request.params.name === "analyze_files") {
                const filePaths = request.params.arguments?.filePaths;
                if (!Array.isArray(filePaths)) {
                    throw new Error("filePaths array is required");
                }
                const results = filePaths.map(p => analyzeFile(p));
                return this.formatResults(results);
            }
            if (request.params.name === "analyze_workspace") {
                const directoryPath = request.params.arguments?.directoryPath;
                if (!directoryPath || typeof directoryPath !== 'string') {
                    throw new Error("directoryPath is required");
                }
                const files = this.findSupportedFiles(directoryPath);
                const results = files.slice(0, 100).map(p => analyzeFile(p));
                return this.formatResults(results);
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
                    if (!['node_modules', '.git', 'dist', 'out', '__pycache__', 'venv'].includes(entry.name)) {
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
    formatResults(results) {
        let totalSaved = 0;
        let totalOriginal = 0;
        let totalCompacted = 0;
        const contents = results.map(r => {
            if (r.error) {
                return `[Error] ${r.filePath}: ${r.error}`;
            }
            totalOriginal += r.originalTokens;
            totalCompacted += r.compactedTokens;
            return r.skeleton;
        }).join('\n\n---\n\n');
        if (totalOriginal > 0) {
            totalSaved = Math.round(((totalOriginal - totalCompacted) / totalOriginal) * 100);
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
const server = new TokenSlayerServer();
server.run().catch(console.error);
