import { describe, expect, it } from 'vitest';
import { toggleTransformWithHierarchy, type TransformToggles } from './transformHierarchy';

function applyToggle(current: TransformToggles, field: keyof TransformToggles): TransformToggles {
  return { ...current, ...toggleTransformWithHierarchy(current, field) };
}

describe('toggleTransformWithHierarchy', () => {
  it('enables prerequisites for affine', () => {
    const current: TransformToggles = {
      translation: true,
      rotation: false,
      scale: false,
      affine: false,
      perspective: false,
    };

    expect(applyToggle(current, 'affine')).toEqual({
      translation: true,
      rotation: true,
      scale: true,
      affine: true,
      perspective: false,
    });
  });

  it('turns off the selected component when no higher model depends on it', () => {
    const current: TransformToggles = {
      translation: true,
      rotation: true,
      scale: true,
      affine: false,
      perspective: false,
    };

    expect(applyToggle(current, 'rotation')).toEqual({
      translation: true,
      rotation: false,
      scale: true,
      affine: false,
      perspective: false,
    });
  });

  it('downgrades perspective to affine when shear is selected', () => {
    const current: TransformToggles = {
      translation: true,
      rotation: true,
      scale: true,
      affine: true,
      perspective: true,
    };

    expect(applyToggle(current, 'affine')).toEqual({
      translation: true,
      rotation: true,
      scale: true,
      affine: true,
      perspective: false,
    });
  });

  it('keeps scale active when downgrading affine through rot', () => {
    const current: TransformToggles = {
      translation: true,
      rotation: true,
      scale: true,
      affine: true,
      perspective: false,
    };

    expect(applyToggle(current, 'rotation')).toEqual({
      translation: true,
      rotation: true,
      scale: true,
      affine: false,
      perspective: false,
    });
  });

  it('keeps scale active when downgrading perspective through rot', () => {
    const current: TransformToggles = {
      translation: true,
      rotation: true,
      scale: true,
      affine: true,
      perspective: true,
    };

    expect(applyToggle(current, 'rotation')).toEqual({
      translation: true,
      rotation: true,
      scale: true,
      affine: false,
      perspective: false,
    });
  });

  it('drops rotation when downgrading affine through scale', () => {
    const current: TransformToggles = {
      translation: true,
      rotation: true,
      scale: true,
      affine: true,
      perspective: false,
    };

    expect(applyToggle(current, 'scale')).toEqual({
      translation: true,
      rotation: false,
      scale: true,
      affine: false,
      perspective: false,
    });
  });

  it('drops rotation when downgrading perspective through scale', () => {
    const current: TransformToggles = {
      translation: true,
      rotation: true,
      scale: true,
      affine: true,
      perspective: true,
    };

    expect(applyToggle(current, 'scale')).toEqual({
      translation: true,
      rotation: false,
      scale: true,
      affine: false,
      perspective: false,
    });
  });

  it('still allows additive similarity selection from a lower state', () => {
    const current: TransformToggles = {
      translation: true,
      rotation: true,
      scale: false,
      affine: false,
      perspective: false,
    };

    expect(applyToggle(current, 'scale')).toEqual({
      translation: true,
      rotation: true,
      scale: true,
      affine: false,
      perspective: false,
    });
  });
});
