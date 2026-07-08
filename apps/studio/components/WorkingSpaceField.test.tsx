// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ColorSpaceInfo } from '@/color-management';
import { WorkingSpaceField } from './WorkingSpaceField';

const colorSpaces: ColorSpaceInfo[] = [
  {
    name: 'ACEScg',
    canonicalName: 'ACEScg',
    aliases: [],
    categories: [],
    family: 'ACES',
    encoding: 'scene-linear',
    description: 'ACEScg scene linear',
    isData: false,
  },
  {
    name: 'ACES2065-1',
    canonicalName: 'ACES2065-1',
    aliases: [],
    categories: [],
    family: 'ACES',
    encoding: 'scene-linear',
    description: 'ACES scene-linear interchange',
    isData: false,
  },
  {
    name: 'Raw',
    canonicalName: 'Raw',
    aliases: [],
    categories: [],
    family: 'Data',
    encoding: '',
    description: 'Data space',
    isData: true,
  },
  {
    name: 'ACEScct',
    canonicalName: 'ACEScct',
    aliases: [],
    categories: [],
    family: 'ACES',
    encoding: 'log',
    description: 'ACES log grading space',
    isData: false,
  },
  {
    name: 'sRGB Display',
    canonicalName: 'sRGB Display',
    aliases: [],
    categories: [],
    family: 'Display',
    encoding: 'display',
    description: 'Display-referred sRGB',
    isData: false,
  },
];

describe('WorkingSpaceField', () => {
  it('shows the resolved scene_linear working space as a read-only field', () => {
    render(<WorkingSpaceField colorSpaces={colorSpaces} resolvedWorkingSpace="ACEScg" />);

    expect(screen.getByText('ACEScg')).toBeTruthy();
    expect(screen.getByText('scene_linear')).toBeTruthy();
    expect(screen.getByText('Resolved from project role')).toBeTruthy();
    expect(screen.queryByText('Advanced')).toBeNull();
  });

  it('keeps override controls under Advanced and lists only scene-linear candidates', () => {
    const onOverrideChange = vi.fn();

    render(
      <WorkingSpaceField
        colorSpaces={colorSpaces}
        resolvedWorkingSpace="ACEScg"
        override="ACES2065-1"
        onOverrideChange={onOverrideChange}
      />,
    );

    fireEvent.click(screen.getByText('Advanced'));

    expect(screen.getByText('Working-space override active')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /ACES2065-1/ }));

    expect(screen.getByRole('button', { name: /ACEScg/ })).toBeTruthy();
    expect(screen.queryByText('Raw')).toBeNull();
    expect(screen.queryByText('ACEScct')).toBeNull();
    expect(screen.queryByText('sRGB Display')).toBeNull();

    fireEvent.click(screen.getByTitle('Reset working-space override'));

    expect(onOverrideChange).toHaveBeenCalledWith(null);
  });
});
