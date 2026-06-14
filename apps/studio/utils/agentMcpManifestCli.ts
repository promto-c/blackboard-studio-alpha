#!/usr/bin/env node
import { createAgentMcpToolManifest } from './agentToolRegistry.ts';

type JsonRpcRequest = {
  id?: string | number | null;
  method?: string;
};

const manifest = createAgentMcpToolManifest();

const writeJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const writeJsonRpc = (id: JsonRpcRequest['id'], result: unknown) => {
  writeJson({
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  });
};

const writeJsonRpcError = (id: JsonRpcRequest['id'], code: number, message: string) => {
  writeJson({
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
    },
  });
};

const handleJsonRpcRequest = (request: JsonRpcRequest) => {
  if (request.method === 'initialize') {
    writeJsonRpc(request.id, {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'blackboard-studio-agent-tools',
        version: '0.1.0',
      },
      capabilities: {
        tools: {},
      },
    });
    return;
  }

  if (request.method === 'tools/list') {
    writeJsonRpc(request.id, {
      tools: manifest.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })),
    });
    return;
  }

  if (request.method === 'tools/call') {
    writeJsonRpcError(
      request.id,
      -32000,
      'This manifest server is read-only. Tool execution must run inside the Studio app so it can access the active project branch state.',
    );
    return;
  }

  writeJsonRpcError(request.id, -32601, `Unsupported method "${request.method ?? ''}".`);
};

const runJsonRpcStdio = () => {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let lineBreakIndex = buffer.indexOf('\n');
    while (lineBreakIndex !== -1) {
      const line = buffer.slice(0, lineBreakIndex).trim();
      buffer = buffer.slice(lineBreakIndex + 1);
      lineBreakIndex = buffer.indexOf('\n');
      if (!line) continue;

      try {
        handleJsonRpcRequest(JSON.parse(line) as JsonRpcRequest);
      } catch (error) {
        writeJsonRpcError(
          null,
          -32700,
          error instanceof Error ? error.message : 'Invalid JSON-RPC request.',
        );
      }
    }
  });
};

if (process.argv.includes('--stdio')) {
  runJsonRpcStdio();
} else {
  writeJson({
    name: 'blackboard-studio-agent-tools',
    description:
      'MCP-style manifest for Blackboard Studio agent tools. Stateful execution is exposed by the trusted Studio browser runtime on window.blackboardAgentMcp.',
    tools: manifest,
  });
}
