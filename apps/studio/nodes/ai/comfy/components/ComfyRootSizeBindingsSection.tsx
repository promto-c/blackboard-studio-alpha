import { useMemo } from 'react';
import type { ComfyNode, ComfyWorkflow, FieldBinding, SceneNode } from '@blackboard/types';
import { NodeType } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { Badge, CollapsibleSection } from '@blackboard/ui';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  COMFY_ROOT_BINDING_FIELDS,
  type ComfyRootBindingField,
  getComfyRootBindingSourceLabel,
  getComfyRootBindingValue,
  getComfyViewportBindingTargetOptions,
  mergeComfyRootBindings,
} from '../comfyViewportBindings';
import {
  ComfyBindingFieldBadge,
  ComfyBindingTargetControl,
  formatComfyBindingValue,
  getComfyBindingTargetKey,
} from './ComfyBindingControls';

const updateBinding = (
  bindings: FieldBinding[],
  field: ComfyRootBindingField,
  updates: Partial<FieldBinding>,
): FieldBinding[] =>
  bindings.map((binding) => (binding.field === field ? { ...binding, ...updates } : binding));

const formatSize = (width: number | undefined, height: number | undefined): string =>
  width && height ? `${Math.round(width)} x ${Math.round(height)}` : 'No size';

export interface ComfyRootSizeBindingsSectionProps {
  node: ComfyNode;
  selectedWorkflow: ComfyWorkflow | null;
}

export function ComfyRootSizeBindingsSection({
  node,
  selectedWorkflow,
}: ComfyRootSizeBindingsSectionProps) {
  const { updateNode } = useEditorActions();
  const sceneNode = useEditorSelector((state) =>
    state.nodes.find((candidate): candidate is SceneNode => candidate.type === NodeType.SCENE),
  );
  const bindings = useMemo(() => mergeComfyRootBindings(node.rootBindings), [node.rootBindings]);
  const boundCount = bindings.filter((binding) => binding.target).length;
  const sourceLabel = getComfyRootBindingSourceLabel(node, sceneNode);
  const sizeLabel = sceneNode
    ? formatSize(sceneNode.width, sceneNode.height)
    : formatSize(node.width, node.height);

  const updateBindings = (nextBindings: FieldBinding[]) => {
    updateNode(node.id, { rootBindings: nextBindings }, true);
  };

  const setBindingTarget = (
    field: ComfyRootBindingField,
    targets: ReturnType<typeof getComfyViewportBindingTargetOptions>,
    key: string,
  ) => {
    const target = targets.find((candidate) => getComfyBindingTargetKey(candidate) === key);
    updateBindings(updateBinding(bindings, field, { target }));
  };

  const suggestedBindings = COMFY_ROOT_BINDING_FIELDS.map((field) => ({
    field,
    target: getComfyViewportBindingTargetOptions(selectedWorkflow, field)[0],
    binding: bindings.find((candidate) => candidate.field === field),
  }));
  const canAutoBind = suggestedBindings.some(({ binding, target }) => !binding?.target && target);
  const handleAutoBind = () => {
    updateBindings(
      bindings.map((binding) => {
        const suggested = suggestedBindings.find((candidate) => candidate.field === binding.field);
        return {
          ...binding,
          target: binding.target ?? suggested?.target,
        };
      }),
    );
  };

  return (
    <CollapsibleSection
      title="Size Bindings"
      defaultOpen={false}
      action={
        selectedWorkflow ? (
          <div className="flex items-center gap-1.5">
            <Badge
              size="sm"
              variant={boundCount > 0 ? 'accent' : 'neutral'}
              className={boundCount > 0 ? '' : '!border-white/10 !bg-gray-900/70 !text-gray-500'}
            >
              {boundCount}/2
            </Badge>
            {canAutoBind ? (
              <button
                type="button"
                onClick={handleAutoBind}
                className="inline-flex items-center gap-1 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15"
                title="Bind suggested width and height targets"
              >
                <Icons.Link className="h-3.5 w-3.5" />
                Auto
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-white/10 bg-gray-950/45 px-2 py-2">
          <Icons.Rectangle className="h-4 w-4 shrink-0 text-gray-500" />
          <span className="min-w-0 truncate text-xs font-medium text-gray-300">{sourceLabel}</span>
          <span className="shrink-0 font-mono text-[11px] text-gray-400">{sizeLabel}</span>
        </div>

        <div className="overflow-hidden rounded-md border border-white/10 bg-white/[0.025]">
          {COMFY_ROOT_BINDING_FIELDS.map((field) => {
            const binding = bindings.find((candidate) => candidate.field === field);
            const targets = getComfyViewportBindingTargetOptions(selectedWorkflow, field);
            const selectedTargetKey = getComfyBindingTargetKey(binding?.target);
            const value = binding ? getComfyRootBindingValue(binding, node, sceneNode) : undefined;
            const valueLabel = formatComfyBindingValue(value);

            return (
              <div
                key={field}
                className="grid min-w-0 grid-cols-[4.75rem_4.5rem_minmax(0,1fr)] items-center gap-2 border-b border-white/5 px-2 py-1.5 last:border-b-0"
              >
                <ComfyBindingFieldBadge field={field} />
                <span className="min-w-0 truncate font-mono text-[11px] text-gray-400">
                  {valueLabel || '--'}
                </span>
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
      </div>
    </CollapsibleSection>
  );
}
