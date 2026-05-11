// @blackboard/state — Persistence, initial state, and selectors

// Asset storage (IndexedDB)
export {
  saveAsset,
  getAsset,
  getAssetSize,
  getAssetReferenceExportRecord,
  deleteAssets,
  saveDirectoryAssetReferences,
  requestReferencePermissions,
  saveProjectStateToDB,
  loadProjectStateFromDB,
  deleteProjectStateFromDB,
  type AssetReferenceExportRecord,
} from './assetStorage';

// Project persistence (localStorage + IndexedDB)
export {
  SCHEMA_VERSION,
  getProjectIndex,
  saveProjectIndex,
  saveProject,
  loadProjectState,
  deleteProject,
} from './persist';

// Editor types
export { type AutosaveSnapshot } from './editor/types';

// Editor initial state
export { getInitialHistoryEntry, getInitialState } from './editor/initialState';

// Editor selectors
export {
  getNodeCount,
  calculateTransformForFitMode,
  getMedian,
  getResolvedPoints,
} from './editor/selectors';
