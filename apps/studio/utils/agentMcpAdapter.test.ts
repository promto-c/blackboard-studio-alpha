import { describe, expect, it, vi } from 'vitest';
import type { AiToolHandler } from './agentToolRegistry';
import { createAgentMcpAdapter } from './agentMcpAdapter';

describe('agentMcpAdapter', () => {
  it('lists registry tools and dispatches handler calls by name', async () => {
    const handler: AiToolHandler = {
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
    };

    const adapter = createAgentMcpAdapter([handler]);
    const result = await adapter.callTool('create_node', { type: 'grade' });

    expect(adapter.listTools().some((tool) => tool.name === 'create_node')).toBe(true);
    expect(handler.run).toHaveBeenCalledWith({ type: 'grade' });
    expect(JSON.parse(result.content[0].text).status).toBe('created');
  });

  it('returns an MCP-style error for unknown tools', async () => {
    const adapter = createAgentMcpAdapter([]);
    const result = await adapter.callTool('missing_tool');

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).status).toBe('error');
  });
});
