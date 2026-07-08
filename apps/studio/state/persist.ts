import {
  SCHEMA_VERSION,
  getProjectIndex,
  saveProjectIndex,
  saveProject as saveStoredProject,
  loadProjectState as loadStoredProjectState,
  deleteProject,
} from '@blackboard/project-store';
import type { PersistedProjectState } from '@blackboard/types';
import { assertPersistedProjectColorManagementState } from '@/color-management';

export { SCHEMA_VERSION, getProjectIndex, saveProjectIndex, deleteProject };

export const saveProject = async (id: string, state: PersistedProjectState): Promise<void> => {
  assertPersistedProjectColorManagementState(state);
  await saveStoredProject(id, state);
};

export const loadProjectState = async (id: string): Promise<PersistedProjectState | null> => {
  const state = await loadStoredProjectState(id);
  if (!state) return null;

  try {
    return assertPersistedProjectColorManagementState(state);
  } catch (error) {
    console.error(`Project ${id} has unsupported color-management state.`, error);
    return null;
  }
};

export {
  MAIN_PROJECT_BRANCH_ID,
  createProjectBranchRecord,
  createScopedProjectBranchName,
  deleteProjectBranchRecord,
  deleteProjectBranchRecords,
  ensureProjectBranches,
  getActiveProjectBranchId,
  getProjectBranches,
  getProjectBranchStorageId,
  initializeProjectBranches,
  setActiveProjectBranchId,
  touchProjectBranch,
  updateProjectBranchOwnership,
  upsertProjectBranch,
  type ProjectBranchRecord,
} from './projectBranches';
