import { describe, expect, it } from 'vitest';
import {
  NodeType,
  RotoAlphaMode,
  type AlphaInputBehavior,
  type AnyNode,
  type RenderOutputDomain,
} from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import {
  getAlphaDeadRotoNodeIds,
  isNodeAlphaLiveInViewerPipeline,
  isViewerAlphaRequired,
} from './alphaLiveness';

const node = (id: string, type: string, inputs?: Record<string, string>, enabled = true): AnyNode =>
  ({ id, type, name: id, enabled, ...(inputs ? { inputs } : {}) }) as AnyNode;

const registry = (
  behaviors: Record<
    string,
    AlphaInputBehavior | ((node: AnyNode, inputPort: string) => AlphaInputBehavior)
  >,
) =>
  new Map(
    Object.entries(behaviors).map(([type, alphaInputBehavior]) => [type, { alphaInputBehavior }]),
  );

describe('alpha liveness', () => {
  it('treats a terminal Roto alpha as dead for an RGB-only viewer', () => {
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [node('roto', 'roto')],
        sourceNodeId: 'roto',
        viewerRequiresAlpha: false,
        nodeRegistry: registry({}),
      }),
    ).toBe(false);
  });

  it('keeps terminal and propagated alpha live when the viewer requests it', () => {
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [node('roto', 'roto'), node('grade', 'grade', { pipe: 'roto' })],
        sourceNodeId: 'roto',
        viewerRequiresAlpha: true,
        nodeRegistry: registry({ grade: 'propagate' }),
      }),
    ).toBe(true);
  });

  it('keeps alpha live when a downstream node can consume it into RGB', () => {
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [
          node('roto', 'roto'),
          node('grade', 'grade', { pipe: 'roto' }),
          node('merge', 'merge', { pipe: 'grade' }),
        ],
        sourceNodeId: 'roto',
        viewerRequiresAlpha: false,
        nodeRegistry: registry({ grade: 'propagate', merge: 'consume' }),
      }),
    ).toBe(true);
  });

  it('stops alpha liveness at a node that discards upstream alpha', () => {
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [
          node('roto', 'roto'),
          node('replace', 'replace', { pipe: 'roto' }),
          node('merge', 'merge', { pipe: 'replace' }),
        ],
        sourceNodeId: 'roto',
        viewerRequiresAlpha: true,
        nodeRegistry: registry({ replace: 'discard', merge: 'consume' }),
      }),
    ).toBe(false);
  });

  it('is conservative for undeclared nodes and secondary inputs', () => {
    const nodes = [node('roto', 'roto'), node('plugin', 'plugin', { mask: 'roto' })];
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes,
        sourceNodeId: 'roto',
        viewerRequiresAlpha: false,
        nodeRegistry: registry({}),
      }),
    ).toBe(true);
  });

  it('ignores disconnected Roto nodes and disabled secondary inputs', () => {
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [node('grade', 'grade')],
        sourceNodeId: 'roto',
        viewerRequiresAlpha: true,
        nodeRegistry: registry({ grade: 'propagate' }),
      }),
    ).toBe(false);
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [node('roto', 'roto'), node('merge', 'merge', { source: 'roto' }, false)],
        sourceNodeId: 'roto',
        viewerRequiresAlpha: true,
        nodeRegistry: registry({ merge: 'consume' }),
      }),
    ).toBe(false);
  });

  it('uses built-in declarations for safe effects, alpha replacement, and compositors', () => {
    const roto = node('roto', NodeType.ROTO);
    const grade = node('grade', NodeType.GRADE, { pipe: roto.id });
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [roto, grade],
        sourceNodeId: roto.id,
        viewerRequiresAlpha: false,
        nodeRegistry,
      }),
    ).toBe(false);

    const premultiply = node('premultiply', NodeType.PREMULTIPLY, { pipe: grade.id });
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [roto, grade, premultiply],
        sourceNodeId: roto.id,
        viewerRequiresAlpha: false,
        nodeRegistry,
      }),
    ).toBe(true);

    const paint = node('paint', NodeType.PAINT, { pipe: grade.id });
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [roto, grade, paint],
        sourceNodeId: roto.id,
        viewerRequiresAlpha: false,
        nodeRegistry,
      }),
    ).toBe(false);

    const replacementRoto = {
      ...node('replacement', NodeType.ROTO, { pipe: roto.id }),
      alphaMode: RotoAlphaMode.REPLACE,
    } as AnyNode;
    const postReplacementPremultiply = node('post-replacement', NodeType.PREMULTIPLY, {
      pipe: replacementRoto.id,
    });
    expect(
      isNodeAlphaLiveInViewerPipeline({
        nodes: [roto, replacementRoto, postReplacementPremultiply],
        sourceNodeId: roto.id,
        viewerRequiresAlpha: true,
        nodeRegistry,
      }),
    ).toBe(false);
  });
});

describe('viewer alpha demand', () => {
  const colorDomain: RenderOutputDomain = { kind: 'color' };

  it('detects alpha channel, overlay, and technical alpha output demand', () => {
    expect(isViewerAlphaRequired({ channels: 'A', alphaOverlay: false }, colorDomain)).toBe(true);
    expect(isViewerAlphaRequired({ channels: 'RGB', alphaOverlay: true }, colorDomain)).toBe(true);
    expect(
      isViewerAlphaRequired(
        { channels: 'RGB', alphaOverlay: false },
        { kind: 'data', sourceNodeId: 'extract', sourcePort: 'a', semantic: 'alpha' },
      ),
    ).toBe(true);
    expect(
      isViewerAlphaRequired(
        { channels: 'RGB', alphaOverlay: false },
        { kind: 'color', sourceNodeId: 'extract', sourcePort: 'a' },
      ),
    ).toBe(true);
    expect(isViewerAlphaRequired({ channels: 'RGB', alphaOverlay: false }, colorDomain)).toBe(
      false,
    );
  });
});

describe('alpha-dead Roto collection', () => {
  it('collects only Roto passes that cannot affect the RGB viewer result', () => {
    const source = node('source', NodeType.MEDIA_SOURCE);
    const deadRoto = node('dead-roto', NodeType.ROTO, { pipe: source.id });
    const grade = node('grade', NodeType.GRADE, { pipe: deadRoto.id });
    const liveRoto = node('live-roto', NodeType.ROTO, { pipe: grade.id });
    const merge = node('merge', NodeType.MERGE, { pipe: liveRoto.id });

    expect(
      getAlphaDeadRotoNodeIds({
        nodes: [source, deadRoto, grade],
        viewerRequiresAlpha: false,
        nodeRegistry,
      }),
    ).toEqual(new Set([deadRoto.id]));
    expect(
      getAlphaDeadRotoNodeIds({
        nodes: [source, deadRoto, grade, liveRoto, merge],
        viewerRequiresAlpha: false,
        nodeRegistry,
      }),
    ).toEqual(new Set());
  });
});
