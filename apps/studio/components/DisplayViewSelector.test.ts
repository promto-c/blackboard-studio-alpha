import { describe, expect, it } from 'vitest';
import { getDisplayViewSelectorModel } from './DisplayViewSelector';

const displays = ['sRGB - Display', 'Display P3'];
const viewsByDisplay = {
  'sRGB - Display': [
    {
      name: 'ACES SDR',
      transform: 'Display transform',
      colorSpace: '',
      looks: 'Studio Look',
    },
  ],
  'Display P3': [{ name: 'P3 SDR', transform: '', colorSpace: 'Display P3', looks: '' }],
};

describe('DisplayViewSelector model', () => {
  it('derives view details and exact configured looks', () => {
    expect(
      getDisplayViewSelectorModel(displays, viewsByDisplay, {
        display: 'sRGB - Display',
        view: 'ACES SDR',
        look: 'Studio Look',
      }),
    ).toEqual({
      displays,
      views: [{ name: 'ACES SDR', detail: 'Display transform' }],
      looks: ['Studio Look'],
      issue: null,
    });
  });

  it('reports missing displays, views, and invalid looks inline', () => {
    expect(
      getDisplayViewSelectorModel(displays, viewsByDisplay, {
        display: 'Missing',
        view: 'ACES SDR',
      }).issue,
    ).toContain('Display "Missing"');
    expect(
      getDisplayViewSelectorModel(displays, viewsByDisplay, {
        display: 'Display P3',
        view: 'Missing',
      }).issue,
    ).toContain('View "Missing"');
    expect(
      getDisplayViewSelectorModel(displays, viewsByDisplay, {
        display: 'sRGB - Display',
        view: 'ACES SDR',
        look: 'Missing Look',
      }).issue,
    ).toContain('Look "Missing Look"');
  });
});
