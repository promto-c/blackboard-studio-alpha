import { describe, expect, it } from 'vitest';
import { createCloneOffset, getCloneSourceFromOffset } from './cloneMath';

describe('paint clone math', () => {
  it('creates a persistent offset from a source-to-target drag', () => {
    expect(createCloneOffset({ x: 64, y: -20 }, { x: 10, y: 12 })).toEqual({
      x: 54,
      y: -32,
    });
  });

  it('resolves the live source position from the current cursor target', () => {
    expect(getCloneSourceFromOffset({ x: 10, y: 12 }, { x: 54, y: -32 })).toEqual({
      x: 64,
      y: -20,
    });
  });
});
