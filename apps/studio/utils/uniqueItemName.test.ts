import { describe, expect, it } from 'vitest';
import { createUniqueItemNameAssigner } from './uniqueItemName';

describe('createUniqueItemNameAssigner', () => {
  it('fills the first available numeric gap for numbered names', () => {
    const assignName = createUniqueItemNameAssigner(['Shape 1', 'Shape 2', 'Shape 5']);

    expect(assignName('Shape 2')).toBe('Shape 3');
  });

  it('adds a numeric suffix for plain duplicate names', () => {
    const assignName = createUniqueItemNameAssigner(['SomeShape name']);

    expect(assignName('SomeShape name')).toBe('SomeShape name 1');
  });

  it('preserves the original name when it is not already taken', () => {
    const assignName = createUniqueItemNameAssigner(['Shape 1', 'Shape 2']);

    expect(assignName('Fresh Shape')).toBe('Fresh Shape');
  });
});
