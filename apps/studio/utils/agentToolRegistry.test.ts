import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOL_CAPABILITIES,
  createAgentMcpToolManifest,
  createAgentToolSchema,
  getAvailableAgentToolCapabilities,
} from './agentToolRegistry';

describe('agentToolRegistry', () => {
  it('exposes available tools as function schemas and MCP-style manifests', () => {
    const availableTools = getAvailableAgentToolCapabilities();
    const applyTool = availableTools.find((tool) => tool.name === 'apply_agent_branch_snapshot');
    const previewTool = availableTools.find((tool) => tool.name === 'capture_render_preview');
    const createNodeTool = availableTools.find((tool) => tool.name === 'create_node');
    const connectTool = availableTools.find((tool) => tool.name === 'connect_nodes');

    expect(applyTool?.permission).toBe('confirm');
    expect(createAgentToolSchema(applyTool!).function.parameters.required).toContain('branchId');
    expect(previewTool?.category).toBe('render');
    expect(createAgentToolSchema(previewTool!).function.parameters.properties).toHaveProperty(
      'frame',
    );
    expect(createNodeTool?.category).toBe('node');
    expect(createAgentToolSchema(createNodeTool!).function.parameters.required).toContain('type');
    expect(createAgentToolSchema(connectTool!).function.parameters.required).toContain(
      'targetPort',
    );
    expect(createAgentMcpToolManifest().map((tool) => tool.name)).toEqual(
      AGENT_TOOL_CAPABILITIES.map((tool) => tool.name),
    );
  });
});
