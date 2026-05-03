/**
 * Shared type definitions for viewport overlays.
 *
 * These types were previously inline in Viewport.tsx and are now shared between
 * the main Viewport component and the extracted overlay components.
 */

import type { AnimatableNumber, RotoPath } from '@blackboard/types';
import type {
  RotoTransformBounds,
  ScenePoint,
  TransformHandleKind,
  TransformOperation,
} from '@/utils/rotoTransform';

export type NudgeAffectedPath = {
  pathId: string;
  originalPoints: { x: AnimatableNumber; y: AnimatableNumber }[];
  resolvedStartPoints: { x: number; y: number }[];
  affectedIndices: { index: number; dist: number }[];
};

export type NudgePreviewPoint = { pathId: string; pointIndex: number; weight: number };

export type GradientTrailPath = {
  key: string;
  d: string;
  stroke: string;
  opacity: number;
  strokeWidth: number;
  strokeDasharray?: string;
};

export type MotionBlurCuePath = GradientTrailPath;

export type RotoTemporalControllerMotionPoint = {
  pointIndex: number;
  prev: ScenePoint;
  old: ScenePoint;
  preview: ScenePoint;
  next: ScenePoint;
};

export type RotoTemporalControllerValue = {
  time: number;
  mix: number;
};

export type RotoTemporalControllerPath = {
  path: RotoPath;
  oldPoints: ScenePoint[];
  prevPoints: ScenePoint[];
  nextPoints: ScenePoint[];
  previewPoints: ScenePoint[];
  targetPointIndices: number[];
  motionPoints: RotoTemporalControllerMotionPoint[];
};

export type RotoTemporalControllerState = {
  value: number;
  mixValue: number;
  defaultValue: number;
  defaultMixValue: number;
  hasCurrentKeyframe: boolean;
  prevFrame: number;
  nextFrame: number;
  paths: RotoTemporalControllerPath[];
};

export type RotoTransformTargetRef = {
  pathId: string;
  pointIndex: number;
  trackOffset: ScenePoint;
};

export type RotoTransformSelection = {
  mode: 'points' | 'paths';
  refs: RotoTransformTargetRef[];
  points: ScenePoint[];
  bounds: RotoTransformBounds;
};

export type RotoTransformPathSnapshot = {
  pathId: string;
  path: RotoPath;
};

export type RotoTransformDragState = {
  handle: TransformHandleKind;
  baseOperation: TransformOperation;
  startMouse: ScenePoint;
  startBounds: RotoTransformBounds;
  startPoints: ScenePoint[];
  refs: RotoTransformTargetRef[];
  pathSnapshots: RotoTransformPathSnapshot[];
  selectionMode: 'points' | 'paths';
};
