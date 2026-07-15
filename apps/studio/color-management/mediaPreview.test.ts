import { describe, expect, it } from 'vitest';
import { createDefaultProjectColorManagement } from './project';
import { createProjectDefaultMediaColorManagement } from './media';
import { resolveMediaPreviewColorManagement } from './mediaPreview';

const display = 'sRGB - Display';
const getViews = () => [
  {
    name: 'ACES 2.0 - SDR 100 nits (Rec.709)',
    colorSpace: 'ACEScg',
    transform: 'display',
    looks: '',
  },
  {
    name: 'Video (colorimetric)',
    colorSpace: 'ACEScg',
    transform: 'display',
    looks: '',
  },
];

describe('media preview color management', () => {
  it('uses the viewport auto-detected view for SDR gallery media', () => {
    const projectColorManagement = createDefaultProjectColorManagement();

    const resolved = resolveMediaPreviewColorManagement({
      projectColorManagement,
      mediaColorManagement: createProjectDefaultMediaColorManagement(),
      autoDetectDisplayView: true,
      defaultDisplay: display,
      getViews,
    });

    expect(resolved).toEqual({
      ...projectColorManagement,
      viewer: { display, view: 'Video (colorimetric)' },
    });
    expect(projectColorManagement.viewer.view).toBe('ACES 2.0 - SDR 100 nits (Rec.709)');
  });

  it('uses the colorimetric video view for linear Rec.709 Comfy EXR media', () => {
    const projectColorManagement = createDefaultProjectColorManagement();

    const resolved = resolveMediaPreviewColorManagement({
      projectColorManagement,
      mediaColorManagement: createProjectDefaultMediaColorManagement('Linear Rec.709 (sRGB)'),
      autoDetectDisplayView: true,
      defaultDisplay: display,
      getViews,
    });

    expect(resolved.viewer).toEqual({
      display,
      view: 'Video (colorimetric)',
    });
  });

  it('keeps the configured project view when auto-detect is disabled', () => {
    const projectColorManagement = createDefaultProjectColorManagement();

    expect(
      resolveMediaPreviewColorManagement({
        projectColorManagement,
        mediaColorManagement: createProjectDefaultMediaColorManagement(),
        autoDetectDisplayView: false,
        defaultDisplay: display,
        getViews,
      }),
    ).toBe(projectColorManagement);
  });

  it('keeps the configured project view for non-SDR media', () => {
    const projectColorManagement = createDefaultProjectColorManagement();

    expect(
      resolveMediaPreviewColorManagement({
        projectColorManagement,
        mediaColorManagement: createProjectDefaultMediaColorManagement('ACEScg'),
        autoDetectDisplayView: true,
        defaultDisplay: display,
        getViews,
      }),
    ).toBe(projectColorManagement);
  });

  it('keeps the configured project view when the recommended OCIO view is unavailable', () => {
    const projectColorManagement = createDefaultProjectColorManagement();

    expect(
      resolveMediaPreviewColorManagement({
        projectColorManagement,
        mediaColorManagement: createProjectDefaultMediaColorManagement(),
        autoDetectDisplayView: true,
        defaultDisplay: display,
        getViews: () => getViews().filter((view) => view.name !== 'Video (colorimetric)'),
      }),
    ).toBe(projectColorManagement);
  });
});
