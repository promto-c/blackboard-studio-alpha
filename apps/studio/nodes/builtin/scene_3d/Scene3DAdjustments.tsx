import { useMemo } from 'react';
import type {
  AnyNode,
  Scene3DItem,
  Scene3DNode,
  Scene3DSettings,
  Scene3DVector3,
} from '@blackboard/types';
import { CollapsibleSection, ToggleSwitch } from '@blackboard/ui';
import { SettingRow } from '@/components/SettingRow';
import { useSceneNode } from '@/hooks/useEditorNodes';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  normalizeScene3DSettings,
  setScene3DBackdropDistance,
  syncScene3DBackdropDistanceToCamera,
  updateScene3DItem,
} from './scene3d';
import { Scene3DItemTypeIcon, scene3DItemTypeLabel } from './scene3dDisplay';

const NUMBER_INPUT_CLASS =
  'bg-gray-700/50 text-gray-200 text-xs rounded focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block px-2 py-1.5 font-mono w-full border-0 disabled:cursor-not-allowed disabled:opacity-55';

const TEXT_INPUT_CLASS =
  'bg-gray-700/50 text-gray-200 text-xs rounded focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block px-2 py-1.5 w-full border-0';

const COLOR_INPUT_CLASS = 'h-8 w-12 cursor-pointer rounded border border-white/10 bg-gray-800 p-1';

const MINI_LABEL_CLASS = 'text-[9px] font-semibold uppercase tracking-[0.12em] text-gray-500';

const numberOrFallback = (value: number, fallback: number, min?: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return min === undefined ? value : Math.max(min, value);
};

const formatSceneMetric = (value: number): number =>
  Number.isFinite(value) ? Number(value.toFixed(2)) : 0;

const cameraPatchChangesDistance = (camera: Partial<Scene3DSettings['camera']>): boolean =>
  Object.prototype.hasOwnProperty.call(camera, 'position') ||
  Object.prototype.hasOwnProperty.call(camera, 'target');

const applyScene3DCameraPatch = (
  scene3d: Scene3DSettings,
  camera: Partial<Scene3DSettings['camera']>,
): Scene3DSettings => {
  const nextScene3d = {
    ...scene3d,
    camera: {
      ...scene3d.camera,
      ...camera,
    },
  };

  return cameraPatchChangesDistance(camera)
    ? syncScene3DBackdropDistanceToCamera(nextScene3d)
    : nextScene3d;
};

const updateVectorAxis = (
  vector: Scene3DVector3,
  axis: keyof Scene3DVector3,
  value: number,
  min?: number,
): Scene3DVector3 => ({
  ...vector,
  [axis]: numberOrFallback(value, vector[axis], min),
});

const formatFileSize = (bytes: number | undefined): string => {
  if (!Number.isFinite(bytes) || !bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib < 10 ? 1 : 0)} MB`;
};

function Vector3Inputs({
  label,
  value,
  onChange,
  min,
  disabled,
}: {
  label: string;
  value: Scene3DVector3;
  onChange: (value: Scene3DVector3) => void;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className={MINI_LABEL_CLASS}>{label}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <label key={axis} className="min-w-0 space-y-1">
            <span className="text-[9px] uppercase text-gray-600">{axis}</span>
            <input
              type="number"
              value={Number.isFinite(value[axis]) ? value[axis] : 0}
              step="1"
              min={min}
              disabled={disabled}
              className={NUMBER_INPUT_CLASS}
              onChange={(event) =>
                onChange(updateVectorAxis(value, axis, Number(event.target.value), min))
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <SettingRow label={label}>
      <ToggleSwitch checked={checked} onCheckedChange={onChange} ariaLabel={label} size="sm" />
    </SettingRow>
  );
}

interface ItemInspectorProps {
  item: Scene3DItem;
  scene3d: Scene3DSettings;
  onScene3DChange: (nextScene3d: Scene3DSettings) => void;
}

function Scene3DItemInspector({ item, scene3d, onScene3DChange }: ItemInspectorProps) {
  const updateItem = (updater: (current: Scene3DItem) => Scene3DItem) => {
    onScene3DChange(updateScene3DItem(scene3d, item.id, updater));
  };

  const updateTransform = (key: keyof Scene3DItem['transform'], value: Scene3DVector3) => {
    updateItem((current) => ({
      ...current,
      transform: {
        ...current.transform,
        [key]: value,
      },
    }));
  };

  const updateCameraSettings = (cameraPatch: Partial<Scene3DSettings['camera']>) => {
    const nextScene3d = applyScene3DCameraPatch(scene3d, cameraPatch);
    onScene3DChange(
      updateScene3DItem(nextScene3d, item.id, (current) => ({
        ...current,
        transform: {
          ...current.transform,
          position: nextScene3d.camera.position,
        },
      })),
    );
  };

  const color = item.color ?? '#38bdf8';

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-gray-800/40">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-gray-200">
          <Scene3DItemTypeIcon type={item.type} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-gray-100">{item.name}</div>
          <div className="text-[10px] text-gray-500">{scene3DItemTypeLabel[item.type]}</div>
        </div>
      </div>

      <CollapsibleSection title="Item" defaultOpen>
        <div className="space-y-3">
          <SettingRow label="Name">
            <input
              type="text"
              value={item.name}
              className={TEXT_INPUT_CLASS}
              onChange={(event) =>
                updateItem((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </SettingRow>
          <ToggleRow
            label="Visible"
            checked={item.visible !== false}
            onChange={(checked) =>
              updateItem((current) => ({
                ...current,
                visible: checked,
              }))
            }
          />
          <SettingRow label="Color">
            <input
              type="color"
              value={color}
              className={COLOR_INPUT_CLASS}
              onChange={(event) =>
                updateItem((current) => ({
                  ...current,
                  color: event.target.value,
                }))
              }
            />
          </SettingRow>
        </div>
      </CollapsibleSection>

      {item.type !== 'output_plane' ? (
        <CollapsibleSection title={item.type === 'camera' ? 'Camera' : 'Transform'} defaultOpen>
          <div className="space-y-3">
            {item.type === 'camera' ? (
              <>
                <Vector3Inputs
                  label="Position"
                  value={scene3d.camera.position}
                  onChange={(position) => updateCameraSettings({ position })}
                />
                <Vector3Inputs
                  label="Target"
                  value={scene3d.camera.target}
                  onChange={(target) => updateCameraSettings({ target })}
                />
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    ['FOV', 'fov', 1],
                    ['Near', 'near', 0.01],
                    ['Far', 'far', 1],
                  ].map(([label, key, min]) => (
                    <label key={key as string} className="min-w-0 space-y-1">
                      <span className={MINI_LABEL_CLASS}>{label}</span>
                      <input
                        type="number"
                        value={scene3d.camera[key as keyof typeof scene3d.camera] as number}
                        min={min as number}
                        step={key === 'fov' ? 1 : 0.1}
                        className={NUMBER_INPUT_CLASS}
                        onChange={(event) =>
                          updateCameraSettings({
                            [key as string]: numberOrFallback(
                              Number(event.target.value),
                              scene3d.camera[key as keyof typeof scene3d.camera] as number,
                              min as number,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <>
                <Vector3Inputs
                  label="Position"
                  value={item.transform.position}
                  onChange={(value) => updateTransform('position', value)}
                />
                <Vector3Inputs
                  label="Rotation"
                  value={item.transform.rotation}
                  onChange={(value) => updateTransform('rotation', value)}
                />
                <Vector3Inputs
                  label="Scale"
                  value={item.transform.scale}
                  min={0.001}
                  onChange={(value) => updateTransform('scale', value)}
                />
              </>
            )}
          </div>
        </CollapsibleSection>
      ) : null}

      {item.type === 'box' || item.type === 'output_plane' ? (
        <CollapsibleSection title="Size" defaultOpen={item.type === 'box'}>
          <Vector3Inputs
            label="Dimensions"
            value={item.size ?? { x: 1, y: 1, z: 1 }}
            min={0}
            disabled={item.type === 'output_plane'}
            onChange={(size) =>
              updateItem((current) => ({
                ...current,
                size,
              }))
            }
          />
        </CollapsibleSection>
      ) : null}

      {(item.type === 'model' || item.type === 'splat') && item.asset ? (
        <CollapsibleSection title="Asset" defaultOpen>
          <div className="space-y-2 text-[11px] text-gray-300">
            <div className="min-w-0 rounded-md bg-gray-900/50 px-2 py-1.5">
              <div className={MINI_LABEL_CLASS}>File</div>
              <div className="truncate" title={item.asset.fileName}>
                {item.asset.fileName}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-md bg-gray-900/50 px-2 py-1.5">
                <div className={MINI_LABEL_CLASS}>Format</div>
                <div className="font-mono uppercase">{item.asset.format}</div>
              </div>
              <div className="rounded-md bg-gray-900/50 px-2 py-1.5">
                <div className={MINI_LABEL_CLASS}>Kind</div>
                <div className="capitalize">{item.asset.kind}</div>
              </div>
              <div className="rounded-md bg-gray-900/50 px-2 py-1.5">
                <div className={MINI_LABEL_CLASS}>Size</div>
                <div className="font-mono">{formatFileSize(item.asset.size) || '-'}</div>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      ) : null}

      {item.type === 'light' ? (
        <CollapsibleSection title="Light" defaultOpen>
          <SettingRow label="Intensity">
            <input
              type="number"
              value={item.intensity ?? 1}
              min={0}
              step="0.1"
              className={NUMBER_INPUT_CLASS}
              onChange={(event) =>
                updateItem((current) => ({
                  ...current,
                  intensity: numberOrFallback(
                    Number(event.target.value),
                    current.intensity ?? 1,
                    0,
                  ),
                }))
              }
            />
          </SettingRow>
        </CollapsibleSection>
      ) : null}
    </div>
  );
}

function Scene3DAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as Scene3DNode;
  const sceneNode = useSceneNode();
  const selection = useEditorSelector((state) => state.hierarchySelections[node.id]);
  const { updateNode } = useEditorActions();
  const canvasSize = useMemo(
    () => ({
      width: sceneNode?.width ?? node.scene3d?.bounds?.x ?? 1920,
      height: sceneNode?.height ?? node.scene3d?.bounds?.y ?? 1080,
    }),
    [node.scene3d?.bounds?.x, node.scene3d?.bounds?.y, sceneNode?.height, sceneNode?.width],
  );
  const scene3d = useMemo(() => normalizeScene3DSettings(node, canvasSize), [canvasSize, node]);
  const selectedItemId = selection?.itemIds?.length === 1 ? selection.itemIds[0] : null;
  const selectedItem = selectedItemId
    ? scene3d.items.find((item) => item.id === selectedItemId)
    : null;

  const commitScene3d = (nextScene3d: Scene3DSettings) => {
    updateNode(
      node.id,
      { scene3d: normalizeScene3DSettings({ scene3d: nextScene3d }, canvasSize) },
      true,
    );
  };

  const updateWorld = (world: Partial<Scene3DSettings['world']>) => {
    commitScene3d({
      ...scene3d,
      world: {
        ...scene3d.world,
        ...world,
      },
    });
  };

  const updateCamera = (camera: Partial<Scene3DSettings['camera']>) => {
    commitScene3d(applyScene3DCameraPatch(scene3d, camera));
  };

  if (selectedItem) {
    return (
      <Scene3DItemInspector item={selectedItem} scene3d={scene3d} onScene3DChange={commitScene3d} />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-gray-800/40">
      <CollapsibleSection title="Scene Rect" defaultOpen>
        <div className="grid grid-cols-3 gap-1.5">
          <label className="min-w-0 space-y-1">
            <span className={MINI_LABEL_CLASS}>Width</span>
            <input
              type="number"
              value={formatSceneMetric(scene3d.bounds.x)}
              disabled
              className={NUMBER_INPUT_CLASS}
            />
          </label>
          <label className="min-w-0 space-y-1">
            <span className={MINI_LABEL_CLASS}>Height</span>
            <input
              type="number"
              value={formatSceneMetric(scene3d.bounds.y)}
              disabled
              className={NUMBER_INPUT_CLASS}
            />
          </label>
          <label className="min-w-0 space-y-1">
            <span className={MINI_LABEL_CLASS}>Distance</span>
            <input
              type="number"
              value={formatSceneMetric(scene3d.bounds.z)}
              min={1}
              className={NUMBER_INPUT_CLASS}
              onChange={(event) =>
                commitScene3d(
                  setScene3DBackdropDistance(
                    scene3d,
                    numberOrFallback(Number(event.target.value), scene3d.bounds.z, 1),
                  ),
                )
              }
            />
          </label>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="World" defaultOpen>
        <div className="space-y-3">
          <SettingRow label="Pixel Scale">
            <input
              type="number"
              value={scene3d.world.pixelScale}
              min={0.0001}
              step={0.001}
              className={NUMBER_INPUT_CLASS}
              onChange={(event) =>
                updateWorld({
                  pixelScale: numberOrFallback(
                    Number(event.target.value),
                    scene3d.world.pixelScale,
                    0.0001,
                  ),
                })
              }
            />
          </SettingRow>
          <SettingRow label="Environment">
            <input
              type="color"
              value={scene3d.world.environmentColor}
              className={COLOR_INPUT_CLASS}
              onChange={(event) => updateWorld({ environmentColor: event.target.value })}
            />
          </SettingRow>
          <SettingRow label="Ground">
            <input
              type="color"
              value={scene3d.world.environmentGroundColor}
              className={COLOR_INPUT_CLASS}
              onChange={(event) => updateWorld({ environmentGroundColor: event.target.value })}
            />
          </SettingRow>
          <SettingRow label="Environment Intensity">
            <input
              type="number"
              value={scene3d.world.environmentIntensity}
              min={0}
              step={0.1}
              className={NUMBER_INPUT_CLASS}
              onChange={(event) =>
                updateWorld({
                  environmentIntensity: numberOrFallback(
                    Number(event.target.value),
                    scene3d.world.environmentIntensity,
                    0,
                  ),
                })
              }
            />
          </SettingRow>
          <ToggleRow
            label="Output Plane"
            checked={scene3d.world.showOutputPlane}
            onChange={(checked) => updateWorld({ showOutputPlane: checked })}
          />
          <ToggleRow
            label="Axes"
            checked={scene3d.world.showAxes}
            onChange={(checked) => updateWorld({ showAxes: checked })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Grid" defaultOpen={false}>
        <div className="space-y-3">
          <ToggleRow
            label="Enabled"
            checked={scene3d.world.gridEnabled}
            onChange={(checked) => updateWorld({ gridEnabled: checked })}
          />
          <SettingRow label="Size">
            <input
              type="number"
              value={scene3d.world.gridSize}
              min={1}
              className={NUMBER_INPUT_CLASS}
              onChange={(event) =>
                updateWorld({
                  gridSize: numberOrFallback(Number(event.target.value), scene3d.world.gridSize, 1),
                })
              }
            />
          </SettingRow>
          <SettingRow label="Divisions">
            <input
              type="number"
              value={scene3d.world.gridDivisions}
              min={1}
              step={1}
              className={NUMBER_INPUT_CLASS}
              onChange={(event) =>
                updateWorld({
                  gridDivisions: Math.round(
                    numberOrFallback(Number(event.target.value), scene3d.world.gridDivisions, 1),
                  ),
                })
              }
            />
          </SettingRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Camera" defaultOpen>
        <div className="space-y-3">
          <Vector3Inputs
            label="Position"
            value={scene3d.camera.position}
            onChange={(position) => updateCamera({ position })}
          />
          <Vector3Inputs
            label="Target"
            value={scene3d.camera.target}
            onChange={(target) => updateCamera({ target })}
          />
          <div className="grid grid-cols-3 gap-1.5">
            {[
              ['FOV', 'fov', 1],
              ['Near', 'near', 0.01],
              ['Far', 'far', 1],
            ].map(([label, key, min]) => (
              <label key={key as string} className="min-w-0 space-y-1">
                <span className={MINI_LABEL_CLASS}>{label}</span>
                <input
                  type="number"
                  value={scene3d.camera[key as keyof typeof scene3d.camera] as number}
                  min={min as number}
                  step={key === 'fov' ? 1 : 0.1}
                  className={NUMBER_INPUT_CLASS}
                  onChange={(event) =>
                    updateCamera({
                      [key as string]: numberOrFallback(
                        Number(event.target.value),
                        scene3d.camera[key as keyof typeof scene3d.camera] as number,
                        min as number,
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

export default Scene3DAdjustments;
