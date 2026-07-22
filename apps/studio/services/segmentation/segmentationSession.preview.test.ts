// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  predictSam3Mask: vi.fn(),
  prepareSam3Frame: vi.fn(),
}));

vi.mock('./sam3TrackerRuntime', () => ({
  SAM3_TRACKER_MODEL_ID: 'onnx-community/sam3-tracker-ONNX',
  predictSam3Mask: runtimeMocks.predictSam3Mask,
  prepareSam3Frame: runtimeMocks.prepareSam3Frame,
  subscribeToSam3ModelProgress: () => () => {},
}));

vi.mock('./maskProcessing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./maskProcessing')>();
  return {
    ...actual,
    createSegmentationPreviewBlob: vi.fn(async () => new Blob(['preview'], { type: 'image/png' })),
  };
});

import {
  addSegmentationPoint,
  getSegmentationSession,
  prepareSegmentationSession,
  resetSegmentationSession,
  setSegmentationBoxDraft,
  setSegmentationHoverPoint,
} from './segmentationSession';

const nodeId = 'roto-segmentation-preview-test';

beforeEach(() => {
  vi.useFakeTimers();
  runtimeMocks.prepareSam3Frame.mockImplementation(async (_input, options) => ({
    key: 'frame-key',
    backend: 'wasm',
    variantId: options?.variantId ?? 'auto',
  }));
  runtimeMocks.predictSam3Mask.mockResolvedValue({
    logits: new Float32Array([1, -1, -1, 1]),
    width: 2,
    height: 2,
    score: 0.9,
  });
});

afterEach(() => {
  resetSegmentationSession(nodeId);
  vi.useRealTimers();
  vi.clearAllMocks();
});

const prepareFrame = () =>
  prepareSegmentationSession({
    nodeId,
    sourceId: 'source-1',
    sourceLabel: 'Source',
    sourceFrame: 12,
    input: {
      key: 'frame-key',
      data: new Uint8ClampedArray(16),
      width: 2,
      height: 2,
      sceneWidth: 200,
      sceneHeight: 100,
    },
  });

describe('segmentation transient previews', () => {
  it('passes the per-node model variant and shared ONNX backend preferences to the runtime', async () => {
    await prepareSegmentationSession({
      nodeId,
      sourceId: 'source-1',
      sourceLabel: 'Source',
      sourceFrame: 12,
      modelVariant: 'q8',
      runtimePreferences: { webgpuEnabled: false, wasmEnabled: true },
      input: {
        key: 'frame-key',
        data: new Uint8ClampedArray(16),
        width: 2,
        height: 2,
        sceneWidth: 200,
        sceneHeight: 100,
      },
    });

    expect(runtimeMocks.prepareSam3Frame).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        variantId: 'q8',
        runtimePreferences: { webgpuEnabled: false, wasmEnabled: true },
      }),
    );
    expect(getSegmentationSession(nodeId)).toMatchObject({
      modelVariant: 'q8',
      backend: 'wasm',
    });
  });

  it('decodes a hovered point without committing prompts or a contour', async () => {
    await prepareFrame();

    setSegmentationHoverPoint(nodeId, { x: 30, y: 20, label: 'include' });
    await vi.advanceTimersByTimeAsync(80);

    expect(runtimeMocks.predictSam3Mask).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedKey: 'frame-key',
        points: [expect.objectContaining({ x: 30, y: 20, label: 'include' })],
      }),
    );
    expect(getSegmentationSession(nodeId)).toMatchObject({
      points: [],
      contour: null,
      promptHistoryIndex: 0,
    });
    expect(getSegmentationSession(nodeId).transientPreviewUrl).toMatch(/^blob:/);
  });

  it('uses the live draft box for a decoder-only preview', async () => {
    await prepareFrame();

    setSegmentationBoxDraft(nodeId, { x1: -20, y1: -10, x2: 40, y2: 30 });
    await vi.advanceTimersByTimeAsync(80);

    expect(runtimeMocks.predictSam3Mask).toHaveBeenCalledWith(
      expect.objectContaining({ box: { x1: -20, y1: -10, x2: 40, y2: 30 } }),
    );
    expect(getSegmentationSession(nodeId)).toMatchObject({
      box: null,
      boxDraft: { x1: -20, y1: -10, x2: 40, y2: 30 },
      contour: null,
      promptHistoryIndex: 0,
    });
  });

  it('queues the latest hover after a committed contour update', async () => {
    await prepareFrame();

    addSegmentationPoint(nodeId, { x: 10, y: 10, label: 'include' });
    setSegmentationHoverPoint(nodeId, { x: 40, y: 30, label: 'exclude' });
    await vi.runAllTimersAsync();

    expect(runtimeMocks.predictSam3Mask).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.predictSam3Mask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        points: [expect.objectContaining({ x: 10, y: 10, label: 'include' })],
      }),
    );
    expect(runtimeMocks.predictSam3Mask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        points: [
          expect.objectContaining({ x: 10, y: 10, label: 'include' }),
          expect.objectContaining({ x: 40, y: 30, label: 'exclude' }),
        ],
      }),
    );
    expect(getSegmentationSession(nodeId).points).toHaveLength(1);
  });
});
