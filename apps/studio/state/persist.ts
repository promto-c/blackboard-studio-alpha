export {
  SCHEMA_VERSION,
  getProjectIndex,
  saveProjectIndex,
  saveProject,
  loadProjectState,
  deleteProject,
} from '@blackboard/state';

export {
  MAIN_PROJECT_BRANCH_ID,
  createProjectBranchRecord,
  deleteProjectBranchRecords,
  ensureProjectBranches,
  getActiveProjectBranchId,
  getProjectBranches,
  getProjectBranchStorageId,
  initializeProjectBranches,
  setActiveProjectBranchId,
  touchProjectBranch,
  upsertProjectBranch,
  type ProjectBranchRecord,
} from './projectBranches';
