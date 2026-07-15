import { describe, expect, it } from 'vitest';
import { NodeType, type SceneNode } from '@blackboard/types';
import {
  clampToTimelineRange,
  expandTimelineFrameRange,
  getSceneTimelineRange,
} from './timelineRange';

const scene = (startFrame: number, endFrame: number): SceneNode => ({
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'ACEScg',
  startFrame,
  maxFrames: endFrame,
  fps: 24,
});

describe('absolute timeline ranges', () => {
  it('reads an inclusive range from the scene', () => {
    expect(getSceneTimelineRange(scene(1001, 1240))).toEqual({
      startFrame: 1001,
      endFrame: 1240,
      frameCount: 240,
    });
  });

  it('expands multiple temporal source ranges', () => {
    expect(
      expandTimelineFrameRange(
        { startFrame: 1001, endFrame: 1100 },
        { startFrame: 950, endFrame: 1200 },
      ),
    ).toEqual({ startFrame: 950, endFrame: 1200, frameCount: 251 });
  });

  it('clamps the playhead to both absolute boundaries', () => {
    const range = { startFrame: 1001, endFrame: 1240 };
    expect(clampToTimelineRange(0, range)).toBe(1001);
    expect(clampToTimelineRange(2000, range)).toBe(1240);
  });
});
