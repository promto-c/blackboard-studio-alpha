import { describe, expect, it } from 'vitest';

import {
  createComfyWorkflowFromClipboardItems,
  parseComfyClipboardHtml,
  parseComfyClipboardText,
} from './clipboard';

const comfyClipboardItems = {
  nodes: [
    {
      id: 10,
      type: 'CLIPTextEncode',
      pos: [100, 200],
      inputs: [
        { name: 'clip', type: 'CLIP', link: 40 },
        { name: 'text', type: 'STRING', link: null },
      ],
      outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [50, 60] }],
      widgets_values: ['ภาพเหนือจริง 🌌'],
    },
    {
      id: 20,
      type: 'PreviewAny',
      pos: [420, 200],
      inputs: [{ name: 'source', type: '*', link: 50 }],
      outputs: [],
      widgets_values: [],
    },
  ],
  groups: [{ id: 1, title: 'Prompt', bounding: [80, 160, 600, 260] }],
  reroutes: [{ id: 7, pos: [340, 220], linkIds: [40, 50] }],
  links: [
    {
      id: 40,
      origin_id: 99,
      origin_slot: 0,
      target_id: 10,
      target_slot: 0,
      type: 'CLIP',
    },
    {
      id: 50,
      origin_id: 10,
      origin_slot: 0,
      target_id: 20,
      target_slot: 0,
      type: 'CONDITIONING',
    },
  ],
  subgraphs: [{ id: 'subgraph-a', name: 'Nested graph', nodes: [], links: [] }],
};

const encodeComfyClipboardHtml = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return `<meta charset="utf-8"><div><span data-metadata="${btoa(binary)}"></span></div>`;
};

describe('ComfyUI clipboard import', () => {
  it('converts current ComfyUI ClipboardItems into a standalone graph workflow', () => {
    const workflow = createComfyWorkflowFromClipboardItems(comfyClipboardItems);

    expect(workflow).not.toBeNull();
    expect(workflow).toEqual(
      expect.objectContaining({
        version: 0.4,
        last_node_id: 20,
        last_link_id: 50,
        name: 'Pasted Comfy Selection (2 nodes)',
        groups: comfyClipboardItems.groups,
        definitions: { subgraphs: comfyClipboardItems.subgraphs },
      }),
    );
    expect(workflow?.links).toEqual([comfyClipboardItems.links[1]]);
    expect(workflow?.nodes[0]).toEqual(
      expect.objectContaining({
        inputs: [
          { name: 'clip', type: 'CLIP', link: null },
          { name: 'text', type: 'STRING', link: null },
        ],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [50] }],
        widgets_values: ['ภาพเหนือจริง 🌌'],
      }),
    );
    expect(workflow?.extra).toEqual({
      reroutes: [{ id: 7, pos: [340, 220], linkIds: [50] }],
    });
  });

  it('decodes the UTF-8 base64 HTML representation written by ComfyUI', () => {
    const workflow = parseComfyClipboardHtml(encodeComfyClipboardHtml(comfyClipboardItems));

    expect(workflow?.nodes[0].widgets_values).toEqual(['ภาพเหนือจริง 🌌']);
    expect(workflow?.links).toHaveLength(1);
  });

  it('accepts array-form LiteGraph links and rejects ordinary workflow JSON as clipboard items', () => {
    const arrayLinkItems = {
      ...comfyClipboardItems,
      links: [[50, 10, 0, 20, 0, 'CONDITIONING']],
    };

    expect(parseComfyClipboardText(JSON.stringify(arrayLinkItems))?.links).toEqual([
      [50, 10, 0, 20, 0, 'CONDITIONING'],
    ]);
    expect(
      createComfyWorkflowFromClipboardItems({
        version: 0.4,
        nodes: comfyClipboardItems.nodes,
        links: comfyClipboardItems.links,
        groups: [],
      }),
    ).toBeNull();
  });

  it('rejects malformed or empty ComfyUI selections', () => {
    expect(parseComfyClipboardHtml('<span data-metadata="not-base64"></span>')).toBeNull();
    expect(
      createComfyWorkflowFromClipboardItems({
        nodes: [],
        groups: [],
        reroutes: [],
        links: [],
        subgraphs: [],
      }),
    ).toBeNull();
  });
});
