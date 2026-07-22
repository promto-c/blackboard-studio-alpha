import { describe, expect, it } from 'vitest';
import { createSam3BoxPromptBatch } from './sam3TrackerRuntime';

describe('SAM3 box prompt input', () => {
  it('uses the processor-required batch and box dimensions', () => {
    const prompt = createSam3BoxPromptBatch([180, 120], [20, 40]);

    expect(prompt).toEqual([[[20, 40, 180, 120]]]);
    expect(prompt).toHaveLength(1);
    expect(prompt[0]).toHaveLength(1);
    expect(prompt[0][0]).toHaveLength(4);
  });
});
