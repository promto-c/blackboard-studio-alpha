import { describe, expect, it } from 'vitest';
import { createScopedProjectBranchName } from './projectBranches';

describe('createScopedProjectBranchName', () => {
  it('uses the same scoped slug format for agent and backup branches', () => {
    expect(createScopedProjectBranchName('agent', 'Roto cleanup, please!')).toBe(
      'agent/roto-cleanup-please',
    );
    expect(createScopedProjectBranchName('backup', 'Old Head')).toBe('backup/old-head');
  });

  it('falls back to task when the branch label does not contain slug characters', () => {
    expect(createScopedProjectBranchName('agent', '!!!')).toBe('agent/task');
  });

  it('falls back to task when the branch label is missing', () => {
    expect(createScopedProjectBranchName('backup', undefined)).toBe('backup/task');
  });
});
