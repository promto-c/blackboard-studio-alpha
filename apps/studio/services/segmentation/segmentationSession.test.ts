// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  addSegmentationPoint,
  clearSegmentationPrompts,
  clearSegmentationTransientPreview,
  commitSegmentationBox,
  getSegmentationSession,
  redoSegmentationPrompt,
  resetSegmentationSession,
  setSegmentationHoverPoint,
  undoSegmentationPrompt,
} from './segmentationSession';

const nodeId = 'roto-segmentation-history-test';

afterEach(() => resetSegmentationSession(nodeId));

describe('segmentation prompt history', () => {
  it('undoes and redoes confirmed point, box, and clear operations', () => {
    addSegmentationPoint(nodeId, { x: 10, y: 20, label: 'include' });
    commitSegmentationBox(nodeId, { x1: 0, y1: 0, x2: 100, y2: 80 });
    clearSegmentationPrompts(nodeId);

    expect(getSegmentationSession(nodeId)).toMatchObject({
      points: [],
      box: null,
      promptHistoryIndex: 3,
    });

    undoSegmentationPrompt(nodeId);
    expect(getSegmentationSession(nodeId)).toMatchObject({
      box: { x1: 0, y1: 0, x2: 100, y2: 80 },
      promptHistoryIndex: 2,
    });

    undoSegmentationPrompt(nodeId);
    expect(getSegmentationSession(nodeId)).toMatchObject({
      box: null,
      promptHistoryIndex: 1,
    });
    expect(getSegmentationSession(nodeId).points).toHaveLength(1);

    redoSegmentationPrompt(nodeId);
    expect(getSegmentationSession(nodeId)).toMatchObject({
      box: { x1: 0, y1: 0, x2: 100, y2: 80 },
      promptHistoryIndex: 2,
    });
  });

  it('drops the redo branch after a new confirmed prompt', () => {
    addSegmentationPoint(nodeId, { x: 10, y: 20, label: 'include' });
    addSegmentationPoint(nodeId, { x: 30, y: 40, label: 'exclude' });
    undoSegmentationPrompt(nodeId);

    addSegmentationPoint(nodeId, { x: 50, y: 60, label: 'include' });
    const state = getSegmentationSession(nodeId);
    expect(state.points.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 60 },
    ]);
    expect(state.promptHistoryIndex).toBe(state.promptHistory.length - 1);

    redoSegmentationPrompt(nodeId);
    expect(getSegmentationSession(nodeId).points).toHaveLength(2);
  });

  it('keeps hover prompts transient', () => {
    setSegmentationHoverPoint(nodeId, { x: 12, y: 24, label: 'include' });
    expect(getSegmentationSession(nodeId)).toMatchObject({
      hoverPoint: { x: 12, y: 24, label: 'include' },
      promptHistoryIndex: 0,
    });
    expect(getSegmentationSession(nodeId).points).toEqual([]);

    clearSegmentationTransientPreview(nodeId);
    expect(getSegmentationSession(nodeId).hoverPoint).toBeNull();
    expect(getSegmentationSession(nodeId).promptHistoryIndex).toBe(0);
  });
});
