import type { MatteControlNode, MatteControlSettings } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';

export const MATTE_CONTROL_LIMITS = {
  morphology: { min: -32, max: 32, step: 1 },
  edgeBlur: { min: 0, max: 32, step: 0.25 },
  clamp: { min: 0, max: 1, step: 0.001, minGap: 0.001 },
} as const;

export const createDefaultMatteControlSettings = (): MatteControlSettings => ({
  erodeDilate: 0,
  edgeBlur: 0,
  clampBlack: 0,
  clampWhite: 1,
  invert: false,
});

export interface ResolvedMatteControlSettings {
  erodeDilate: number;
  edgeBlur: number;
  clampBlack: number;
  clampWhite: number;
  invert: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const resolveMatteControlSettings = (
  node: MatteControlNode,
  frame: number,
): ResolvedMatteControlSettings => {
  const settings = node.matteControl;
  const firstClampPoint = clamp(getValueAtFrame(settings.clampBlack, frame), 0, 1);
  const secondClampPoint = clamp(getValueAtFrame(settings.clampWhite, frame), 0, 1);
  return {
    erodeDilate: Math.round(
      clamp(
        getValueAtFrame(settings.erodeDilate, frame),
        MATTE_CONTROL_LIMITS.morphology.min,
        MATTE_CONTROL_LIMITS.morphology.max,
      ),
    ),
    edgeBlur: clamp(
      getValueAtFrame(settings.edgeBlur, frame),
      MATTE_CONTROL_LIMITS.edgeBlur.min,
      MATTE_CONTROL_LIMITS.edgeBlur.max,
    ),
    clampBlack: Math.min(firstClampPoint, secondClampPoint),
    clampWhite: Math.max(firstClampPoint, secondClampPoint),
    invert: settings.invert,
  };
};
