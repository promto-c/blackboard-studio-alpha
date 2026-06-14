export const MAIN_PROJECT_BRANCH_ID = 'main';

export type ProjectBranchKind = 'main' | 'user' | 'agent' | 'review' | 'autosave';
export type ProjectBranchStatus = 'active' | 'merged' | 'archived';

export interface ProjectBranchRecord {
  id: string;
  projectId: string;
  name: string;
  kind: ProjectBranchKind;
  parentBranchId?: string;
  createdByAgentRunId?: string;
  workingOwnerType?: 'user' | 'agent' | 'mixed';
  workingOwnerId?: string;
  defaultUserAccess?: 'read-only' | 'review' | 'editor';
  status: ProjectBranchStatus;
  createdAt: number;
  updatedAt: number;
}

type ProjectBranchIndexRecord = {
  activeBranchId: string;
  branches: ProjectBranchRecord[];
};

const PROJECT_BRANCH_INDEX_KEY = 'blackboard-studio-project-branches';

let memoryBranchIndex: Record<string, ProjectBranchIndexRecord> = {};

const canUseLocalStorage = () => typeof localStorage !== 'undefined';

const readBranchIndex = (): Record<string, ProjectBranchIndexRecord> => {
  if (!canUseLocalStorage()) return memoryBranchIndex;

  try {
    const serialized = localStorage.getItem(PROJECT_BRANCH_INDEX_KEY);
    if (!serialized) return {};
    const parsed = JSON.parse(serialized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error('Could not load project branch index from localStorage', error);
    return {};
  }
};

const writeBranchIndex = (index: Record<string, ProjectBranchIndexRecord>) => {
  if (!canUseLocalStorage()) {
    memoryBranchIndex = index;
    return;
  }

  try {
    localStorage.setItem(PROJECT_BRANCH_INDEX_KEY, JSON.stringify(index));
  } catch (error) {
    console.error('Could not save project branch index to localStorage', error);
  }
};

const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const PROJECT_BRANCH_SLUG_LENGTH = 36;

const getProjectBranchSlug = (value: string | null | undefined, fallback: string) => {
  const slug = (value ?? '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PROJECT_BRANCH_SLUG_LENGTH);

  return slug || fallback;
};

export const createScopedProjectBranchName = (
  scope: string | null | undefined,
  label: string | null | undefined,
  fallback = 'task',
) => `${getProjectBranchSlug(scope, 'branch')}/${getProjectBranchSlug(label, fallback)}`;

const createMainBranch = (projectId: string, timestamp = Date.now()): ProjectBranchRecord => ({
  id: MAIN_PROJECT_BRANCH_ID,
  projectId,
  name: 'main',
  kind: 'main',
  status: 'active',
  createdAt: timestamp,
  updatedAt: timestamp,
});

const normalizeBranchRecord = (
  projectId: string,
  branch: ProjectBranchRecord,
): ProjectBranchRecord => ({
  ...branch,
  projectId,
  status: branch.status ?? 'active',
  kind: branch.kind ?? (branch.id === MAIN_PROJECT_BRANCH_ID ? 'main' : 'user'),
  name: branch.name?.trim() || (branch.id === MAIN_PROJECT_BRANCH_ID ? 'main' : 'Untitled'),
});

const normalizeBranchIndex = (
  projectId: string,
  record?: Partial<ProjectBranchIndexRecord> | null,
): ProjectBranchIndexRecord => {
  const branchesById = new Map<string, ProjectBranchRecord>();
  branchesById.set(MAIN_PROJECT_BRANCH_ID, createMainBranch(projectId, 0));

  if (Array.isArray(record?.branches)) {
    record.branches.forEach((branch) => {
      if (!branch?.id) return;
      branchesById.set(branch.id, normalizeBranchRecord(projectId, branch));
    });
  }

  const branches = Array.from(branchesById.values()).sort((a, b) => {
    if (a.id === MAIN_PROJECT_BRANCH_ID) return -1;
    if (b.id === MAIN_PROJECT_BRANCH_ID) return 1;
    return b.updatedAt - a.updatedAt;
  });

  const activeBranchId =
    record?.activeBranchId && branches.some((branch) => branch.id === record.activeBranchId)
      ? record.activeBranchId
      : MAIN_PROJECT_BRANCH_ID;

  return { activeBranchId, branches };
};

const saveProjectBranchRecord = (projectId: string, record: ProjectBranchIndexRecord) => {
  const index = readBranchIndex();
  index[projectId] = normalizeBranchIndex(projectId, record);
  writeBranchIndex(index);
  return index[projectId];
};

export const initializeProjectBranches = (projectId: string): ProjectBranchIndexRecord => {
  const record = normalizeBranchIndex(projectId, {
    activeBranchId: MAIN_PROJECT_BRANCH_ID,
    branches: [createMainBranch(projectId)],
  });
  return saveProjectBranchRecord(projectId, record);
};

export const ensureProjectBranches = (projectId: string): ProjectBranchIndexRecord => {
  const index = readBranchIndex();
  const existing = index[projectId];
  const normalized = normalizeBranchIndex(projectId, existing);

  if (!existing || JSON.stringify(existing) !== JSON.stringify(normalized)) {
    return saveProjectBranchRecord(projectId, normalized);
  }

  return normalized;
};

export const getProjectBranches = (projectId: string): ProjectBranchRecord[] =>
  ensureProjectBranches(projectId).branches;

export const getActiveProjectBranchId = (projectId: string): string =>
  ensureProjectBranches(projectId).activeBranchId;

export const setActiveProjectBranchId = (
  projectId: string,
  branchId: string,
): ProjectBranchIndexRecord => {
  const record = ensureProjectBranches(projectId);
  if (!record.branches.some((branch) => branch.id === branchId)) {
    return record;
  }
  return saveProjectBranchRecord(projectId, { ...record, activeBranchId: branchId });
};

export const createProjectBranchRecord = (params: {
  projectId: string;
  name: string;
  kind?: Exclude<ProjectBranchKind, 'main'>;
  parentBranchId?: string;
  createdByAgentRunId?: string;
  workingOwnerType?: 'user' | 'agent' | 'mixed';
  workingOwnerId?: string;
  defaultUserAccess?: 'read-only' | 'review' | 'editor';
}): ProjectBranchRecord => {
  const timestamp = Date.now();
  const workingOwnerType =
    params.workingOwnerType ?? (params.kind === 'agent' ? ('agent' as const) : undefined);
  const workingOwnerId =
    params.workingOwnerId ?? (params.kind === 'agent' ? params.createdByAgentRunId : undefined);
  return {
    id: createId(params.kind === 'agent' ? 'agent_branch' : 'branch'),
    projectId: params.projectId,
    name: params.name.trim() || 'Untitled branch',
    kind: params.kind ?? 'user',
    parentBranchId: params.parentBranchId,
    createdByAgentRunId: params.createdByAgentRunId,
    workingOwnerType,
    workingOwnerId,
    defaultUserAccess:
      params.defaultUserAccess ?? (params.kind === 'agent' ? 'read-only' : undefined),
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const upsertProjectBranch = (
  projectId: string,
  branch: ProjectBranchRecord,
  activeBranchId?: string,
): ProjectBranchIndexRecord => {
  const record = ensureProjectBranches(projectId);
  const nextBranches = record.branches.some((entry) => entry.id === branch.id)
    ? record.branches.map((entry) => (entry.id === branch.id ? branch : entry))
    : [...record.branches, branch];

  return saveProjectBranchRecord(projectId, {
    activeBranchId: activeBranchId ?? record.activeBranchId,
    branches: nextBranches,
  });
};

export const touchProjectBranch = (
  projectId: string,
  branchId: string,
  timestamp = Date.now(),
): ProjectBranchIndexRecord => {
  const record = ensureProjectBranches(projectId);
  return saveProjectBranchRecord(projectId, {
    ...record,
    branches: record.branches.map((branch) =>
      branch.id === branchId ? { ...branch, updatedAt: timestamp } : branch,
    ),
  });
};

export const updateProjectBranchOwnership = (
  projectId: string,
  branchId: string,
  ownership: Pick<ProjectBranchRecord, 'workingOwnerType' | 'workingOwnerId' | 'defaultUserAccess'>,
): ProjectBranchIndexRecord => {
  const record = ensureProjectBranches(projectId);
  const timestamp = Date.now();
  return saveProjectBranchRecord(projectId, {
    ...record,
    branches: record.branches.map((branch) =>
      branch.id === branchId
        ? {
            ...branch,
            workingOwnerType: ownership.workingOwnerType,
            workingOwnerId: ownership.workingOwnerId,
            defaultUserAccess: ownership.defaultUserAccess,
            updatedAt: timestamp,
          }
        : branch,
    ),
  });
};

export const deleteProjectBranchRecord = (
  projectId: string,
  branchId: string,
  fallbackActiveBranchId?: string,
): ProjectBranchIndexRecord => {
  if (branchId === MAIN_PROJECT_BRANCH_ID) {
    return ensureProjectBranches(projectId);
  }

  const record = ensureProjectBranches(projectId);
  const nextBranches = record.branches.filter((branch) => branch.id !== branchId);
  const hasDeletedActiveBranch = record.activeBranchId === branchId;
  const fallbackBranchExists = fallbackActiveBranchId
    ? nextBranches.some((branch) => branch.id === fallbackActiveBranchId)
    : false;

  return saveProjectBranchRecord(projectId, {
    activeBranchId: hasDeletedActiveBranch
      ? fallbackBranchExists
        ? fallbackActiveBranchId!
        : MAIN_PROJECT_BRANCH_ID
      : record.activeBranchId,
    branches: nextBranches,
  });
};

export const deleteProjectBranchRecords = (projectId: string) => {
  const index = readBranchIndex();
  delete index[projectId];
  writeBranchIndex(index);
};

export const getProjectBranchStorageId = (projectId: string, branchId?: string | null): string =>
  !branchId || branchId === MAIN_PROJECT_BRANCH_ID
    ? projectId
    : `project:${projectId}:branch:${branchId}`;
