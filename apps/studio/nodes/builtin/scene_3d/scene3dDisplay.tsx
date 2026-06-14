import React from 'react';
import type { Scene3DItemType } from '@blackboard/types';
import * as Icons from '@blackboard/icons';

export const scene3DItemTypeLabel: Record<Scene3DItemType, string> = {
  output_plane: 'Plane',
  camera: 'Camera',
  light: 'Light',
  box: 'Box',
  model: 'Model',
  splat: 'Splat',
  empty: 'Empty',
};

const scene3DItemTypeIcon: Record<Scene3DItemType, React.ComponentType<{ className?: string }>> = {
  output_plane: Icons.Rectangle,
  camera: Icons.Video,
  light: Icons.LightBulb,
  box: Icons.CubeTransparent,
  model: Icons.Bundle,
  splat: Icons.Sparkles,
  empty: Icons.Pin,
};

export function Scene3DItemTypeIcon({
  type,
  className = 'h-3.5 w-3.5',
}: {
  type: Scene3DItemType;
  className?: string;
}) {
  const Icon = scene3DItemTypeIcon[type] ?? Icons.Pin;
  return <Icon className={className} />;
}
