import { describe, expect, it } from 'vitest';
import {
  areProcessingDomainsCompatible,
  assertRendererProcessingDomainsSupported,
  getDataSemanticProcessingDomain,
  resolveRendererNodeInputDomain,
  resolveRendererNodeProcessingDomain,
  type RendererNodeEntry,
} from '@blackboard/renderer';

const definition = (processingDomain: RendererNodeEntry['processingDomain']) =>
  ({
    renderMode: 'shader',
    category: 'Effect',
    processingDomain,
  }) as RendererNodeEntry;

describe('renderer processing domains', () => {
  it('maps technical channel semantics to dedicated domains', () => {
    expect(getDataSemanticProcessingDomain('alpha')).toBe('alpha');
    expect(getDataSemanticProcessingDomain('depth')).toBe('depth');
    expect(getDataSemanticProcessingDomain('motion_vector')).toBe('vector');
    expect(getDataSemanticProcessingDomain('cryptomatte')).toBe('data');
  });

  it('allows only explicit RGBA component ports to cross image/data boundaries', () => {
    expect(areProcessingDomainsCompatible('data', 'scene_linear', { sourceChannel: 'r' })).toBe(
      true,
    );
    expect(areProcessingDomainsCompatible('scene_linear', 'data', { targetChannel: 'g' })).toBe(
      true,
    );
    expect(areProcessingDomainsCompatible('data', 'scene_linear')).toBe(false);
    expect(areProcessingDomainsCompatible('depth', 'scene_linear')).toBe(false);
  });

  it('prioritizes output-port and dynamic media domains over the node default', () => {
    const node = { id: 'source', type: 'source', name: 'Source' } as never;
    expect(
      resolveRendererNodeProcessingDomain(
        {
          ...definition('scene_linear'),
          outputPorts: [{ name: 'z', label: 'Z', dataSemantic: 'depth' }],
        },
        node,
        'z',
      ),
    ).toBe('depth');
    expect(
      resolveRendererNodeProcessingDomain(
        {
          ...definition('scene_linear'),
          mediaDescriptor: {
            getAssetIds: () => [],
            isData: () => true,
          },
        },
        node,
      ),
    ).toBe('data');
  });

  it('lets transform nodes declare a primary input domain independently from output', () => {
    const node = { id: 'cst', type: 'cst', name: 'Color Space Transform' } as never;
    const cstDefinition = {
      ...definition('display_referred'),
      renderMode: 'ocio' as const,
      primaryInputDomain: 'scene_linear' as const,
    };

    expect(resolveRendererNodeInputDomain(cstDefinition, node, 'pipe')).toBe('scene_linear');
    expect(resolveRendererNodeProcessingDomain(cstDefinition, node)).toBe('display_referred');
  });

  it('allows color reinterpretation boundaries without accepting technical channels', () => {
    const source = { id: 'image', type: 'image', name: 'Image' } as never;
    const technicalSource = { id: 'depth', type: 'depth', name: 'Depth' } as never;
    const target = {
      id: 'cst',
      type: 'cst',
      name: 'Color Space Transform',
      inputs: { pipe: 'image' },
    } as never;
    const technicalTarget = {
      id: 'cst',
      type: 'cst',
      name: 'Color Space Transform',
      inputs: { pipe: 'depth' },
    } as never;
    const cstDefinition = {
      ...definition('scene_linear'),
      renderMode: 'ocio' as const,
      primaryInputDomain: 'display_referred' as const,
      primaryInputDomainPolicy: 'reinterpret' as const,
    };
    const definitions = new Map<string, RendererNodeEntry>([
      ['image', definition('scene_linear')],
      ['depth', definition('depth')],
      ['cst', cstDefinition],
    ]);

    expect(() =>
      assertRendererProcessingDomainsSupported([source, target], (type) => definitions.get(type)),
    ).not.toThrow();
    expect(() =>
      assertRendererProcessingDomainsSupported([technicalSource, technicalTarget], (type) =>
        definitions.get(type),
      ),
    ).toThrow('Cannot connect "depth" output');
  });

  it('accepts renderer-managed log processing and rejects unmanaged display processing', () => {
    const node = { id: 'grade', type: 'grade', name: 'Grade' } as never;
    expect(() =>
      assertRendererProcessingDomainsSupported([node], () => definition('log')),
    ).not.toThrow();
    expect(() =>
      assertRendererProcessingDomainsSupported([node], () => definition('display_referred')),
    ).toThrow('explicit OCIO domain transform');
    expect(() =>
      assertRendererProcessingDomainsSupported([node], () => ({
        ...definition('display_referred'),
        renderMode: 'ocio',
      })),
    ).not.toThrow();
  });

  it('rejects persisted technical-to-color pipe connections', () => {
    const source = { id: 'depth', type: 'extract', name: 'Depth' } as never;
    const target = {
      id: 'grade',
      type: 'grade',
      name: 'Grade',
      inputs: { pipe: 'depth' },
    } as never;
    const definitions = new Map([
      ['extract', definition('data')],
      ['grade', definition('scene_linear')],
    ]);

    expect(() =>
      assertRendererProcessingDomainsSupported([source, target], (type) => definitions.get(type)),
    ).toThrow('Cannot connect "data" output');
  });

  it('accepts persisted component-to-image and image-to-component connections', () => {
    const channelSource = { id: 'extract', type: 'extract', name: 'Extract' } as never;
    const colorTarget = {
      id: 'grade',
      type: 'grade',
      name: 'Grade',
      inputs: { pipe: 'extract' },
      inputSourcePorts: { pipe: 'r' },
    } as never;
    const colorSource = { id: 'image', type: 'image', name: 'Image' } as never;
    const channelTarget = {
      id: 'merge',
      type: 'merge',
      name: 'Merge Channels',
      inputs: { g: 'image' },
    } as never;
    const definitions = new Map<string, RendererNodeEntry>([
      [
        'extract',
        {
          ...definition('scene_linear'),
          outputPorts: [{ name: 'r', label: 'R', processingDomain: 'data', channel: 'r' }],
        },
      ],
      ['grade', definition('scene_linear')],
      ['image', definition('scene_linear')],
      [
        'merge',
        {
          ...definition('scene_linear'),
          inputPorts: [
            {
              name: 'g',
              label: 'G',
              type: 'texture',
              required: false,
              processingDomain: 'data',
              channel: 'g',
            },
          ],
        },
      ],
    ]);

    expect(() =>
      assertRendererProcessingDomainsSupported([channelSource, colorTarget], (type) =>
        definitions.get(type),
      ),
    ).not.toThrow();
    expect(() =>
      assertRendererProcessingDomainsSupported([colorSource, channelTarget], (type) =>
        definitions.get(type),
      ),
    ).not.toThrow();
  });
});
