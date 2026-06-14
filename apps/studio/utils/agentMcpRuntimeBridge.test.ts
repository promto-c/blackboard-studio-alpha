import { describe, expect, it, vi } from 'vitest';
import type { AiToolHandler } from './agentToolRegistry';
import { createAgentMcpRuntimeBridge } from './agentMcpRuntimeBridge';

const createHandler = (): AiToolHandler => ({
  permission: 'safe',
  schema: {
    type: 'function',
    function: {
      name: 'create_node',
      description: 'Create node',
      parameters: { type: 'object', properties: {} },
    },
  },
  run: vi.fn(() => ({
    content: JSON.stringify({ status: 'created', nodeId: 'node-1' }),
    artifact: null,
  })),
});

describe('agentMcpRuntimeBridge', () => {
  it('lists executable runtime tools only', async () => {
    const runtime = createAgentMcpRuntimeBridge({} as never, {
      handlers: [createHandler()],
    });
    const response = await runtime.handleJsonRpc({ id: 1, method: 'tools/list' });

    expect('result' in response && response.result).toMatchObject({
      tools: [expect.objectContaining({ name: 'create_node' })],
    });
  });

  it('dispatches JSON-RPC tool calls through live handlers', async () => {
    const handler = createHandler();
    const runtime = createAgentMcpRuntimeBridge({} as never, {
      handlers: [handler],
    });
    const response = await runtime.handleJsonRpc({
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'create_node',
        arguments: { type: 'grade' },
      },
    });

    expect(handler.run).toHaveBeenCalledWith({ type: 'grade' });
    expect('result' in response && response.result).toMatchObject({
      content: [{ text: JSON.stringify({ status: 'created', nodeId: 'node-1' }) }],
    });
  });
});
