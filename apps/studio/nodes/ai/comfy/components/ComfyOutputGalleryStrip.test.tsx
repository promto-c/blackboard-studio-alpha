// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { GeneratedOutput } from '@blackboard/types';
import { describe, expect, it, vi } from 'vitest';
import { ComfyOutputGalleryStrip } from './ComfyOutputGalleryStrip';

vi.mock('./ComfyOutputThumbnail', () => ({
  ComfyOutputThumbnail: ({ output }: { output: GeneratedOutput }) => (
    <button type="button" data-testid="output-thumbnail">
      {output.id}
    </button>
  ),
}));

const makeOutput = (index: number): GeneratedOutput => ({
  id: `output-${index}`,
  src: `asset-${index}`,
  width: 128,
  height: 128,
  createdAt: index,
});

describe('ComfyOutputGalleryStrip', () => {
  it('keeps More in the header and exposes every output in the horizontal strip', () => {
    const onOpenGallery = vi.fn();
    const outputs = Array.from({ length: 12 }, (_, index) => makeOutput(index));

    render(
      <ComfyOutputGalleryStrip
        label="Recent outputs"
        outputs={outputs}
        onActivateOutput={vi.fn()}
        onOpenGallery={onOpenGallery}
      />,
    );

    expect(screen.getByRole('region', { name: 'Recent outputs thumbnails' })).toBeTruthy();
    expect(screen.getAllByTestId('output-thumbnail')).toHaveLength(outputs.length);
    expect(screen.getByLabelText('12 outputs')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(onOpenGallery).toHaveBeenCalledOnce();
  });
});
