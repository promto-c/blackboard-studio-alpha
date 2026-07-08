import React, { useMemo, useRef, useState } from 'react';
import type { AnyNode, Scene3DItem, Scene3DNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { ItemsPanelLayout } from '@/components/ItemsPanelLayout';
import { ItemsTreeView } from '@/components/ItemsTreeView';
import {
  TREE_LABEL_BUTTON_CLASS,
  TREE_LEADING_BUTTON_CLASS,
  TREE_ROW_ACTION_BUTTON_CLASS,
  TREE_ROW_CLASS,
  TREE_ROW_CONTROL_IDLE_CLASS,
  TREE_ROW_CONTROL_SELECTED_CLASS,
  TREE_ROW_IDLE_CLASS,
  TREE_ROW_SELECTED_CLASS,
} from '@/components/itemsTreeStyles';
import { useSceneNode } from '@/hooks/useEditorNodes';
import { saveAsset } from '@/state/assetStorage';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  createScene3DBoxItem,
  createScene3DAssetItem,
  createScene3DLightItem,
  normalizeScene3DSettings,
  updateScene3DItem,
} from './scene3d';
import { Scene3DItemTypeIcon } from './scene3dDisplay';
import {
  createScene3DAssetReference,
  getScene3DAssetFormat,
  inferScene3DAssetKind,
  SCENE_3D_ASSET_ACCEPT,
} from './scene3dModelAssets';

interface Scene3DItemsPanelProps {
  node: AnyNode;
}

function Scene3DItemsPanel({ node: anyNode }: Scene3DItemsPanelProps) {
  const node = anyNode as Scene3DNode;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const sceneNode = useSceneNode();
  const selection = useEditorSelector((state) => state.hierarchySelections[node.id]);
  const { updateNode, setHierarchySelection } = useEditorActions();
  const canvasSize = useMemo(
    () => ({
      width: sceneNode?.width ?? node.scene3d?.bounds?.x ?? 1920,
      height: sceneNode?.height ?? node.scene3d?.bounds?.y ?? 1080,
    }),
    [node.scene3d?.bounds?.x, node.scene3d?.bounds?.y, sceneNode?.height, sceneNode?.width],
  );
  const scene3d = useMemo(() => normalizeScene3DSettings(node, canvasSize), [canvasSize, node]);
  const selectedItemIds = selection?.itemIds ?? [];
  const selectedItemId = selectedItemIds.length === 1 ? selectedItemIds[0] : null;

  const commitScene3d = (nextScene3d: typeof scene3d, withHistory = true) => {
    updateNode(
      node.id,
      { scene3d: normalizeScene3DSettings({ scene3d: nextScene3d }, canvasSize) },
      withHistory,
    );
  };

  const selectItem = (itemId: string, event?: React.MouseEvent) => {
    const shouldToggle = Boolean(event?.metaKey || event?.ctrlKey);
    const nextSelected = shouldToggle && selectedItemIds.includes(itemId) ? [] : [itemId];
    setHierarchySelection(node.id, [], nextSelected);
  };

  const toggleVisibility = (item: Scene3DItem) => {
    commitScene3d(
      updateScene3DItem(scene3d, item.id, (current) => ({
        ...current,
        visible: !current.visible,
      })),
    );
  };

  const deleteItem = (item: Scene3DItem) => {
    if (item.locked) return;
    const items = scene3d.items.filter((candidate) => candidate.id !== item.id);
    commitScene3d({ ...scene3d, items });
    if (selectedItemIds.includes(item.id)) {
      setHierarchySelection(node.id, [], items[0] ? [items[0].id] : []);
    }
  };

  const deleteSelected = () => {
    const selectedIdSet = new Set(selectedItemIds);
    if (selectedIdSet.size === 0) return;
    const deletableIds = new Set(
      scene3d.items
        .filter((item) => selectedIdSet.has(item.id) && !item.locked)
        .map((item) => item.id),
    );
    if (deletableIds.size === 0) return;
    const items = scene3d.items.filter((item) => !deletableIds.has(item.id));
    commitScene3d({ ...scene3d, items });
    setHierarchySelection(node.id, [], items[0] ? [items[0].id] : []);
  };

  const addItem = (kind: 'box' | 'light') => {
    const item = kind === 'box' ? createScene3DBoxItem(scene3d) : createScene3DLightItem(scene3d);
    commitScene3d(
      {
        ...scene3d,
        items: [...scene3d.items, item],
      },
      true,
    );
    setHierarchySelection(node.id, [], [item.id]);
  };

  const importAsset = async (file: File) => {
    const format = getScene3DAssetFormat(file.name);
    if (!format) {
      setImportError('Unsupported 3D file format.');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    try {
      const assetKind = await inferScene3DAssetKind(file, format);
      const assetId = await saveAsset(file);
      const asset = createScene3DAssetReference(file, assetId, assetKind);
      if (!asset) {
        setImportError('Unsupported 3D file format.');
        return;
      }

      const item = createScene3DAssetItem(scene3d, asset);
      commitScene3d(
        {
          ...scene3d,
          items: [...scene3d.items, item],
        },
        true,
      );
      setHierarchySelection(node.id, [], [item.id]);
    } catch (error) {
      console.error('Failed to import 3D asset', error);
      setImportError(error instanceof Error ? error.message : 'Failed to import 3D asset.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void importAsset(file);
    }
    event.target.value = '';
  };

  const selectAllItems = () => {
    setHierarchySelection(
      node.id,
      [],
      scene3d.items.filter((item) => !item.locked).map((item) => item.id),
    );
  };

  const headerActions = (
    <>
      <button
        type="button"
        className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
        title="Import 3D Asset"
        aria-label="Import 3D Asset"
        disabled={isImporting}
        onClick={() => fileInputRef.current?.click()}
      >
        <Icons.ArrowDownTray className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
        title="Add Box"
        aria-label="Add Box"
        onClick={() => addItem('box')}
      >
        <Icons.CubeTransparent className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
        title="Add Light"
        aria-label="Add Light"
        onClick={() => addItem('light')}
      >
        <Icons.LightBulb className="h-3.5 w-3.5" />
      </button>
    </>
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={SCENE_3D_ASSET_ACCEPT}
        className="hidden"
        onChange={handleImportFileChange}
      />
      <ItemsPanelLayout
        title="3D Items"
        subtitle={`${scene3d.items.length} items`}
        headerActions={headerActions}
        hasItems={scene3d.items.length > 0}
        onDeleteSelected={selectedItemIds.length > 0 ? deleteSelected : undefined}
        onSelectAll={scene3d.items.length > 0 ? selectAllItems : undefined}
        emptyState={<p className="text-center text-[11px] text-gray-500">No 3D scene items.</p>}
      >
        {importError ? (
          <div className="mx-2 mb-2 rounded-md border border-rose-400/20 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-100">
            {importError}
          </div>
        ) : null}
        <ItemsTreeView onBackgroundClick={() => setHierarchySelection(node.id, [], [])}>
          {scene3d.items.map((item) => {
            const isSelected = item.id === selectedItemId;
            const isMultiSelected = selectedItemIds.includes(item.id);
            const controlClass =
              isSelected || isMultiSelected
                ? TREE_ROW_CONTROL_SELECTED_CLASS
                : TREE_ROW_CONTROL_IDLE_CLASS;
            return (
              <div
                key={item.id}
                data-tree-row
                className={`${TREE_ROW_CLASS} ${
                  isSelected || isMultiSelected ? TREE_ROW_SELECTED_CLASS : TREE_ROW_IDLE_CLASS
                } ${item.visible ? '' : 'opacity-50'}`}
              >
                <button
                  type="button"
                  className={`${TREE_LEADING_BUTTON_CLASS} ${controlClass}`}
                  title={`Select ${item.name}`}
                  aria-label={`Select ${item.name}`}
                  onClick={(event) => selectItem(item.id, event)}
                >
                  <Scene3DItemTypeIcon type={item.type} />
                </button>
                <button
                  type="button"
                  className={`${TREE_LABEL_BUTTON_CLASS} cursor-default`}
                  title={`Select ${item.name}`}
                  onClick={(event) => selectItem(item.id, event)}
                >
                  <span className="truncate font-medium tracking-[0.01em]">{item.name}</span>
                  {item.locked ? (
                    <Icons.LockClosed className="h-3 w-3 flex-shrink-0 text-gray-500" />
                  ) : null}
                </button>
                <button
                  type="button"
                  className={`${TREE_ROW_ACTION_BUTTON_CLASS} ${controlClass}`}
                  title={item.visible ? 'Hide item' : 'Show item'}
                  aria-label={item.visible ? 'Hide item' : 'Show item'}
                  onClick={() => toggleVisibility(item)}
                >
                  {item.visible ? (
                    <Icons.Eye className="h-3.5 w-3.5" />
                  ) : (
                    <Icons.EyeSlash className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  className={`${TREE_ROW_ACTION_BUTTON_CLASS} ${controlClass} disabled:cursor-not-allowed disabled:opacity-40`}
                  title={item.locked ? 'Locked item' : 'Delete item'}
                  aria-label={item.locked ? 'Locked item' : 'Delete item'}
                  disabled={item.locked}
                  onClick={() => deleteItem(item)}
                >
                  <Icons.Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </ItemsTreeView>
      </ItemsPanelLayout>
    </>
  );
}

export default Scene3DItemsPanel;
