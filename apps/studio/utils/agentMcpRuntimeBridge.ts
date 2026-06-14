import type { AiChatArtifact } from '@blackboard/types';
import { createAgentProjectToolHandlers } from './agentProjectTools';
import { createAgentMcpAdapter, type AgentMcpToolResult } from './agentMcpAdapter';
import { createAgentMcpToolManifest, type AiToolHandler } from './agentToolRegistry';
import type { GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';

type JsonRpcId = string | number | null;

type AgentMcpJsonRpcRequest = {
  jsonrpc?: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type AgentMcpJsonRpcResponse =
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

type AgentMcpRuntimeBridge = {
  listTools: () => ReturnType<typeof createAgentMcpToolManifest>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<AgentMcpToolResult>;
  handleJsonRpc: (request: AgentMcpJsonRpcRequest) => Promise<AgentMcpJsonRpcResponse>;
};

type AgentMcpRuntimeDeps = {
  commitMutation: CommitEditorMutation;
  getState: GetState;
  setState: SetState;
  debouncedSave: () => void;
};

type AgentMcpRuntimeInstallTarget = {
  blackboardAgentMcp?: AgentMcpRuntimeBridge;
  blackboardAgentMcpRelay?: {
    relayUrl: string;
    connected: boolean;
    lastSeenAt?: number;
    lastError?: string;
    stop?: () => void;
  };
  location?: Window['location'];
  localStorage?: Window['localStorage'];
  addEventListener?: Window['addEventListener'];
  removeEventListener?: Window['removeEventListener'];
  postMessage?: Window['postMessage'];
};

const AGENT_MCP_RUNTIME_REQUEST_SOURCE = 'blackboard-studio-agent-mcp-request';
const AGENT_MCP_RUNTIME_RESPONSE_SOURCE = 'blackboard-studio-agent-mcp-response';
const DEFAULT_AGENT_MCP_RELAY_URL = 'http://127.0.0.1:17361';

const createJsonRpcResult = (
  id: JsonRpcId | undefined,
  result: unknown,
): AgentMcpJsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  result,
});

const createJsonRpcError = (
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): AgentMcpJsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: {
    code,
    message,
  },
});

const getToolCallParams = (params: Record<string, unknown> | undefined) => {
  const name = typeof params?.name === 'string' ? params.name : null;
  const args =
    params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};
  return { name, args };
};

export const createAgentMcpRuntimeBridge = (
  deps: AgentMcpRuntimeDeps,
  options: {
    handlers?: AiToolHandler<AiChatArtifact | null>[];
  } = {},
): AgentMcpRuntimeBridge => {
  const handlers =
    options.handlers ??
    (createAgentProjectToolHandlers(deps) as AiToolHandler<AiChatArtifact | null>[]);
  const executableToolNames = new Set(handlers.map((handler) => handler.schema.function.name));
  const executableToolManifest = createAgentMcpToolManifest().filter((tool) =>
    executableToolNames.has(tool.name),
  );
  const adapter = createAgentMcpAdapter(handlers, executableToolManifest);

  return {
    listTools: adapter.listTools,
    callTool: adapter.callTool,
    handleJsonRpc: async (request) => {
      if (request.method === 'initialize') {
        return createJsonRpcResult(request.id, {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'blackboard-studio-runtime-agent-tools',
            version: '0.1.0',
          },
          capabilities: {
            tools: {},
          },
        });
      }

      if (request.method === 'tools/list') {
        return createJsonRpcResult(request.id, {
          tools: adapter.listTools().map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
          })),
        });
      }

      if (request.method === 'tools/call') {
        const { name, args } = getToolCallParams(request.params);
        if (!name) {
          return createJsonRpcError(request.id, -32602, 'tools/call requires params.name.');
        }
        return createJsonRpcResult(request.id, await adapter.callTool(name, args));
      }

      return createJsonRpcError(
        request.id,
        -32601,
        `Unsupported method "${request.method ?? ''}".`,
      );
    },
  };
};

export const installAgentMcpRuntimeBridge = (
  deps: AgentMcpRuntimeDeps,
  target: AgentMcpRuntimeInstallTarget = window,
) => {
  const runtime = createAgentMcpRuntimeBridge(deps);
  const previousRuntime = target.blackboardAgentMcp;
  target.blackboardAgentMcp = runtime;

  const handleMessage = (event: MessageEvent) => {
    const data = event.data as
      | {
          source?: string;
          request?: AgentMcpJsonRpcRequest;
        }
      | undefined;
    if (data?.source !== AGENT_MCP_RUNTIME_REQUEST_SOURCE || !data.request) {
      return;
    }

    void runtime.handleJsonRpc(data.request).then((response) => {
      target.postMessage?.(
        {
          source: AGENT_MCP_RUNTIME_RESPONSE_SOURCE,
          response,
        },
        '*',
      );
    });
  };

  target.addEventListener?.('message', handleMessage);
  const stopRelayClient = maybeInstallAgentMcpRelayClient(runtime, target);

  return () => {
    stopRelayClient?.();
    target.removeEventListener?.('message', handleMessage);
    target.blackboardAgentMcp = previousRuntime;
  };
};

type AgentMcpRelayEnvelope = {
  requestId: string;
  request: AgentMcpJsonRpcRequest;
};

const getRelayConfig = (target: AgentMcpRuntimeInstallTarget) => {
  const search = target.location?.search ?? '';
  const params = new URLSearchParams(search);
  const queryEnabled = params.get('agentMcpRelay') === '1';
  const storedEnabled = target.localStorage?.getItem('blackboard.agentMcpRelay') === '1';
  if (!queryEnabled && !storedEnabled) {
    return null;
  }

  return (
    params.get('agentMcpRelayUrl') ||
    target.localStorage?.getItem('blackboard.agentMcpRelayUrl') ||
    DEFAULT_AGENT_MCP_RELAY_URL
  ).replace(/\/+$/, '');
};

const maybeInstallAgentMcpRelayClient = (
  runtime: AgentMcpRuntimeBridge,
  target: AgentMcpRuntimeInstallTarget,
) => {
  if (typeof window === 'undefined') {
    return null;
  }

  const relayUrl = getRelayConfig(target);
  if (!relayUrl) {
    return null;
  }

  let cancelled = false;
  let timeoutId: number | null = null;
  target.blackboardAgentMcpRelay = {
    relayUrl,
    connected: false,
  };

  const setStatus = (
    patch: Partial<NonNullable<AgentMcpRuntimeInstallTarget['blackboardAgentMcpRelay']>>,
  ) => {
    target.blackboardAgentMcpRelay = {
      relayUrl,
      connected: target.blackboardAgentMcpRelay?.connected ?? false,
      ...target.blackboardAgentMcpRelay,
      ...patch,
    };
  };

  const poll = async () => {
    try {
      const response = await fetch(`${relayUrl}/blackboard-agent-mcp/next`, {
        cache: 'no-store',
      });
      if (response.status === 200) {
        const envelope = (await response.json()) as AgentMcpRelayEnvelope;
        const rpcResponse = await runtime.handleJsonRpc(envelope.request);
        await fetch(`${relayUrl}/blackboard-agent-mcp/respond`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: envelope.requestId,
            response: rpcResponse,
          }),
        });
      }
      if (response.ok || response.status === 204) {
        setStatus({ connected: true, lastSeenAt: Date.now(), lastError: undefined });
      } else {
        setStatus({ connected: false, lastError: `Relay HTTP ${response.status}` });
      }
    } catch (error) {
      setStatus({
        connected: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (!cancelled) {
        timeoutId = window.setTimeout(poll, 350);
      }
    }
  };

  target.blackboardAgentMcpRelay.stop = () => {
    cancelled = true;
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  };
  void poll();

  return () => {
    cancelled = true;
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
    target.blackboardAgentMcpRelay = undefined;
  };
};
