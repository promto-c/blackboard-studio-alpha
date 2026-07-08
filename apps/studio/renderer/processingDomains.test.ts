import { describe, expect, it } from 'vitest';
import {
  assertRendererProcessingDomainsSupported,
  getDataSemanticProcessingDomain,
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

  it('accepts renderer-managed log processing and rejects unmanaged display processing', () => {
    const node = { id: 'grade', type: 'grade', name: 'Grade' } as never;
    expect(() =>
      assertRendererProcessingDomainsSupported([node], () => definition('log')),
    ).not.toThrow();
    expect(() =>
      assertRendererProcessingDomainsSupported([node], () => definition('display_referred')),
    ).toThrow('explicit OCIO domain transform');
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
});
