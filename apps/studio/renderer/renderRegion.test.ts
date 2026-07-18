import { describe, expect, it } from 'vitest';
import { resolveRenderRegionScissor } from '@blackboard/renderer';

describe('render region scissor', () => {
  it('converts the top-left scene rectangle to bottom-left WebGL coordinates', () => {
    expect(
      resolveRenderRegionScissor(
        { x: 100, y: 50, width: 400, height: 200 },
        { width: 1000, height: 500 },
        { width: 1000, height: 500 },
      ),
    ).toEqual({ x: 100, y: 250, width: 400, height: 200 });
  });

  it('scales and clamps a scene region for smaller targets', () => {
    expect(
      resolveRenderRegionScissor(
        { x: -10, y: 100, width: 610, height: 500 },
        { width: 800, height: 600 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ x: 0, y: 0, width: 300, height: 250 });
  });
});
