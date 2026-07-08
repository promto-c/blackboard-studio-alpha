import { describe, expect, it } from 'vitest';
import { createDefaultProjectColorManagement } from '@/color-management';
import { getProjectColorManagementPanelModel } from './ProjectColorManagementPanel';

const colorSpace = (name: string, isData = false) => ({
  name,
  canonicalName: name,
  aliases: [],
  categories: [],
  family: 'ACES',
  encoding: isData ? 'data' : 'scene-linear',
  description: '',
  isData,
});

const runtime = {
  error: null,
  configName: 'ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5',
  colorSpaces: [
    colorSpace('ACEScg'),
    colorSpace('sRGB Encoded Rec.709 (sRGB)'),
    colorSpace('Utility - Raw', true),
  ],
  roles: [
    { name: 'scene_linear', colorSpace: 'ACEScg' },
    { name: 'texture_paint', colorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
    { name: 'color_picking', colorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
    { name: 'data', colorSpace: 'Utility - Raw' },
  ],
  displays: ['sRGB - Display'],
  viewsByDisplay: {
    'sRGB - Display': [
      {
        name: 'ACES 2.0 - SDR 100 nits (Rec.709)',
        colorSpace: '',
        transform: 'Display transform',
        looks: '',
      },
    ],
  },
};

describe('ProjectColorManagementPanel model', () => {
  it('resolves project config, required roles, working space, and view', () => {
    const model = getProjectColorManagementPanelModel(
      createDefaultProjectColorManagement(),
      runtime,
    );

    expect(model.configIssue).toBeNull();
    expect(model.workingColorSpace).toBe('ACEScg');
    expect(model.roles.every((role) => role.issue === null)).toBe(true);
    expect(model.issues).toEqual([]);
  });

  it('reports unresolved config, role overrides, view references, and context keys', () => {
    const project = createDefaultProjectColorManagement();
    project.config = {
      kind: 'builtin',
      id: 'missing',
      uri: 'ocio://missing',
    };
    project.workingSpace.override = 'Missing Working Space';
    project.viewer = {
      display: 'Missing Display',
      view: 'Missing View',
    };
    project.context = { '': 'invalid' };

    const model = getProjectColorManagementPanelModel(project, runtime);

    expect(model.issues.some((issue) => issue.includes('not the active OCIO config'))).toBe(true);
    expect(model.issues.some((issue) => issue.includes('Missing Working Space'))).toBe(true);
    expect(model.issues.some((issue) => issue.includes('Missing Display'))).toBe(true);
    expect(model.issues.some((issue) => issue.includes('empty variable name'))).toBe(true);
  });

  it('reports the exact runtime config load failure', () => {
    const project = createDefaultProjectColorManagement();
    project.config = { kind: 'external', uri: 'project:///show/config.ocio' };

    const model = getProjectColorManagementPanelModel(project, {
      ...runtime,
      configName: project.config.uri,
      error: 'Config dependency luts/show.cube was not found.',
    });

    expect(model.configIssue).toContain('Config dependency luts/show.cube was not found.');
  });
});
