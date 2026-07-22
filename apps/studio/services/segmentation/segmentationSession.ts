import { useSyncExternalStore } from 'react';
import { findMaskContours, getLargestContour, type ContourPoint } from '@/utils/contour';
import {
  cleanSegmentationMask,
  createSegmentationPreviewBlob,
  DEFAULT_SEGMENTATION_CLEANUP,
  type SegmentationCleanupSettings,
} from './maskProcessing';
import {
  predictSam3Mask,
  prepareSam3Frame,
  subscribeToSam3ModelProgress,
} from './sam3TrackerRuntime';
import type { RotoSegmentationModelVariant } from '@blackboard/types';
import type {
  SegmentationFrameInput,
  SegmentationModelProgress,
  SegmentationPromptBox,
  SegmentationPromptLabel,
  SegmentationPromptMode,
  SegmentationPromptPoint,
} from './types';
import type { OnnxRuntimePreferences } from '@/services/onnx/onnxSession';
import {
  DEFAULT_SAM3_MODEL_VARIANT,
  getSam3ModelVariant,
  SAM3_TRACKER_MODEL_ID,
} from '@/services/models/builtinModelRegistry';

export type SegmentationSessionStatus =
  | 'idle'
  | 'loading-model'
  | 'encoding'
  | 'ready'
  | 'decoding'
  | 'cleaning'
  | 'error';

export interface SegmentationSessionState {
  nodeId: string;
  modelId: string;
  modelVariant: RotoSegmentationModelVariant;
  modelVariantLabel: string;
  status: SegmentationSessionStatus;
  modelProgress: SegmentationModelProgress | null;
  backend: 'webgpu' | 'wasm' | null;
  error: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  sourceFrame: number | null;
  sourceKey: string | null;
  preparedKey: string | null;
  imageWidth: number;
  imageHeight: number;
  sceneWidth: number;
  sceneHeight: number;
  promptMode: SegmentationPromptMode;
  promptLabel: SegmentationPromptLabel;
  points: SegmentationPromptPoint[];
  box: SegmentationPromptBox | null;
  boxDraft: SegmentationPromptBox | null;
  hoverPoint: SegmentationPromptPoint | null;
  promptHistory: SegmentationPromptSnapshot[];
  promptHistoryIndex: number;
  cleanup: SegmentationCleanupSettings;
  logits: Float32Array | null;
  mask: Uint8Array | null;
  contour: ContourPoint[] | null;
  previewUrl: string | null;
  transientPreviewUrl: string | null;
  score: number | null;
}

export interface SegmentationPromptSnapshot {
  points: SegmentationPromptPoint[];
  box: SegmentationPromptBox | null;
}

interface SegmentationPredictionRequest extends SegmentationPromptSnapshot {
  kind: 'committed' | 'transient';
  preparedKey: string;
  sceneWidth: number;
  sceneHeight: number;
}

type Listener = () => void;

const sessions = new Map<string, SegmentationSessionState>();
const listeners = new Map<string, Set<Listener>>();
const predictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const runningPredictions = new Set<string>();
const runningPredictionRequests = new Map<
  string,
  Pick<SegmentationPredictionRequest, 'kind'> & { version: number }
>();
const scheduledPredictionKinds = new Map<string, SegmentationPredictionRequest['kind']>();
const preparationVersions = new Map<string, number>();
const predictionVersions = new Map<string, number>();
const cleanupVersions = new Map<string, number>();
const MAX_PROMPT_HISTORY = 128;

const createEmptyPromptSnapshot = (): SegmentationPromptSnapshot => ({ points: [], box: null });

const clonePromptSnapshot = (snapshot: SegmentationPromptSnapshot): SegmentationPromptSnapshot => ({
  points: snapshot.points.map((point) => ({ ...point })),
  box: snapshot.box ? { ...snapshot.box } : null,
});

const createInitialSession = (nodeId: string): SegmentationSessionState => ({
  nodeId,
  modelId: SAM3_TRACKER_MODEL_ID,
  modelVariant: DEFAULT_SAM3_MODEL_VARIANT,
  modelVariantLabel: getSam3ModelVariant(DEFAULT_SAM3_MODEL_VARIANT).label,
  status: 'idle',
  modelProgress: null,
  backend: null,
  error: null,
  sourceId: null,
  sourceLabel: null,
  sourceFrame: null,
  sourceKey: null,
  preparedKey: null,
  imageWidth: 0,
  imageHeight: 0,
  sceneWidth: 0,
  sceneHeight: 0,
  promptMode: 'point',
  promptLabel: 'include',
  points: [],
  box: null,
  boxDraft: null,
  hoverPoint: null,
  promptHistory: [createEmptyPromptSnapshot()],
  promptHistoryIndex: 0,
  cleanup: { ...DEFAULT_SEGMENTATION_CLEANUP },
  logits: null,
  mask: null,
  contour: null,
  previewUrl: null,
  transientPreviewUrl: null,
  score: null,
});

export const getSegmentationSession = (nodeId: string): SegmentationSessionState => {
  let session = sessions.get(nodeId);
  if (!session) {
    session = createInitialSession(nodeId);
    sessions.set(nodeId, session);
  }
  return session;
};

const emit = (nodeId: string): void => listeners.get(nodeId)?.forEach((listener) => listener());

const updateSession = (
  nodeId: string,
  update:
    | Partial<SegmentationSessionState>
    | ((session: SegmentationSessionState) => Partial<SegmentationSessionState>),
): SegmentationSessionState => {
  const previous = getSegmentationSession(nodeId);
  const patch = typeof update === 'function' ? update(previous) : update;
  const next = { ...previous, ...patch };
  sessions.set(nodeId, next);
  emit(nodeId);
  return next;
};

const revokePreview = (url: string | null): void => {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
};

const replacePreview = (nodeId: string, previewUrl: string): void => {
  const previous = getSegmentationSession(nodeId).previewUrl;
  if (previous !== previewUrl) revokePreview(previous);
  updateSession(nodeId, { previewUrl });
};

const replaceTransientPreview = (nodeId: string, transientPreviewUrl: string): void => {
  const previous = getSegmentationSession(nodeId).transientPreviewUrl;
  if (previous !== transientPreviewUrl) revokePreview(previous);
  updateSession(nodeId, { transientPreviewUrl });
};

const clearTransientPreview = (nodeId: string, clearHoverPoint = true): void => {
  const scheduledKind = scheduledPredictionKinds.get(nodeId);
  const scheduledTimer = predictionTimers.get(nodeId);
  let invalidatedCurrentPreview = false;
  if (scheduledKind === 'transient' && scheduledTimer) {
    clearTimeout(scheduledTimer);
    predictionTimers.delete(nodeId);
    scheduledPredictionKinds.delete(nodeId);
    invalidatedCurrentPreview = true;
  }

  const running = runningPredictionRequests.get(nodeId);
  if (running?.kind === 'transient' && running.version === predictionVersions.get(nodeId)) {
    invalidatedCurrentPreview = true;
  }
  if (invalidatedCurrentPreview) getNextVersion(predictionVersions, nodeId);

  const state = getSegmentationSession(nodeId);
  revokePreview(state.transientPreviewUrl);
  updateSession(nodeId, {
    transientPreviewUrl: null,
    ...(clearHoverPoint ? { hoverPoint: null } : {}),
  });
};

const getNextVersion = (versions: Map<string, number>, nodeId: string): number => {
  const version = (versions.get(nodeId) ?? 0) + 1;
  versions.set(nodeId, version);
  return version;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const convertContourToScene = (
  contour: ContourPoint[],
  state: SegmentationSessionState,
): ContourPoint[] =>
  contour.map((point) => ({
    x: (point.x / Math.max(1, state.imageWidth)) * state.sceneWidth - state.sceneWidth / 2,
    y: (point.y / Math.max(1, state.imageHeight)) * state.sceneHeight - state.sceneHeight / 2,
  }));

const rebuildProcessedMask = async (nodeId: string, version: number): Promise<void> => {
  const state = getSegmentationSession(nodeId);
  if (!state.logits || state.imageWidth <= 0 || state.imageHeight <= 0) return;

  const mask = cleanSegmentationMask(
    state.logits,
    state.imageWidth,
    state.imageHeight,
    state.cleanup,
  );
  const contour = getLargestContour(findMaskContours(mask, state.imageWidth, state.imageHeight));
  const blob = await createSegmentationPreviewBlob(mask, state.imageWidth, state.imageHeight);
  const previewUrl = URL.createObjectURL(blob);
  if (cleanupVersions.get(nodeId) !== version) {
    revokePreview(previewUrl);
    return;
  }

  updateSession(nodeId, {
    status: 'ready',
    mask,
    contour: contour ? convertContourToScene(contour, state) : null,
  });
  replacePreview(nodeId, previewUrl);
  const latest = getSegmentationSession(nodeId);
  if (latest.hoverPoint) {
    requestTransientPrediction(nodeId, {
      points: [...latest.points, latest.hoverPoint],
      box: latest.box,
    });
  } else if (latest.boxDraft) {
    requestTransientPrediction(nodeId, { points: latest.points, box: latest.boxDraft });
  } else {
    revokePreview(latest.transientPreviewUrl);
    updateSession(nodeId, { transientPreviewUrl: null });
  }
};

const rebuildTransientPreview = async (
  nodeId: string,
  version: number,
  logits: Float32Array,
  width: number,
  height: number,
): Promise<void> => {
  const state = getSegmentationSession(nodeId);
  const mask = cleanSegmentationMask(logits, width, height, state.cleanup);
  const blob = await createSegmentationPreviewBlob(mask, width, height);
  const previewUrl = URL.createObjectURL(blob);
  if (predictionVersions.get(nodeId) !== version) {
    revokePreview(previewUrl);
    return;
  }
  replaceTransientPreview(nodeId, previewUrl);
  const latest = getSegmentationSession(nodeId);
  if (latest.error) updateSession(nodeId, { status: 'ready', error: null });
};

const scheduleCleanup = (nodeId: string, delay = 60): void => {
  const existing = cleanupTimers.get(nodeId);
  if (existing) clearTimeout(existing);
  const version = getNextVersion(cleanupVersions, nodeId);
  if (getSegmentationSession(nodeId).logits) {
    updateSession(nodeId, { status: 'cleaning', error: null });
  }
  cleanupTimers.set(
    nodeId,
    setTimeout(() => {
      cleanupTimers.delete(nodeId);
      void rebuildProcessedMask(nodeId, version).catch((error) => {
        if (cleanupVersions.get(nodeId) !== version) return;
        updateSession(nodeId, { status: 'error', error: getErrorMessage(error) });
      });
    }, delay),
  );
};

const runPrediction = async (
  nodeId: string,
  version: number,
  request: SegmentationPredictionRequest,
): Promise<void> => {
  if (runningPredictions.has(nodeId)) return;
  if (request.points.length === 0 && !request.box) return;
  runningPredictions.add(nodeId);
  runningPredictionRequests.set(nodeId, { kind: request.kind, version });
  if (request.kind === 'committed') {
    updateSession(nodeId, { status: 'decoding', error: null });
  }

  try {
    const result = await predictSam3Mask({
      preparedKey: request.preparedKey,
      points: request.points,
      box: request.box,
      sceneWidth: request.sceneWidth,
      sceneHeight: request.sceneHeight,
    });
    if (predictionVersions.get(nodeId) !== version) return;
    if (request.kind === 'transient') {
      await rebuildTransientPreview(nodeId, version, result.logits, result.width, result.height);
      return;
    }
    updateSession(nodeId, {
      status: 'ready',
      logits: result.logits,
      imageWidth: result.width,
      imageHeight: result.height,
      score: result.score,
    });
    scheduleCleanup(nodeId, 0);
  } catch (error) {
    if (predictionVersions.get(nodeId) !== version) return;
    updateSession(nodeId, {
      ...(request.kind === 'committed' ? { status: 'error' as const } : {}),
      error: getErrorMessage(error),
    });
  } finally {
    runningPredictions.delete(nodeId);
    const running = runningPredictionRequests.get(nodeId);
    if (running?.version === version) runningPredictionRequests.delete(nodeId);
  }
};

const schedulePredictionRun = (
  nodeId: string,
  version: number,
  delay: number,
  request: SegmentationPredictionRequest,
): void => {
  scheduledPredictionKinds.set(nodeId, request.kind);
  predictionTimers.set(
    nodeId,
    setTimeout(() => {
      predictionTimers.delete(nodeId);
      scheduledPredictionKinds.delete(nodeId);
      if (predictionVersions.get(nodeId) !== version) return;
      if (runningPredictions.has(nodeId)) {
        schedulePredictionRun(nodeId, version, 16, request);
        return;
      }
      void runPrediction(nodeId, version, request);
    }, delay),
  );
};

export const requestSegmentationPrediction = (nodeId: string, delay = 45): void => {
  const existing = predictionTimers.get(nodeId);
  if (existing) clearTimeout(existing);
  scheduledPredictionKinds.delete(nodeId);
  const version = getNextVersion(predictionVersions, nodeId);
  const state = getSegmentationSession(nodeId);

  if (!state.preparedKey || (state.points.length === 0 && !state.box)) {
    getNextVersion(cleanupVersions, nodeId);
    revokePreview(state.previewUrl);
    revokePreview(state.transientPreviewUrl);
    updateSession(nodeId, {
      status: state.preparedKey ? 'ready' : 'idle',
      logits: null,
      mask: null,
      contour: null,
      previewUrl: null,
      transientPreviewUrl: null,
      hoverPoint: null,
      score: null,
      error: null,
    });
    return;
  }

  const cleanupTimer = cleanupTimers.get(nodeId);
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimers.delete(nodeId);
  getNextVersion(cleanupVersions, nodeId);
  updateSession(nodeId, { status: 'decoding', error: null });

  schedulePredictionRun(nodeId, version, delay, {
    kind: 'committed',
    preparedKey: state.preparedKey,
    points: state.points.map((point) => ({ ...point })),
    box: state.box ? { ...state.box } : null,
    sceneWidth: state.sceneWidth,
    sceneHeight: state.sceneHeight,
  });
};

const requestTransientPrediction = (
  nodeId: string,
  snapshot: SegmentationPromptSnapshot,
  delay = 80,
): void => {
  const state = getSegmentationSession(nodeId);
  if (
    !state.preparedKey ||
    state.status === 'decoding' ||
    (snapshot.points.length === 0 && !snapshot.box)
  ) {
    return;
  }

  const existing = predictionTimers.get(nodeId);
  if (existing) clearTimeout(existing);
  scheduledPredictionKinds.delete(nodeId);
  const version = getNextVersion(predictionVersions, nodeId);
  schedulePredictionRun(nodeId, version, delay, {
    kind: 'transient',
    preparedKey: state.preparedKey,
    points: snapshot.points.map((point) => ({ ...point })),
    box: snapshot.box ? { ...snapshot.box } : null,
    sceneWidth: state.sceneWidth,
    sceneHeight: state.sceneHeight,
  });
};

export const prepareSegmentationSession = async ({
  nodeId,
  sourceId,
  sourceLabel,
  sourceFrame,
  input,
  modelVariant = DEFAULT_SAM3_MODEL_VARIANT,
  runtimePreferences = {},
}: {
  nodeId: string;
  sourceId: string;
  sourceLabel: string;
  sourceFrame: number;
  input: SegmentationFrameInput;
  modelVariant?: RotoSegmentationModelVariant;
  runtimePreferences?: OnnxRuntimePreferences;
}): Promise<void> => {
  const preparationVersion = getNextVersion(preparationVersions, nodeId);
  getNextVersion(predictionVersions, nodeId);
  getNextVersion(cleanupVersions, nodeId);
  const previous = getSegmentationSession(nodeId);
  const sourceChanged = previous.sourceKey !== input.key || previous.modelVariant !== modelVariant;
  if (sourceChanged) {
    revokePreview(previous.previewUrl);
    revokePreview(previous.transientPreviewUrl);
  }
  updateSession(nodeId, {
    status: 'loading-model',
    modelProgress: null,
    error: null,
    sourceId,
    sourceLabel,
    sourceFrame,
    sourceKey: input.key,
    modelVariant,
    modelVariantLabel: getSam3ModelVariant(modelVariant).label,
    preparedKey: null,
    imageWidth: input.width,
    imageHeight: input.height,
    sceneWidth: input.sceneWidth,
    sceneHeight: input.sceneHeight,
    ...(sourceChanged
      ? {
          points: [],
          box: null,
          boxDraft: null,
          hoverPoint: null,
          promptHistory: [createEmptyPromptSnapshot()],
          promptHistoryIndex: 0,
          logits: null,
          mask: null,
          contour: null,
          previewUrl: null,
          transientPreviewUrl: null,
          score: null,
        }
      : {}),
  });

  const unsubscribe = subscribeToSam3ModelProgress((modelProgress) => {
    if (preparationVersions.get(nodeId) !== preparationVersion) return;
    updateSession(nodeId, { modelProgress });
  });
  try {
    const result = await prepareSam3Frame(input, {
      variantId: modelVariant,
      runtimePreferences,
      onEncoderStart: () => {
        if (preparationVersions.get(nodeId) === preparationVersion) {
          updateSession(nodeId, { status: 'encoding' });
        }
      },
    });
    if (preparationVersions.get(nodeId) !== preparationVersion) return;
    updateSession(nodeId, {
      status: 'ready',
      backend: result.backend,
      modelVariant: result.variantId,
      modelVariantLabel: getSam3ModelVariant(result.variantId).label,
      preparedKey: result.key,
      modelProgress: null,
      error: null,
    });
    const state = getSegmentationSession(nodeId);
    if (state.points.length > 0 || state.box) requestSegmentationPrediction(nodeId, 0);
  } catch (error) {
    if (preparationVersions.get(nodeId) !== preparationVersion) return;
    updateSession(nodeId, { status: 'error', error: getErrorMessage(error) });
  } finally {
    unsubscribe();
  }
};

export const setSegmentationPromptMode = (
  nodeId: string,
  promptMode: SegmentationPromptMode,
): void => {
  clearTransientPreview(nodeId);
  updateSession(nodeId, { promptMode, boxDraft: null });
};

export const setSegmentationPromptLabel = (
  nodeId: string,
  promptLabel: SegmentationPromptLabel,
): void => {
  clearTransientPreview(nodeId);
  updateSession(nodeId, { promptLabel });
};

const commitPromptSnapshot = (
  nodeId: string,
  snapshot: SegmentationPromptSnapshot,
  preserveTransientPreview = false,
): void => {
  const state = getSegmentationSession(nodeId);
  const nextSnapshot = clonePromptSnapshot(snapshot);
  const history = [
    ...state.promptHistory.slice(0, state.promptHistoryIndex + 1),
    clonePromptSnapshot(nextSnapshot),
  ].slice(-MAX_PROMPT_HISTORY);
  updateSession(nodeId, {
    ...nextSnapshot,
    boxDraft: null,
    hoverPoint: null,
    promptHistory: history,
    promptHistoryIndex: history.length - 1,
  });
  if (!preserveTransientPreview) clearTransientPreview(nodeId);
  requestSegmentationPrediction(nodeId);
};

export const addSegmentationPoint = (
  nodeId: string,
  point: Omit<SegmentationPromptPoint, 'id'>,
): void => {
  const state = getSegmentationSession(nodeId);
  commitPromptSnapshot(
    nodeId,
    {
      points: [...state.points, { ...point, id: `prompt_${crypto.randomUUID()}` }],
      box: state.box,
    },
    true,
  );
};

export const undoSegmentationPrompt = (nodeId: string): void => {
  const state = getSegmentationSession(nodeId);
  if (state.promptHistoryIndex <= 0) return;
  const promptHistoryIndex = state.promptHistoryIndex - 1;
  const snapshot = clonePromptSnapshot(state.promptHistory[promptHistoryIndex]);
  updateSession(nodeId, {
    ...snapshot,
    boxDraft: null,
    hoverPoint: null,
    promptHistoryIndex,
  });
  clearTransientPreview(nodeId);
  requestSegmentationPrediction(nodeId, 0);
};

export const redoSegmentationPrompt = (nodeId: string): void => {
  const state = getSegmentationSession(nodeId);
  if (state.promptHistoryIndex >= state.promptHistory.length - 1) return;
  const promptHistoryIndex = state.promptHistoryIndex + 1;
  const snapshot = clonePromptSnapshot(state.promptHistory[promptHistoryIndex]);
  updateSession(nodeId, {
    ...snapshot,
    boxDraft: null,
    hoverPoint: null,
    promptHistoryIndex,
  });
  clearTransientPreview(nodeId);
  requestSegmentationPrediction(nodeId, 0);
};

export const setSegmentationBoxDraft = (
  nodeId: string,
  boxDraft: SegmentationPromptBox | null,
): void => {
  updateSession(nodeId, { boxDraft });
  if (!boxDraft || (boxDraft.x1 === boxDraft.x2 && boxDraft.y1 === boxDraft.y2)) {
    clearTransientPreview(nodeId, false);
    return;
  }
  const state = getSegmentationSession(nodeId);
  requestTransientPrediction(nodeId, { points: state.points, box: boxDraft });
};

export const commitSegmentationBox = (nodeId: string, box: SegmentationPromptBox): void => {
  const state = getSegmentationSession(nodeId);
  commitPromptSnapshot(nodeId, { points: state.points, box }, true);
};

export const setSegmentationHoverPoint = (
  nodeId: string,
  point: Omit<SegmentationPromptPoint, 'id'> | null,
): void => {
  if (!point) {
    clearTransientPreview(nodeId);
    return;
  }
  const hoverPoint = { ...point, id: 'segmentation-hover' } satisfies SegmentationPromptPoint;
  updateSession(nodeId, { hoverPoint });
  const state = getSegmentationSession(nodeId);
  requestTransientPrediction(nodeId, {
    points: [...state.points, hoverPoint],
    box: state.box,
  });
};

export const clearSegmentationTransientPreview = (nodeId: string): void => {
  clearTransientPreview(nodeId);
};

export const setSegmentationCleanup = (
  nodeId: string,
  cleanup: Partial<SegmentationCleanupSettings>,
): void => {
  clearTransientPreview(nodeId);
  updateSession(nodeId, (state) => ({ cleanup: { ...state.cleanup, ...cleanup } }));
  if (
    cleanup.threshold !== undefined ||
    cleanup.removeSpecks !== undefined ||
    cleanup.fillHoles !== undefined
  ) {
    if (getSegmentationSession(nodeId).status !== 'decoding') scheduleCleanup(nodeId);
  }
};

export const resetSegmentationSession = (nodeId: string): void => {
  const predictionTimer = predictionTimers.get(nodeId);
  if (predictionTimer) clearTimeout(predictionTimer);
  predictionTimers.delete(nodeId);
  const cleanupTimer = cleanupTimers.get(nodeId);
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimers.delete(nodeId);
  getNextVersion(preparationVersions, nodeId);
  getNextVersion(predictionVersions, nodeId);
  getNextVersion(cleanupVersions, nodeId);
  scheduledPredictionKinds.delete(nodeId);

  const previous = getSegmentationSession(nodeId);
  revokePreview(previous.previewUrl);
  revokePreview(previous.transientPreviewUrl);
  updateSession(nodeId, {
    status: 'idle',
    modelProgress: null,
    error: null,
    sourceId: null,
    sourceLabel: null,
    sourceFrame: null,
    sourceKey: null,
    preparedKey: null,
    imageWidth: 0,
    imageHeight: 0,
    sceneWidth: 0,
    sceneHeight: 0,
    points: [],
    box: null,
    boxDraft: null,
    hoverPoint: null,
    promptHistory: [createEmptyPromptSnapshot()],
    promptHistoryIndex: 0,
    logits: null,
    mask: null,
    contour: null,
    previewUrl: null,
    transientPreviewUrl: null,
    score: null,
  });
};

export const resetAllSegmentationSessions = (): void => {
  Array.from(sessions.keys()).forEach(resetSegmentationSession);
};

export const clearSegmentationPrompts = (nodeId: string): void => {
  const state = getSegmentationSession(nodeId);
  if (state.points.length === 0 && !state.box) return;
  commitPromptSnapshot(nodeId, createEmptyPromptSnapshot());
};

export const resetSegmentationPrompts = (nodeId: string): void => {
  clearTransientPreview(nodeId);
  updateSession(nodeId, {
    points: [],
    box: null,
    boxDraft: null,
    hoverPoint: null,
    promptHistory: [createEmptyPromptSnapshot()],
    promptHistoryIndex: 0,
  });
  requestSegmentationPrediction(nodeId, 0);
};

export const dismissSegmentationError = (nodeId: string): void => {
  const state = getSegmentationSession(nodeId);
  updateSession(nodeId, { status: state.preparedKey ? 'ready' : 'idle', error: null });
};

export const reportSegmentationError = (nodeId: string, error: unknown): void => {
  updateSession(nodeId, { status: 'error', error: getErrorMessage(error) });
};

export const subscribeToSegmentationSession = (
  nodeId: string,
  listener: Listener,
): (() => void) => {
  let nodeListeners = listeners.get(nodeId);
  if (!nodeListeners) {
    nodeListeners = new Set();
    listeners.set(nodeId, nodeListeners);
  }
  nodeListeners.add(listener);
  return () => {
    nodeListeners?.delete(listener);
    if (nodeListeners?.size === 0) listeners.delete(nodeId);
  };
};

export const useSegmentationSession = (nodeId: string): SegmentationSessionState =>
  useSyncExternalStore(
    (listener) => subscribeToSegmentationSession(nodeId, listener),
    () => getSegmentationSession(nodeId),
    () => getSegmentationSession(nodeId),
  );
