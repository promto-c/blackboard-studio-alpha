export {
  SCHEMA_VERSION,
  getProjectIndex,
  saveProjectIndex,
  saveProject,
  loadProjectState,
  deleteProject,
} from '@blackboard/project-store';

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
