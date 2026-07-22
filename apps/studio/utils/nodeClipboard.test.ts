import { afterEach, describe, expect, it, vi } from 'vitest';

import { readNodeClipboard } from './nodeClipboard';

const encodeComfyClipboardHtml = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return `<span data-metadata="${btoa(binary)}"></span>`;
};

describe('readNodeClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads ComfyUI node data from the system clipboard text/html representation', async () => {
    const html = encodeComfyClipboardHtml({
      nodes: [
        {
          id: 7,
          type: 'CLIPTextEncode',
          inputs: [],
          outputs: [],
          widgets_values: ['สวัสดี'],
        },
      ],
      groups: [],
      reroutes: [],
      links: [],
      subgraphs: [],
    });
    const getType = vi.fn().mockResolvedValue(new Blob([html], { type: 'text/html' }));
    vi.stubGlobal('navigator', {
      clipboard: {
        read: vi.fn().mockResolvedValue([{ types: ['text/html'], getType }]),
      },
    });

    const result = await readNodeClipboard();

    expect(getType).toHaveBeenCalledWith('text/html');
    expect(result).toEqual(
      expect.objectContaining({
        source: 'comfy',
        workflow: expect.objectContaining({
          name: 'Pasted CLIPTextEncode',
          nodes: [expect.objectContaining({ widgets_values: ['สวัสดี'] })],
        }),
      }),
    );
  });
});
