import { useMemo } from 'react';
import type {
  ComfyNode,
  ComfyViewportBindingField,
  ComfyWorkflow,
  FieldBinding,
  SceneNode,
  ViewportPromptRegion,
  ViewportPromptRegionDefaults,
} from '@blackboard/types';
import { NodeType } from '@blackboard/types';
import { CollapsibleSection, PromptTextField } from '@blackboard/ui';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  COMFY_VIEWPORT_BINDING_FIELDS,
  getComfyViewportBindingTargetOptions,
  getComfyViewportBindingValue,
  mergeComfyViewportBindings,
} from '../comfyViewportBindings';
import {
  ComfyBindingFieldBadge,
  ComfyBindingTargetControl,
  formatComfyBindingValue,
  getComfyBindingTargetKey,
} from './ComfyBindingControls';

const MIN_REGION_SIZE = 8;

const updateBinding = (
  bindings: FieldBinding[],
  field: ComfyViewportBindingField,
  updates: Partial<FieldBinding>,
): FieldBinding[] =>
  bindings.map((binding) => (binding.field === field ? { ...binding, ...updates } : binding));

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const normalizeRect = (
  rect: ViewportPromptRegion['rect'],
  sceneNode: SceneNode | undefined,
): ViewportPromptRegion['rect'] => {
  if (!sceneNode) {
    return {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.max(MIN_REGION_SIZE, rect.width),
      height: Math.max(MIN_REGION_SIZE, rect.height),
    };
  }

  const x = clamp(rect.x, 0, Math.max(0, sceneNode.width - MIN_REGION_SIZE));
  const y = clamp(rect.y, 0, Math.max(0, sceneNode.height - MIN_REGION_SIZE));
  return {
    x,
    y,
    width: clamp(rect.width, MIN_REGION_SIZE, Math.max(MIN_REGION_SIZE, sceneNode.width - x)),
    height: clamp(rect.height, MIN_REGION_SIZE, Math.max(MIN_REGION_SIZE, sceneNode.height - y)),
  };
};

function MetricInput({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={Math.round(value)}
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value);
          if (Number.isFinite(nextValue)) {
            onChange(nextValue);
          }
        }}
        className="h-8 w-full min-w-0 rounded-md border border-white/10 bg-gray-950/70 px-2 text-xs font-medium text-gray-100 outline-none transition focus:border-primary-300/60 focus:ring-2 focus:ring-primary-300/15"
      />
    </label>
  );
}

export interface ComfyRegionInspectorProps {
  node: ComfyNode;
  selectedWorkflow: ComfyWorkflow | null;
  regionId?: string;
  className?: string;
}

export function ComfyRegionInspector({
  node,
  selectedWorkflow,
  regionId,
  className = '',
}: ComfyRegionInspectorProps) {
  const { updateNode } = useEditorActions();
  const sceneNode = useEditorSelector((state) =>
    state.nodes.find((candidate): candidate is SceneNode => candidate.type === NodeType.SCENE),
  );
  const regions = node.viewportPromptRegions ?? [];
  const defaults = node.viewportPromptRegionDefaults ?? {};
  const isDefaultEditing = regionId === undefined;
  const region = isDefaultEditing
    ? null
    : (regions.find((candidate) => candidate.id === regionId) ?? null);
  const sourceBindings = region?.bindings ?? defaults.bindings;
  const bindings = useMemo(
    () => mergeComfyViewportBindings(selectedWorkflow, sourceBindings),
    [selectedWorkflow, sourceBindings],
  );
  const updateDefaults = (updates: Partial<ViewportPromptRegionDefaults>) => {
    updateNode(
      node.id,
      {
        viewportPromptRegionDefaults: {
          ...defaults,
          ...updates,
        },
      },
      true,
    );
  };

  const updateRegion = (nextRegion: ViewportPromptRegion, withHistory = true) => {
    updateNode(
      node.id,
      {
        viewportPromptRegions: regions.map((candidate) =>
          candidate.id === nextRegion.id ? nextRegion : candidate,
        ),
        selectedViewportPromptRegionId: nextRegion.id,
      },
      withHistory,
    );
  };

  const setPrompt = (prompt: string) => {
    if (isDefaultEditing) {
      updateDefaults({ prompt });
      return;
    }

    if (region) {
      updateRegion({ ...region, prompt });
    }
  };

  const setRectValue = (field: keyof ViewportPromptRegion['rect'], value: number) => {
    if (!region) return;
    updateRegion({
      ...region,
      rect: normalizeRect({ ...region.rect, [field]: value }, sceneNode),
    });
  };

  const setBindingTarget = (
    field: ComfyViewportBindingField,
    targets: ReturnType<typeof getComfyViewportBindingTargetOptions>,
    key: string,
  ) => {
    const target = targets.find((candidate) => getComfyBindingTargetKey(candidate) === key);
    const nextBindings = updateBinding(bindings, field, { target });
    if (isDefaultEditing) {
      updateDefaults({ bindings: nextBindings });
      return;
    }
    if (region) {
      updateRegion({ ...region, bindings: nextBindings });
    }
  };

  if (!isDefaultEditing && !region) {
    return null;
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <CollapsibleSection title={isDefaultEditing ? 'Defaults' : 'Region'}>
        <div className="space-y-3">
          {region ? (
            <div className="grid grid-cols-4 gap-2">
              <MetricInput
                label="X"
                value={region.rect.x}
                onChange={(value) => setRectValue('x', value)}
              />
              <MetricInput
                label="Y"
                value={region.rect.y}
                onChange={(value) => setRectValue('y', value)}
              />
              <MetricInput
                label="W"
                value={region.rect.width}
                min={MIN_REGION_SIZE}
                onChange={(value) => setRectValue('width', value)}
              />
              <MetricInput
                label="H"
                value={region.rect.height}
                min={MIN_REGION_SIZE}
                onChange={(value) => setRectValue('height', value)}
              />
            </div>
          ) : null}

          <PromptTextField
            label="Prompt"
            value={region?.prompt ?? defaults.prompt ?? ''}
            onValueChange={setPrompt}
            rows={2}
            minHeight={72}
            initialMaxHeight={144}
            placeholder={isDefaultEditing ? 'Default region prompt' : 'Region prompt'}
            canUsePromptTools={false}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Bindings">
        <div className="overflow-hidden rounded-md border border-white/10 bg-white/[0.025]">
          {COMFY_VIEWPORT_BINDING_FIELDS.map((field) => {
            const binding = bindings.find((candidate) => candidate.field === field);
            const targets = getComfyViewportBindingTargetOptions(selectedWorkflow, field);
            const selectedTargetKey = getComfyBindingTargetKey(binding?.target);
            const value =
              region && binding
                ? getComfyViewportBindingValue(binding, region, { inputContext: 'viewportTool' })
                : undefined;
            const valueLabel = formatComfyBindingValue(value);

            return (
              <div
                key={field}
                className="grid min-w-0 grid-cols-[6.25rem_minmax(0,1fr)] items-center gap-2 border-b border-white/5 px-2 py-1.5 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <ComfyBindingFieldBadge field={field} />
                  {valueLabel ? (
                    <span className="min-w-0 truncate font-mono text-[11px] text-gray-400">
                      {valueLabel}
                    </span>
                  ) : null}
                </div>

                <ComfyBindingTargetControl
                  binding={binding}
                  targets={targets}
                  selectedTargetKey={selectedTargetKey}
                  allowNone
                  noneLabel="Workflow value"
                  noneSecondaryLabel="No override"
                  onChange={(nextValue) => setBindingTarget(field, targets, nextValue)}
                />
              </div>
            );
          })}
        </div>
      </CollapsibleSection>
    </div>
  );
}
