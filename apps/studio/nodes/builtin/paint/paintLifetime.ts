import type { PaintLifetime, PaintLifetimePreset } from '@blackboard/types';

export const DEFAULT_NEW_STROKE_LIFETIME: PaintLifetimePreset = {
  mode: 'current_frame',
};

const sanitizeFrame = (frame: number): number =>
  Number.isFinite(frame) ? Math.max(0, Math.round(frame)) : 0;

export const clampPaintFrame = (frame: number, maxFrame?: number): number => {
  const nextFrame = sanitizeFrame(frame);
  if (maxFrame === undefined || !Number.isFinite(maxFrame)) {
    return nextFrame;
  }
  return Math.min(nextFrame, Math.max(0, Math.round(maxFrame)));
};

export const normalizePaintLifetime = (lifetime?: PaintLifetime | null): PaintLifetime => {
  if (!lifetime || lifetime.mode === 'all') {
    return { mode: 'all' };
  }

  if (lifetime.mode === 'single') {
    return {
      mode: 'single',
      frame: sanitizeFrame(lifetime.frame),
    };
  }

  const startFrame = sanitizeFrame(lifetime.startFrame);
  const endFrame = sanitizeFrame(lifetime.endFrame);

  return {
    mode: 'range',
    startFrame: Math.min(startFrame, endFrame),
    endFrame: Math.max(startFrame, endFrame),
  };
};

export const normalizePaintLifetimePreset = (
  preset?: PaintLifetimePreset | null,
): PaintLifetimePreset => {
  if (!preset || preset.mode === 'all') {
    return { mode: 'all' };
  }

  if (preset.mode === 'current_frame') {
    return { mode: 'current_frame' };
  }

  const startFrame = sanitizeFrame(preset.startFrame);
  const endFrame = sanitizeFrame(preset.endFrame);

  return {
    mode: 'range',
    startFrame: Math.min(startFrame, endFrame),
    endFrame: Math.max(startFrame, endFrame),
  };
};

export const resolvePaintLifetimePreset = (
  preset: PaintLifetimePreset | null | undefined,
  currentFrame: number,
): PaintLifetime => {
  const normalizedPreset = normalizePaintLifetimePreset(preset);

  if (normalizedPreset.mode === 'current_frame') {
    return {
      mode: 'single',
      frame: sanitizeFrame(currentFrame),
    };
  }

  if (normalizedPreset.mode === 'range') {
    return {
      mode: 'range',
      startFrame: normalizedPreset.startFrame,
      endFrame: normalizedPreset.endFrame,
    };
  }

  return { mode: 'all' };
};

export const isPaintLifetimeActiveAtFrame = (
  lifetime: PaintLifetime | null | undefined,
  frame: number,
): boolean => {
  const normalizedLifetime = normalizePaintLifetime(lifetime);
  const safeFrame = sanitizeFrame(frame);

  if (normalizedLifetime.mode === 'all') {
    return true;
  }

  if (normalizedLifetime.mode === 'single') {
    return safeFrame === normalizedLifetime.frame;
  }

  return safeFrame >= normalizedLifetime.startFrame && safeFrame <= normalizedLifetime.endFrame;
};

export const getPaintLifetimeLabel = (lifetime: PaintLifetime | null | undefined): string => {
  const normalizedLifetime = normalizePaintLifetime(lifetime);

  if (normalizedLifetime.mode === 'all') {
    return 'All Frames';
  }

  if (normalizedLifetime.mode === 'single') {
    return `Frame ${normalizedLifetime.frame}`;
  }

  return `Frames ${normalizedLifetime.startFrame}-${normalizedLifetime.endFrame}`;
};

export const getPaintLifetimeBadgeLabel = (
  lifetime: PaintLifetime | null | undefined,
): string | null => {
  const normalizedLifetime = normalizePaintLifetime(lifetime);

  if (normalizedLifetime.mode === 'all') {
    return null;
  }

  if (normalizedLifetime.mode === 'single') {
    return `F${normalizedLifetime.frame}`;
  }

  return `${normalizedLifetime.startFrame}-${normalizedLifetime.endFrame}`;
};

export const getPaintLifetimePresetLabel = (
  preset: PaintLifetimePreset | null | undefined,
): string => {
  const normalizedPreset = normalizePaintLifetimePreset(preset);

  if (normalizedPreset.mode === 'all') {
    return 'All Frames';
  }

  if (normalizedPreset.mode === 'current_frame') {
    return 'Current Frame';
  }

  return `Frames ${normalizedPreset.startFrame}-${normalizedPreset.endFrame}`;
};
