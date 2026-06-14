import type {
  ComfyViewportBindingField,
  ComfyWorkflowFieldTarget,
  FieldBinding,
} from '@blackboard/types';
import { StyledDropdown } from '@blackboard/ui';
import { comfyViewportBindingFieldLabels } from '../comfyViewportBindings';

export const getComfyBindingTargetKey = (target: ComfyWorkflowFieldTarget | undefined): string =>
  target?.kind === 'workflowInput'
    ? `input:${target.inputCandidateId ?? `${target.nodeId}:${target.inputName}`}`
    : target?.nodeId && target.inputName
      ? `field:${target.nodeId}:${target.inputName}`
      : '';

export const formatComfyBindingValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
};

export const comfyBindingFieldToneClassName: Record<ComfyViewportBindingField, string> = {
  width: 'border-sky-300/20 bg-sky-400/10 text-sky-100',
  height: 'border-sky-300/20 bg-sky-400/10 text-sky-100',
  x: 'border-teal-300/20 bg-teal-400/10 text-teal-100',
  y: 'border-teal-300/20 bg-teal-400/10 text-teal-100',
  prompt: 'border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100',
  image: 'border-amber-300/20 bg-amber-400/10 text-amber-100',
  mask: 'border-lime-300/20 bg-lime-400/10 text-lime-100',
};

export function ComfyBindingFieldBadge({ field }: { field: ComfyViewportBindingField }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold uppercase ${comfyBindingFieldToneClassName[field]}`}
    >
      {comfyViewportBindingFieldLabels[field]}
    </span>
  );
}

interface ComfyBindingTargetControlProps {
  binding: FieldBinding | undefined;
  targets: ComfyWorkflowFieldTarget[];
  selectedTargetKey: string;
  onChange: (value: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
  noneSecondaryLabel?: string;
}

export function ComfyBindingTargetControl({
  binding,
  targets,
  selectedTargetKey,
  onChange,
  allowNone = false,
  noneLabel = 'Not bound',
  noneSecondaryLabel,
}: ComfyBindingTargetControlProps) {
  const selectedTarget = targets.find(
    (target) => getComfyBindingTargetKey(target) === selectedTargetKey,
  );
  const displayTarget = selectedTarget ?? binding?.target ?? targets[0];
  const staleTarget =
    !selectedTarget && binding?.target && selectedTargetKey
      ? {
          value: selectedTargetKey,
          label: binding.target.label,
          secondaryLabel: 'Unavailable',
          searchText: `${binding.target.label} unavailable`,
        }
      : null;

  if (targets.length === 0 && (!allowNone || !binding?.target)) {
    return (
      <span className="block min-h-7 truncate rounded bg-gray-950/50 px-2 py-1.5 font-mono text-[11px] leading-4 text-gray-600">
        {displayTarget?.label ?? 'No target'}
      </span>
    );
  }

  if (!allowNone && targets.length === 1 && selectedTarget) {
    return (
      <span
        title={selectedTarget.label}
        className="block min-h-7 truncate rounded bg-gray-800/45 px-2 py-1.5 font-mono text-[11px] leading-4 text-gray-300"
      >
        {selectedTarget.label}
      </span>
    );
  }

  const options = [
    ...(allowNone
      ? [
          {
            value: '',
            label: noneLabel,
            secondaryLabel: noneSecondaryLabel,
            searchText: `${noneLabel} ${noneSecondaryLabel ?? ''}`,
          },
        ]
      : []),
    ...targets.map((target) => ({
      value: getComfyBindingTargetKey(target),
      label: target.label,
      searchText: `${target.label} ${target.classType ?? ''} ${target.inputName ?? ''}`,
    })),
    ...(staleTarget ? [staleTarget] : []),
  ];

  return (
    <StyledDropdown
      value={selectedTarget || staleTarget ? selectedTargetKey : ''}
      options={options}
      onChange={(nextValue) => onChange(String(nextValue))}
      widthClass="w-full"
      popoverWidthClass="w-72"
      showSelectedBadges={false}
    />
  );
}
