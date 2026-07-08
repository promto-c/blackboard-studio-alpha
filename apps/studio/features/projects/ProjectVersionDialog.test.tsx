// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PersistedProjectState, ProjectIndexEntry } from '@blackboard/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectBranchRecord } from '@/state/projectBranches';
import ProjectVersionDialog, {
  getBranchAncestry,
  getOrderedBranchVersions,
} from './ProjectVersionDialog';

const persistMocks = vi.hoisted(() => ({
  getActiveProjectBranchId: vi.fn(),
  getProjectBranches: vi.fn(),
  getProjectBranchStorageId: vi.fn((projectId: string, branchId: string) => {
    return `${projectId}:${branchId}`;
  }),
  loadProjectState: vi.fn(),
}));

vi.mock('@/state/persist', () => persistMocks);

const project: ProjectIndexEntry = {
  id: 'project-1',
  name: 'Cat',
  lastModified: 1_720_000_000_000,
};

const createBranch = (
  id: string,
  overrides: Partial<ProjectBranchRecord> = {},
): ProjectBranchRecord => ({
  id,
  projectId: project.id,
  name: id,
  kind: id === 'main' ? 'main' : 'user',
  status: 'active',
  createdAt: 100,
  updatedAt: 200,
  ...overrides,
});

const createState = (
  entries: Array<{
    id: string;
    label: string;
    checkpointLabel?: string;
    createdAt?: number;
  }> = [],
  historyIndex = entries.length - 1,
) =>
  ({
    history: entries.map((entry) => ({ ...entry, state: {} })),
    historyIndex,
  }) as unknown as PersistedProjectState;

describe('ProjectVersionDialog branch model', () => {
  it('orders branches by ancestry and exposes parent and child relationships', () => {
    const versions = [
      { branch: createBranch('grandchild', { parentBranchId: 'child' }), state: null },
      { branch: createBranch('sibling', { parentBranchId: 'main', updatedAt: 300 }), state: null },
      { branch: createBranch('main', { parentBranchId: 'sibling' }), state: null },
      { branch: createBranch('child', { parentBranchId: 'main', updatedAt: 250 }), state: null },
    ];

    const rows = getOrderedBranchVersions(versions);

    expect(rows.map(({ branch }) => branch.id)).toEqual(['main', 'sibling', 'child', 'grandchild']);
    expect(rows.map(({ depth }) => depth)).toEqual([0, 1, 1, 2]);
    expect(rows[0]?.childCount).toBe(2);
    expect(rows[2]?.parentName).toBe('main');
    expect(getBranchAncestry('grandchild', versions).map(({ id }) => id)).toEqual([
      'main',
      'child',
      'grandchild',
    ]);
  });

  it('keeps orphaned and cyclic branches visible exactly once', () => {
    const versions = [
      { branch: createBranch('main'), state: null },
      { branch: createBranch('orphan', { parentBranchId: 'missing' }), state: null },
      { branch: createBranch('self', { parentBranchId: 'self' }), state: null },
      { branch: createBranch('cycle-a', { parentBranchId: 'cycle-b' }), state: null },
      { branch: createBranch('cycle-b', { parentBranchId: 'cycle-a' }), state: null },
    ];

    const rows = getOrderedBranchVersions(versions);

    expect(rows).toHaveLength(versions.length);
    expect(new Set(rows.map(({ branch }) => branch.id)).size).toBe(versions.length);
    expect(rows[0]?.branch.id).toBe('main');
  });
});

describe('ProjectVersionDialog interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistMocks.getProjectBranchStorageId.mockImplementation(
      (projectId: string, branchId: string) => `${projectId}:${branchId}`,
    );
  });

  it('shows branch ancestry and opens the selected branch tip', async () => {
    const main = createBranch('main');
    const backup = createBranch('backup', {
      name: 'backup/set-keyframe',
      parentBranchId: 'main',
    });
    persistMocks.getProjectBranches.mockReturnValue([main, backup]);
    persistMocks.getActiveProjectBranchId.mockReturnValue('main');
    persistMocks.loadProjectState.mockImplementation(async (storageId: string) => {
      return storageId.endsWith(':backup') ? createState() : createState();
    });
    const onOpen = vi.fn().mockResolvedValue(undefined);

    render(<ProjectVersionDialog project={project} onClose={vi.fn()} onOpen={onOpen} />);

    const backupButton = await screen.findByRole('button', {
      name: /backup\/set-keyframe/i,
    });
    fireEvent.click(backupButton);

    expect(screen.getByLabelText('Branch ancestry').textContent).toContain(
      'mainbackup/set-keyframe',
    );

    fireEvent.click(screen.getByRole('button', { name: /Open branch/i }));

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith(project.id, {
        branchId: 'backup',
        historyEntryId: undefined,
        createRecoveryBranch: false,
      });
    });
  });

  it('opens an earlier state in a recovery branch', async () => {
    const main = createBranch('main');
    persistMocks.getProjectBranches.mockReturnValue([main]);
    persistMocks.getActiveProjectBranchId.mockReturnValue('main');
    persistMocks.loadProjectState.mockResolvedValue(
      createState([
        { id: 'history-1', label: 'Update node', createdAt: 100 },
        {
          id: 'history-2',
          label: 'Set keyframe',
          checkpointLabel: 'Good pose',
          createdAt: 200,
        },
      ]),
    );
    const onOpen = vi.fn().mockResolvedValue(undefined);

    render(<ProjectVersionDialog project={project} onClose={vi.fn()} onOpen={onOpen} />);

    fireEvent.click(await screen.findByRole('button', { name: /Good pose/i }));
    expect(screen.getByText(/Creates a new recovery branch from main/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open recovery/i }));

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith(project.id, {
        branchId: 'main',
        historyEntryId: 'history-2',
        createRecoveryBranch: true,
      });
    });
  });
});
