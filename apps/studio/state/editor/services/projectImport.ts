import type { AnyNode, Flow } from '@blackboard/types';
import { buildGraphCommandState, insertSourceWithMergeCommand } from '@/utils/graphCommands';
import { nodeFlags } from '@/nodes/helpers';

// ---------------------------------------------------------------------------
// Source node insertion helper (shared across import actions)
// ---------------------------------------------------------------------------

const insertSourceNode = (
  sourceNode: AnyNode,
  get: GetState,
): {
  nodes: AnyNode[];
  flows?: Record<string, Flow>;
  nodePositionsByFlow?: Record<string, Record<string, { x: number; y: number }>>;
  selectedNodeId: string;
} => {
  const state = get();

  const selectedIndex = state.selectedNodeId
    ? state.nodes.findIndex((node) => node.id === state.selectedNodeId)
    : -1;
  const selectedNode = selectedIndex >= 0 ? state.nodes[selectedIndex] : null;

  let newNodes: AnyNode[];
  if (!selectedNode || nodeFlags(selectedNode.type).isSceneLike) {
    newNodes = [...state.nodes, sourceNode];
  } else {
    let insertIndex = selectedIndex;
    for (let i = selectedIndex + 1; i < state.nodes.length; i++) {
      const nextNode = state.nodes[i];
      if ((nextNode as { stacked?: boolean }).stacked) {
        insertIndex = i;
      } else {
        break;
      }
    }
    newNodes = [...state.nodes];
    newNodes.splice(insertIndex + 1, 0, sourceNode);
  }

  const gs = buildGraphCommandState(state);
  const result = insertSourceWithMergeCommand(gs, sourceNode, newNodes, sourceNode.name);

  if (!result) {
    return { nodes: newNodes, selectedNodeId: sourceNode.id };
  }

  return {
    nodes: result.documentPatch.nodes ?? newNodes,
    ...(result.documentPatch.flows ? { flows: result.documentPatch.flows } : {}),
    ...(result.layoutPatch.nodePositionsByFlow
      ? { nodePositionsByFlow: result.layoutPatch.nodePositionsByFlow }
      : {}),
    selectedNodeId: result.selectionPatch.selectedNodeId ?? sourceNode.id,
  };
};

// ---------------------------------------------------------------------------
// Media/source action methods (extracted from createProjectActions)
// ---------------------------------------------------------------------------

import { EditorTab, ImageFitMode } from '@blackboard/types';
import { saveAsset } from '@/state/assetStorage';
import {
  type SequenceImportMode,
  readImageDimensions,
  getSequenceProjectName,
  collectImageEntriesFromDirectoryHandle,
  buildImageEntriesFromFiles,
  persistSequenceAssets,
} from '@/state/editor/utils';
import { getImportedImageColorManagement, getMediaFileKind } from '@/utils/mediaFiles';
import {
  createBrowserDecodedVideoColorManagement,
  getMediaSourceColorSpace,
  resolveMediaColorManagementSourceChange,
  type MediaColorManagement,
} from '@/color-management';
import { readVideoMetadata } from '@/utils/mediaUtils';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { findSceneNode, createMediaSourceNode, createSequenceNode } from '@/utils/graphCommands';
import { getDefaultViewportTool } from '@/nodes/helpers';
import type { GetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';

// ---------------------------------------------------------------------------
// Type for deps needed by media/source methods
// ---------------------------------------------------------------------------

export type MediaActionDeps = {
  commitMutation: CommitEditorMutation;
};

// ---------------------------------------------------------------------------
// loadImage
// ---------------------------------------------------------------------------

export const loadImageService = async (
  get: GetState,
  deps: MediaActionDeps,
  file: File,
  createNewProject: (file: File) => Promise<void>,
) => {
  const { projectId, nodes } = get();
  if (!projectId || nodes.length === 0) {
    await createNewProject(file);
    return;
  }
  const mediaKind = getMediaFileKind(file);
  if (mediaKind === 'unknown') return;

  const sceneNode = findSceneNode(get().nodes);
  if (!sceneNode) return;

  const assetId = await saveAsset(file);
  const fps = get().fps || 30;

  if (mediaKind === 'image') {
    const { width, height } = await readImageDimensions(file);
    const mediaColorManagement = await getImportedImageColorManagement(file);
    const { scaleX, scaleY } = calculateTransformForFitMode(
      { width, height },
      { width: sceneNode.width, height: sceneNode.height },
      ImageFitMode.FIT,
    );

    const newNode = createMediaSourceNode({
      name: file.name,
      sourceFileName: file.name,
      mediaKind: 'image',
      src: assetId,
      width,
      height,
      colorSpace: getMediaSourceColorSpace(mediaColorManagement),
      mediaColorManagement,
      transform: { x: 0, y: 0, scaleX, scaleY, fitMode: ImageFitMode.FIT },
    });
    const inserted = insertSourceNode(newNode, get);
    const selectedNode = inserted.nodes.find((node) => node.id === inserted.selectedNodeId);
    deps.commitMutation({
      patch: {
        ...inserted,
        activeTab: EditorTab.Flow,
        activeViewportTool: getDefaultViewportTool(selectedNode?.type),
      },
      history: {
        label: `Import Node: ${file.name}`,
        state: { ...inserted },
      },
    });
  } else if (mediaKind === 'video') {
    const { width, height, duration, color } = await readVideoMetadata(file);
    const mediaColorManagement = createBrowserDecodedVideoColorManagement();
    const totalFrames = Math.floor(duration * fps);
    const { scaleX, scaleY } = calculateTransformForFitMode(
      { width, height },
      { width: sceneNode.width, height: sceneNode.height },
      ImageFitMode.FIT,
    );

    const newNode = createMediaSourceNode({
      name: file.name,
      sourceFileName: file.name,
      mediaKind: 'video',
      src: assetId,
      width,
      height,
      duration,
      frameCount: Math.max(1, Math.ceil(duration * fps)),
      videoColorMetadata: color,
      colorSpace: getMediaSourceColorSpace(mediaColorManagement),
      mediaColorManagement,
      transform: { x: 0, y: 0, scaleX, scaleY, fitMode: ImageFitMode.FIT },
    });

    const inserted = insertSourceNode(newNode, get);
    const selectedNode = inserted.nodes.find((node) => node.id === inserted.selectedNodeId);
    deps.commitMutation((state) => ({
      patch: {
        ...inserted,
        activeTab: EditorTab.Flow,
        activeViewportTool: getDefaultViewportTool(selectedNode?.type),
        maxFrames: Math.max((state as { maxFrames: number }).maxFrames, totalFrames),
      },
      history: {
        label: `Import Node: ${file.name}`,
        state: { ...inserted },
      },
    }));
  }
};

// ---------------------------------------------------------------------------
// loadImageSequence
// ---------------------------------------------------------------------------

export const loadImageSequenceService = async (
  get: GetState,
  deps: MediaActionDeps,
  files: File[],
) => {
  const imageEntries = buildImageEntriesFromFiles(files);
  if (imageEntries.length === 0) return;

  const firstEntry = imageEntries[0];
  const { width, height } = await readImageDimensions(firstEntry.file);
  const mediaColorManagement = await getImportedImageColorManagement(firstEntry.file);
  const assetIds = await persistSequenceAssets(imageEntries, 'copy');
  const sceneNode = findSceneNode(get().nodes);
  if (!sceneNode) return;

  const { scaleX, scaleY } = calculateTransformForFitMode(
    { width, height },
    { width: sceneNode.width, height: sceneNode.height },
    ImageFitMode.FIT,
  );

  const projectName = getSequenceProjectName(firstEntry.relativePath);

  const sequenceNode = createSequenceNode({
    name: projectName,
    frames: assetIds,
    sourceFileName: firstEntry.file.name,
    width,
    height,
    colorSpace: getMediaSourceColorSpace(mediaColorManagement),
    mediaColorManagement,
    scaleX,
    scaleY,
  });

  const inserted = insertSourceNode(sequenceNode, get);
  const selectedNode = inserted.nodes.find((node) => node.id === inserted.selectedNodeId);
  deps.commitMutation((state) => ({
    patch: {
      ...inserted,
      activeTab: EditorTab.Flow,
      activeViewportTool: getDefaultViewportTool(selectedNode?.type),
      maxFrames: Math.max((state as { maxFrames: number }).maxFrames, assetIds.length - 1),
    },
    history: {
      label: `Import Sequence`,
      state: { ...inserted },
    },
  }));
};

// ---------------------------------------------------------------------------
// loadImageSequenceFromDirectory
// ---------------------------------------------------------------------------

export const loadImageSequenceFromDirectoryService = async (
  get: GetState,
  deps: MediaActionDeps,
  directoryHandle: FileSystemDirectoryHandle,
  importMode: SequenceImportMode = 'copy',
  createNewProjectFromDirectory: (
    dir: FileSystemDirectoryHandle,
    mode?: SequenceImportMode,
  ) => Promise<void>,
) => {
  const { projectId, nodes } = get();
  if (!projectId || nodes.length === 0) {
    await createNewProjectFromDirectory(directoryHandle, importMode);
    return;
  }

  const imageEntries = await collectImageEntriesFromDirectoryHandle(directoryHandle);
  if (imageEntries.length === 0) return;

  const firstEntry = imageEntries[0];
  const { width, height } = await readImageDimensions(firstEntry.file);
  const mediaColorManagement = await getImportedImageColorManagement(firstEntry.file);
  const assetIds = await persistSequenceAssets(imageEntries, importMode, directoryHandle);
  const sceneNode = findSceneNode(get().nodes);
  if (!sceneNode) return;

  const { scaleX, scaleY } = calculateTransformForFitMode(
    { width, height },
    { width: sceneNode.width, height: sceneNode.height },
    ImageFitMode.FIT,
  );

  const sequenceNode = createSequenceNode({
    name: directoryHandle.name || getSequenceProjectName(firstEntry.relativePath),
    frames: assetIds,
    sourceFileName: firstEntry.file.name,
    width,
    height,
    colorSpace: getMediaSourceColorSpace(mediaColorManagement),
    mediaColorManagement,
    scaleX,
    scaleY,
  });

  const inserted = insertSourceNode(sequenceNode, get);
  const selectedNode = inserted.nodes.find((node) => node.id === inserted.selectedNodeId);
  deps.commitMutation((state) => ({
    patch: {
      ...inserted,
      activeTab: EditorTab.Flow,
      activeViewportTool: getDefaultViewportTool(selectedNode?.type),
      maxFrames: Math.max((state as { maxFrames: number }).maxFrames, assetIds.length - 1),
    },
    history: {
      label: `Import Sequence`,
      state: { ...inserted },
    },
  }));
};

// ---------------------------------------------------------------------------
// replaceNodeSource
// ---------------------------------------------------------------------------

export const replaceNodeSourceService = async (
  get: GetState,
  deps: MediaActionDeps,
  nodeId: string,
  file: File,
) => {
  const state = get();
  const targetNode = state.nodes.find((n) => n.id === nodeId);
  if (!targetNode) return;

  const mediaKind = getMediaFileKind(file);
  if (mediaKind === 'unknown') return;
  const sceneNode = findSceneNode(state.nodes);
  if (!sceneNode) return;

  const assetId = await saveAsset(file);
  const fps = get().fps || 30;
  const existingMediaColorManagement = (
    targetNode as { mediaColorManagement?: MediaColorManagement }
  ).mediaColorManagement;

  if (mediaKind === 'image') {
    const { width, height } = await readImageDimensions(file);
    const colorManagementUpdate = resolveMediaColorManagementSourceChange(
      existingMediaColorManagement,
      await getImportedImageColorManagement(file),
    );
    const { scaleX, scaleY } = calculateTransformForFitMode(
      { width, height },
      { width: sceneNode.width, height: sceneNode.height },
      ImageFitMode.FIT,
    );

    const nextNodes = state.nodes.map((n) =>
      n.id === nodeId
        ? ({
            ...n,
            src: assetId,
            sourceFileName: file.name,
            mediaKind: 'image',
            width,
            height,
            ...colorManagementUpdate,
            videoColorMetadata: undefined,
            duration: undefined,
            frameCount: undefined,
            startFrame: undefined,
            beforeRangeBehavior: undefined,
            afterRangeBehavior: undefined,
            transform: { x: 0, y: 0, scaleX, scaleY, fitMode: ImageFitMode.FIT },
          } as AnyNode)
        : n,
    );

    deps.commitMutation({
      patch: { nodes: nextNodes },
      history: {
        label: `Replace Source: ${file.name}`,
        state: { nodes: nextNodes, selectedNodeId: state.selectedNodeId },
      },
    });
  } else if (mediaKind === 'video') {
    const { width, height, duration, color } = await readVideoMetadata(file);
    const colorManagementUpdate = resolveMediaColorManagementSourceChange(
      existingMediaColorManagement,
      createBrowserDecodedVideoColorManagement(),
    );
    const totalFrames = Math.floor(duration * fps);
    const { scaleX, scaleY } = calculateTransformForFitMode(
      { width, height },
      { width: sceneNode.width, height: sceneNode.height },
      ImageFitMode.FIT,
    );

    const nextNodes = state.nodes.map((n) =>
      n.id === nodeId
        ? ({
            ...n,
            src: assetId,
            sourceFileName: file.name,
            mediaKind: 'video',
            width,
            height,
            duration,
            frameCount: Math.max(1, Math.ceil(duration * fps)),
            startFrame: 0,
            beforeRangeBehavior: 'black',
            afterRangeBehavior: 'black',
            videoColorMetadata: color,
            ...colorManagementUpdate,
            transform: { x: 0, y: 0, scaleX, scaleY, fitMode: ImageFitMode.FIT },
          } as AnyNode)
        : n,
    );

    deps.commitMutation((s) => ({
      patch: {
        nodes: nextNodes,
        maxFrames: Math.max((s as { maxFrames: number }).maxFrames, totalFrames),
      },
      history: {
        label: `Replace Source: ${file.name}`,
        state: { nodes: nextNodes, selectedNodeId: state.selectedNodeId },
      },
    }));
  }
};

// ---------------------------------------------------------------------------
// replaceNodeSourceSequence
// ---------------------------------------------------------------------------

export const replaceNodeSourceSequenceService = async (
  get: GetState,
  deps: MediaActionDeps,
  nodeId: string,
  files: File[],
) => {
  const state = get();
  const targetNode = state.nodes.find((n) => n.id === nodeId);
  if (!targetNode) return;

  const imageEntries = buildImageEntriesFromFiles(files);
  if (imageEntries.length === 0) return;

  const firstEntry = imageEntries[0];
  const { width, height } = await readImageDimensions(firstEntry.file);
  const colorManagementUpdate = resolveMediaColorManagementSourceChange(
    (targetNode as { mediaColorManagement?: MediaColorManagement }).mediaColorManagement,
    await getImportedImageColorManagement(firstEntry.file),
  );
  const assetIds = await persistSequenceAssets(imageEntries, 'copy');
  const sceneNode = findSceneNode(state.nodes);
  if (!sceneNode) return;

  const { scaleX, scaleY } = calculateTransformForFitMode(
    { width, height },
    { width: sceneNode.width, height: sceneNode.height },
    ImageFitMode.FIT,
  );

  const nextNodes = state.nodes.map((n: AnyNode) =>
    n.id === nodeId
      ? ({
          ...n,
          frames: assetIds,
          sourceFileName: firstEntry.file.name,
          width,
          height,
          ...colorManagementUpdate,
          transform: { x: 0, y: 0, scaleX, scaleY, fitMode: ImageFitMode.FIT },
        } as AnyNode)
      : n,
  );

  deps.commitMutation((s) => ({
    patch: {
      nodes: nextNodes,
      maxFrames: Math.max((s as { maxFrames: number }).maxFrames, assetIds.length - 1),
    },
    history: {
      label: `Replace Source Sequence`,
      state: { nodes: nextNodes, selectedNodeId: state.selectedNodeId },
    },
  }));
};
