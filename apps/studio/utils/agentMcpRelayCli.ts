#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createAgentMcpToolManifest } from './agentToolRegistry.ts';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse =
  | {
      jsonrpc: '2.0';
      id: JsonRpcId;
      result: unknown;
    }
  | {
      jsonrpc: '2.0';
      id: JsonRpcId;
      error: {
        code: number;
        message: string;
      };
    };

type RelayEnvelope = {
  requestId: string;
  request: JsonRpcRequest;
};

type PendingRelayRequest = RelayEnvelope & {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const manifest = createAgentMcpToolManifest();
const DEFAULT_PORT = 17361;
const REQUEST_TIMEOUT_MS = 120000;
const pendingQueue: PendingRelayRequest[] = [];
const pendingById = new Map<string, PendingRelayRequest>();
let lastRuntimePollAt = 0;

const getPort = () => {
  const portArgIndex = process.argv.findIndex((arg) => arg === '--port');
  const rawPort =
    portArgIndex === -1
      ? (process.env.BLACKBOARD_AGENT_MCP_RELAY_PORT ?? '')
      : (process.argv[portArgIndex + 1] ?? '');
  const port = Number(rawPort || DEFAULT_PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
};

const writeJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const createJsonRpcResult = (id: JsonRpcId | undefined, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  result,
});

const createJsonRpcError = (
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: {
    code,
    message,
  },
});

const sendJson = (response: ServerResponse, statusCode: number, value: unknown) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(value));
};

const sendEmpty = (response: ServerResponse, statusCode: number) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  response.end();
};

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });

const enqueueRuntimeRequest = (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingById.delete(requestId);
      const index = pendingQueue.findIndex((entry) => entry.requestId === requestId);
      if (index !== -1) {
        pendingQueue.splice(index, 1);
      }
      reject(new Error('Timed out waiting for the Studio browser runtime.'));
    }, REQUEST_TIMEOUT_MS);
    const pending: PendingRelayRequest = {
      requestId,
      request,
      resolve,
      reject,
      timeout,
    };
    pendingById.set(requestId, pending);
    pendingQueue.push(pending);
  });
};

const handleRelayHttpRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (request.method === 'OPTIONS') {
    sendEmpty(response, 204);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/blackboard-agent-mcp/health') {
    sendJson(response, 200, {
      ok: true,
      pending: pendingQueue.length,
      runtimeConnected: Date.now() - lastRuntimePollAt < 2500,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/blackboard-agent-mcp/next') {
    lastRuntimePollAt = Date.now();
    const pending = pendingQueue.shift();
    if (!pending) {
      sendEmpty(response, 204);
      return;
    }
    sendJson(response, 200, {
      requestId: pending.requestId,
      request: pending.request,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/blackboard-agent-mcp/respond') {
    const body = await readBody(request);
    const payload = JSON.parse(body || '{}') as {
      requestId?: string;
      response?: JsonRpcResponse;
    };
    const pending = payload.requestId ? pendingById.get(payload.requestId) : null;
    if (!pending || !payload.response) {
      sendJson(response, 404, { error: 'Unknown relay request.' });
      return;
    }
    clearTimeout(pending.timeout);
    pendingById.delete(pending.requestId);
    pending.resolve(payload.response);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: 'Unknown Blackboard agent MCP relay endpoint.' });
};

const createRelayServer = (port: number) => {
  const server = createServer((request, response) => {
    void handleRelayHttpRequest(request, response).catch((error) => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
};

const getRuntimeDisconnectedError = () =>
  createJsonRpcError(
    null,
    -32001,
    'No Studio browser runtime is connected. Open Studio with ?agentMcpRelay=1 while this relay is running.',
  );

const handleJsonRpcRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  if (request.method === 'initialize') {
    return createJsonRpcResult(request.id, {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'blackboard-studio-agent-tools-relay',
        version: '0.1.0',
      },
      capabilities: {
        tools: {},
      },
    });
  }

  if (request.method === 'tools/list') {
    return createJsonRpcResult(request.id, {
      tools: manifest.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })),
    });
  }

  if (request.method === 'tools/call') {
    if (Date.now() - lastRuntimePollAt > 2500) {
      return { ...getRuntimeDisconnectedError(), id: request.id ?? null };
    }
    const runtimeResponse = await enqueueRuntimeRequest(request);
    return {
      ...runtimeResponse,
      id: request.id ?? null,
    };
  }

  return createJsonRpcError(request.id, -32601, `Unsupported method "${request.method ?? ''}".`);
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

      void Promise.resolve()
        .then(() => handleJsonRpcRequest(JSON.parse(line) as JsonRpcRequest))
        .then(writeJson)
        .catch((error) => {
          writeJson(
            createJsonRpcError(
              null,
              -32700,
              error instanceof Error ? error.message : 'Invalid JSON-RPC request.',
            ),
          );
        });
    }
  });
};

const port = getPort();
const server = createRelayServer(port);
if (!process.argv.includes('--stdio')) {
  process.stderr.write(`Blackboard Studio agent MCP relay listening on http://127.0.0.1:${port}\n`);
}
process.stdin.on('end', () => {
  server.close();
});
runJsonRpcStdio();
