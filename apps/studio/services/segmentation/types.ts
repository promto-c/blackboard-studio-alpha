export type SegmentationPromptLabel = 'include' | 'exclude';
export type SegmentationPromptMode = 'point' | 'box';

export interface SegmentationPromptPoint {
  id: string;
  x: number;
  y: number;
  label: SegmentationPromptLabel;
}

export interface SegmentationPromptBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SegmentationFrameInput {
  key: string;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  sceneWidth: number;
  sceneHeight: number;
}

export interface SegmentationPredictionInput {
  preparedKey: string;
  points: SegmentationPromptPoint[];
  box: SegmentationPromptBox | null;
  sceneWidth: number;
  sceneHeight: number;
}

export interface SegmentationPrediction {
  logits: Float32Array;
  width: number;
  height: number;
  score: number;
}

export interface SegmentationModelProgress {
  progress: number | null;
  file: string | null;
  loaded: number;
  total: number | null;
}
