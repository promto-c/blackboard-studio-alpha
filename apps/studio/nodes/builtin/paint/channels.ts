import type { PaintBrushChannels, PaintStrokeChannels, ViewerSettings } from '@blackboard/types';

export const resolvePaintBrushChannels = (
  channels: PaintBrushChannels,
  viewerChannels: ViewerSettings['channels'],
): PaintStrokeChannels => {
  if (channels !== 'view') {
    return channels;
  }

  switch (viewerChannels) {
    case 'R':
      return 'r';
    case 'G':
      return 'g';
    case 'B':
      return 'b';
    case 'A':
      return 'a';
    case 'RGB':
    default:
      return 'rgb';
  }
};
