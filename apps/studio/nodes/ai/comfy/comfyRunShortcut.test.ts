import { describe, expect, it } from 'vitest';
import { isComfyRunShortcut } from './comfyRunShortcut';

describe('isComfyRunShortcut', () => {
  it('accepts Ctrl/Cmd+Enter and rejects modified or plain Enter', () => {
    expect(isComfyRunShortcut({ key: 'Enter', ctrlKey: true, metaKey: false, altKey: false })).toBe(
      true,
    );
    expect(isComfyRunShortcut({ key: 'Enter', ctrlKey: false, metaKey: true, altKey: false })).toBe(
      true,
    );
    expect(
      isComfyRunShortcut({ key: 'Enter', ctrlKey: false, metaKey: false, altKey: false }),
    ).toBe(false);
    expect(isComfyRunShortcut({ key: 'Enter', ctrlKey: true, metaKey: false, altKey: true })).toBe(
      false,
    );
  });
});
