// @blackboard/project-store — Shared project persistence, asset storage, and gallery

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

// App-level gallery store
export {
  loadGalleryEntries,
  addGalleryEntries,
  updateGalleryEntry,
  softDeleteGalleryEntries,
  restoreGalleryEntries,
  permanentDeleteGalleryEntries,
  createEntryId,
  makeProjectTag,
  makeNodeTag,
  makeWorkflowTag,
  makeBranchTag,
  makeSourceTag,
  getTagValue,
  hasTag,
  type GalleryEntry,
} from './galleryStore';
