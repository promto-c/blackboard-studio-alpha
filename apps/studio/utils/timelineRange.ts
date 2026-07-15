import { NodeType, type AnyNode, type SceneNode } from '@blackboard/types';

export interface TimelineFrameRange {
  startFrame: number;
  endFrame: number;
  frameCount: number;
}

const finiteInteger = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;

export const normalizeTimelineFrameRange = (
  startFrame: unknown,
  endFrame: unknown,
): TimelineFrameRange => {
  const start = Math.max(0, finiteInteger(startFrame, 0));
  const end = Math.max(0, finiteInteger(endFrame, start));
  const first = Math.min(start, end);
  const last = Math.max(start, end);

  return {
    startFrame: first,
    endFrame: last,
    frameCount: last - first + 1,
  };
};

export const getSceneTimelineRange = (sceneNode: SceneNode): TimelineFrameRange =>
  normalizeTimelineFrameRange(sceneNode.startFrame, sceneNode.maxFrames);

export const findSceneTimelineRange = (nodes: readonly AnyNode[]): TimelineFrameRange => {
  const sceneNode = nodes.find((node): node is SceneNode => node.type === NodeType.SCENE);
  return sceneNode ? getSceneTimelineRange(sceneNode) : normalizeTimelineFrameRange(0, 0);
};

export const setSceneTimelineRange = (
  nodes: readonly AnyNode[],
  range: Pick<TimelineFrameRange, 'startFrame' | 'endFrame'>,
): AnyNode[] => {
  const normalized = normalizeTimelineFrameRange(range.startFrame, range.endFrame);
  return nodes.map((node) =>
    node.type === NodeType.SCENE
      ? ({
          ...node,
          startFrame: normalized.startFrame,
          maxFrames: normalized.endFrame,
        } as SceneNode)
      : node,
  );
};

export const expandTimelineFrameRange = (
  current: Pick<TimelineFrameRange, 'startFrame' | 'endFrame'>,
  incoming: Pick<TimelineFrameRange, 'startFrame' | 'endFrame'>,
): TimelineFrameRange =>
  normalizeTimelineFrameRange(
    Math.min(current.startFrame, incoming.startFrame),
    Math.max(current.endFrame, incoming.endFrame),
  );

export const clampToTimelineRange = (
  frame: number,
  range: Pick<TimelineFrameRange, 'startFrame' | 'endFrame'>,
): number => {
  if (!Number.isFinite(frame)) return range.startFrame;
  return Math.max(range.startFrame, Math.min(range.endFrame, Math.round(frame)));
};
