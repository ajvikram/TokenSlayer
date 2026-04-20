#!/usr/bin/env node
/**
 * Zero-dependency MCP (Model Context Protocol) Bridge for TokenSlayer.
 * Allows IDEs like Cursor and Claude Desktop to connect via stdio
 * and fetch code skeletons from the active VS Code instance.
 */

const http = require('http');

// Read incoming JSON-RPC messages from stdin separated by newlines
const rl = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(response) {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id, code, message) {
  sendResponse({
    jsonrpc: '2.0',
    id,
    error: { code, message }
  });
}

// Fetch from the local TokenSlayer API running in VS Code
function fetchSkeleton(filePath) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:4733/analyze?path=${encodeURIComponent(filePath)}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Invalid JSON from TokenSlayer API'));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Failed to connect to TokenSlayer. Is VS Code open? (${err.message})`));
    });
  });
}

rl.on('line', async (line) => {
  if (!line.trim()) return;

  try {
    const message = JSON.parse(line);

    // Initialization
    if (message.method === 'initialize') {
      sendResponse({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'tokenslayer-mcp', version: '0.3.1' }
        }
      });
      return;
    }

    // List Tools
    if (message.method === 'tools/list') {
      sendResponse({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [
            {
              name: 'get_structural_skeleton',
              description: 'Fetch a highly compacted AST structural skeleton of a file to save LLM tokens. Use this instead of reading massive raw files when you only need architectural context.',
              inputSchema: {
                type: 'object',
                properties: {
                  filePath: {
                    type: 'string',
                    description: 'Absolute path to the file to analyze'
                  }
                },
                required: ['filePath']
              }
            }
          ]
        }
      });
      return;
    }

    // Call Tool
    if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params || {};
      
      if (name === 'get_structural_skeleton') {
        if (!args || !args.filePath) {
          sendError(message.id, -32602, 'Missing filePath argument');
          return;
        }

        try {
          const result = await fetchSkeleton(args.filePath);
          
          if (!result.success) {
            sendResponse({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              }
            });
            return;
          }

          const savings = result.stats;
          const textResponse = `[TokenSlayer Saved ${savings.reductionPercent}% (${savings.originalTokens} -> ${savings.compactedTokens} tokens)]\n\n${result.skeleton}`;

          sendResponse({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [{ type: 'text', text: textResponse }]
            }
          });
        } catch (err) {
          sendResponse({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [{ type: 'text', text: `Failed: ${err.message}` }],
              isError: true
            }
          });
        }
      } else {
        sendError(message.id, -32601, 'Tool not found');
      }
      return;
    }

    // Standard Notifications (just ignore)
    if (message.method === 'notifications/initialized' || message.method === 'ping') {
      return;
    }

    // If it's a ping request with an ID
    if (message.method === 'ping' && message.id) {
       sendResponse({ jsonrpc: '2.0', id: message.id, result: {} });
       return;
    }

    // Unknown method
    if (message.id) {
      sendError(message.id, -32601, `Method not found: ${message.method}`);
    }

  } catch (err) {
    // Cannot send error if we couldn't parse the JSON (no ID)
  }
});
