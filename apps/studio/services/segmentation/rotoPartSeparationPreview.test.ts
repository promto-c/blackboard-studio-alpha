import { describe, expect, it, vi } from 'vitest';
import {
  clearRotoPartSeparationPreview,
  getRotoPartSeparationPreview,
  setRotoPartSeparationPreview,
  subscribeToRotoPartSeparationPreview,
  type RotoPartSeparationPreviewState,
} from './rotoPartSeparationPreview';

const createPreview = (ownerId: string): RotoPartSeparationPreviewState => ({
  ownerId,
  nodeId: 'roto-1',
  sourcePathId: 'path-1',
  sourceFrame: 12,
  width: 100,
  height: 80,
  sceneBounds: { x: -50, y: -40, width: 100, height: 80 },
  partCount: 2,
  overlap: 8,
  branchReach: 2.5,
  parts: [
    {
      index: 0,
      seed: { x: 50, y: 40 },
      contour: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 80 },
      ],
      corePixelCount: 100,
      pixelCount: 120,
    },
  ],
});

describe('roto part-separation preview session', () => {
  it('publishes transient preview changes to viewport subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRotoPartSeparationPreview('roto-1', listener);
    const preview = createPreview('panel-a');

    setRotoPartSeparationPreview(preview);

    expect(listener).toHaveBeenCalledOnce();
    expect(getRotoPartSeparationPreview('roto-1')).toBe(preview);
    unsubscribe();
    clearRotoPartSeparationPreview('roto-1');
  });

  it('does not let stale panel cleanup clear a newer preview', () => {
    setRotoPartSeparationPreview(createPreview('panel-a'));
    setRotoPartSeparationPreview(createPreview('panel-b'));

    clearRotoPartSeparationPreview('roto-1', 'panel-a');
    expect(getRotoPartSeparationPreview('roto-1')?.ownerId).toBe('panel-b');

    clearRotoPartSeparationPreview('roto-1', 'panel-b');
    expect(getRotoPartSeparationPreview('roto-1')).toBeNull();
  });
});
