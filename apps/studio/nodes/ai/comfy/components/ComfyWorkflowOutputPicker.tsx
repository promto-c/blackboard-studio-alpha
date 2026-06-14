import { useEffect, useRef, useState } from 'react';
import { CollapsibleSection, Popover } from '@blackboard/ui';
import type {
  ComfyWorkflowControl,
  ComfyWorkflowControlValue,
  ComfyWorkflowOutputCandidate,
} from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { getComfyControlKey, type ComfyWorkflowControlCandidate } from '../comfyControls';

interface ComfyWorkflowOutputPickerProps {
  workflowOutputCandidates: ComfyWorkflowOutputCandidate[];
  workflowControls: ComfyWorkflowControl[];
  controlCandidates: ComfyWorkflowControlCandidate[];
  selectedWorkflowOutputIds: string[];
  selectedWorkflowOutputIdSet: ReadonlySet<string>;
  hasNoSelectedWorkflowOutputs: boolean;
  onSelectAllWorkflowOutputs: () => void;
  onToggleWorkflowOutputCandidate: (candidateId: string) => void;
  onUpdateWorkflowOutputField: (
    candidate: ComfyWorkflowOutputCandidate,
    inputName: string,
    value: ComfyWorkflowControlValue,
  ) => void;
}

const preferredOutputOptionKeys = [
  'file_format',
  'format',
  'bit_depth',
  'format.bit_depth',
  'file_format.bit_depth',
  'input_color_space',
  'format.input_color_space',
  'file_format.input_color_space',
  'color_space',
  'format.color_space',
  'file_format.color_space',
  'filename_prefix',
  'filename',
  'quality',
  'compression',
];

const isPromptLinkValue = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'string' &&
  typeof value[1] === 'number';

const isDisplayableOutputOption = ([key, value]: [string, unknown]): boolean => {
  if (isPromptLinkValue(value)) return false;
  if (['images', 'image', 'video'].includes(key.toLowerCase())) return false;
  return ['string', 'number', 'boolean'].includes(typeof value);
};

const formatOutputOptionName = (key: string): string => {
  const displayKey = key.includes('.') ? key.split('.').at(-1)! : key;
  return displayKey
    .replace(/^input_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const getCandidateOutputNodeType = (candidate: ComfyWorkflowOutputCandidate): string =>
  candidate.syntheticOutputNodeType ?? candidate.nodeType;

const getCandidateOutputNodeInputs = (
  candidate: ComfyWorkflowOutputCandidate,
): Record<string, unknown> =>
  candidate.syntheticOutputNodeInputs ?? candidate.outputNodeInputs ?? {};

const getCandidateOutputNodeMode = (candidate: ComfyWorkflowOutputCandidate): string => {
  const inputs = getCandidateOutputNodeInputs(candidate);
  const formatValue = inputs.file_format ?? inputs.format;
  if (typeof formatValue === 'string' && formatValue.trim()) return formatValue;
  if (candidate.syntheticOutputFormat === 'exr_float') return 'EXR float';
  if (candidate.syntheticOutputFormat === 'preview') return 'Preview image';
  return candidate.outputType ?? 'File output';
};

interface OutputOptionEntry {
  inputName: string;
  label: string;
  value: ComfyWorkflowControlValue;
  options?: Array<string | number>;
}

interface OutputOptionSource {
  inputName: string;
  fallbackValue: unknown;
  options?: Array<string | number>;
}

const isControlValue = (value: unknown): value is ComfyWorkflowControlValue =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const coerceOutputOptionValue = (
  value: string | boolean,
  currentValue: ComfyWorkflowControlValue,
): ComfyWorkflowControlValue => {
  if (typeof currentValue === 'boolean') return Boolean(value);
  if (typeof currentValue === 'number') {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) ? nextValue : currentValue;
  }
  return String(value);
};

const isDynamicOptionSelected = (optionKey: string | number, selectedValue: unknown): boolean =>
  optionKey === selectedValue || String(optionKey) === String(selectedValue);

const getOutputOptionSources = (
  candidate: ComfyWorkflowOutputCandidate,
  controlsByKey: Map<string, ComfyWorkflowControl>,
): OutputOptionSource[] => {
  const inputs = getCandidateOutputNodeInputs(candidate);
  const dynamicOptions = candidate.outputNodeDynamicInputs ?? [];
  const dynamicFieldNames = new Set<string>();

  for (const option of dynamicOptions) {
    for (const field of option.fields) {
      dynamicFieldNames.add(field.inputName);
      dynamicFieldNames.add(field.dottedInputName);
    }
  }

  const staticSources = Object.entries(inputs)
    .filter(isDisplayableOutputOption)
    .filter(([inputName]) => !dynamicFieldNames.has(inputName))
    .map(([inputName, fallbackValue]) => ({ inputName, fallbackValue }));

  const dynamicSources: OutputOptionSource[] = [];
  const parentInputNames = new Set(dynamicOptions.map((option) => option.parentInputName));
  for (const parentInputName of parentInputNames) {
    const parentControl = controlsByKey.get(
      getComfyControlKey(candidate.previewNodeId, parentInputName),
    );
    const selectedValue = parentControl?.value ?? inputs[parentInputName];
    const selectedOption = dynamicOptions.find(
      (option) =>
        option.parentInputName === parentInputName &&
        isDynamicOptionSelected(option.optionKey, selectedValue),
    );
    if (!selectedOption) continue;

    for (const field of selectedOption.fields) {
      const inputName =
        field.inputName in inputs
          ? field.inputName
          : field.dottedInputName in inputs
            ? field.dottedInputName
            : field.dottedInputName;
      dynamicSources.push({
        inputName,
        fallbackValue:
          inputs[field.inputName] ?? inputs[field.dottedInputName] ?? field.defaultValue,
        options: field.options,
      });
    }
  }

  return [...staticSources, ...dynamicSources];
};

const getOutputOptionEntries = (
  candidate: ComfyWorkflowOutputCandidate,
  controlsByKey: Map<string, ComfyWorkflowControl>,
  candidatesByKey: Map<string, ComfyWorkflowControlCandidate>,
): OutputOptionEntry[] => {
  const entries = getOutputOptionSources(candidate, controlsByKey);
  const priority = new Map(preferredOutputOptionKeys.map((key, index) => [key, index]));

  return entries
    .sort((left, right) => {
      const leftPriority = priority.get(left.inputName) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priority.get(right.inputName) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.inputName.localeCompare(right.inputName);
    })
    .slice(0, 5)
    .flatMap(({ inputName, fallbackValue, options }) => {
      const controlKey = getComfyControlKey(candidate.previewNodeId, inputName);
      const control = controlsByKey.get(controlKey);
      const controlCandidate = candidatesByKey.get(controlKey);
      const value = control?.value ?? fallbackValue;
      if (!isControlValue(value)) return [];
      return [
        {
          inputName,
          label: formatOutputOptionName(inputName),
          value,
          options: options ?? control?.options ?? controlCandidate?.options,
        },
      ];
    });
};

function OutputFieldBadge({
  candidate,
  option,
  onUpdateWorkflowOutputField,
}: {
  candidate: ComfyWorkflowOutputCandidate;
  option: OutputOptionEntry;
  onUpdateWorkflowOutputField: (
    candidate: ComfyWorkflowOutputCandidate,
    inputName: string,
    value: ComfyWorkflowControlValue,
  ) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasOptions = option.options && option.options.length > 0;

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const updateValue = (value: ComfyWorkflowControlValue) => {
    onUpdateWorkflowOutputField(candidate, option.inputName, value);
  };

  const badgeClassName =
    'group inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-1.5 py-0.5 text-[10px] text-gray-400 transition hover:border-primary-300/30 hover:bg-primary-300/10 hover:text-primary-100 focus-within:border-primary-300/40 focus-within:bg-primary-300/10';

  const label = (
    <span className="shrink-0 text-gray-500 transition group-hover:text-primary-100/70">
      {option.label}
    </span>
  );

  if (hasOptions) {
    return (
      <Popover
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        align="start"
        sideOffset={6}
        widthClass="w-44"
        trigger={
          <button type="button" className={badgeClassName} title={`Set ${option.label}`}>
            {label}
            <span className="min-w-0 max-w-28 truncate font-mono text-gray-200">
              {String(option.value)}
            </span>
            <Icons.ChevronDown className="h-3 w-3 shrink-0 text-gray-500 transition group-hover:text-primary-100" />
          </button>
        }
      >
        {(close) => (
          <div className="max-h-64 min-w-0 space-y-1 overflow-y-auto pr-1">
            {option.options!.map((selectOption) => {
              const active = String(selectOption) === String(option.value);
              return (
                <button
                  key={String(selectOption)}
                  type="button"
                  onClick={() => {
                    updateValue(selectOption);
                    close();
                  }}
                  className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                    active
                      ? 'bg-primary-500/30 text-white ring-1 ring-inset ring-primary-400/50'
                      : 'text-gray-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="min-w-0 truncate">{String(selectOption)}</span>
                  {active ? <Icons.Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        )}
      </Popover>
    );
  }

  if (typeof option.value === 'boolean') {
    return (
      <button
        type="button"
        className={badgeClassName}
        onClick={(event) => {
          event.stopPropagation();
          updateValue(!option.value);
        }}
        title={`Toggle ${option.label}`}
      >
        {label}
        <span className="font-mono text-gray-200">{option.value ? 'on' : 'off'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={badgeClassName}
      onClick={(event) => {
        event.stopPropagation();
        setIsEditing(true);
      }}
      title={`Edit ${option.label}`}
    >
      {label}
      {isEditing ? (
        <input
          ref={inputRef}
          value={String(option.value)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            updateValue(coerceOutputOptionValue(event.target.value, option.value))
          }
          onBlur={() => setIsEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              setIsEditing(false);
            }
          }}
          className="min-w-12 max-w-32 bg-transparent font-mono text-gray-100 outline-none"
        />
      ) : (
        <span className="min-w-0 max-w-32 truncate font-mono text-gray-200">
          {String(option.value)}
        </span>
      )}
    </button>
  );
}

export function ComfyWorkflowOutputPicker({
  workflowOutputCandidates,
  workflowControls,
  controlCandidates,
  selectedWorkflowOutputIds,
  selectedWorkflowOutputIdSet,
  hasNoSelectedWorkflowOutputs,
  onSelectAllWorkflowOutputs,
  onToggleWorkflowOutputCandidate,
  onUpdateWorkflowOutputField,
}: ComfyWorkflowOutputPickerProps) {
  if (workflowOutputCandidates.length === 0) return null;

  const controlsByKey = new Map<string, ComfyWorkflowControl>(
    workflowControls.map((control) => [
      getComfyControlKey(control.nodeId, control.inputName),
      control,
    ]),
  );
  const candidatesByKey = new Map<string, ComfyWorkflowControlCandidate>(
    controlCandidates.map((candidate) => [candidate.key, candidate]),
  );

  return (
    <CollapsibleSection
      title="Workflow Output"
      defaultOpen={workflowOutputCandidates.length > 1}
      action={
        workflowOutputCandidates.length > 1 ? (
          <button
            type="button"
            onClick={onSelectAllWorkflowOutputs}
            disabled={selectedWorkflowOutputIds.length === workflowOutputCandidates.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icons.Check className="h-3.5 w-3.5" />
            All
          </button>
        ) : undefined
      }
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-gray-900/70 px-2.5 py-2 text-[11px]">
          <span className="min-w-0 truncate text-gray-400">
            {workflowOutputCandidates.length} output port
            {workflowOutputCandidates.length === 1 ? '' : 's'} detected
          </span>
          <span
            className={`shrink-0 font-mono ${
              selectedWorkflowOutputIds.length > 0 ? 'text-primary-100/70' : 'text-red-200/80'
            }`}
          >
            {selectedWorkflowOutputIds.length} selected
          </span>
        </div>

        <div className="space-y-1">
          {workflowOutputCandidates.map((candidate) => {
            const isSelected = selectedWorkflowOutputIdSet.has(candidate.id);
            const sourceLabel =
              candidate.kind === 'synthetic' ? 'Studio output' : 'Workflow output';
            const outputNodeType = getCandidateOutputNodeType(candidate);
            const outputNodeMode = getCandidateOutputNodeMode(candidate);
            const outputOptions = getOutputOptionEntries(candidate, controlsByKey, candidatesByKey);
            return (
              <div
                key={candidate.id}
                className={`w-full min-w-0 rounded-md border px-2.5 py-2 transition ${
                  isSelected
                    ? 'border-primary-300/30 bg-primary-300/10 text-primary-50'
                    : 'border-white/10 bg-gray-950/40 text-gray-400 hover:border-white/20 hover:bg-white/[0.04] hover:text-gray-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onToggleWorkflowOutputCandidate(candidate.id)}
                  aria-pressed={isSelected}
                  className="flex w-full min-w-0 items-center gap-2 text-left"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? 'border-primary-300/50 bg-primary-300/10 text-primary-100'
                        : 'border-gray-700'
                    }`}
                  >
                    {isSelected && <Icons.Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{candidate.label}</span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${
                          candidate.kind === 'synthetic'
                            ? 'border-primary-300/20 bg-primary-300/10 text-primary-100/80'
                            : 'border-white/10 bg-white/[0.04] text-gray-400'
                        }`}
                      >
                        {sourceLabel}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-gray-500">
                      {outputNodeType} #{candidate.previewNodeId} · {outputNodeMode} · source #
                      {candidate.nodeId} output {candidate.outputIndex + 1} · {candidate.outputName}
                      {candidate.outputType ? ` · ${candidate.outputType}` : ''}
                    </span>
                  </span>
                </button>
                {isSelected && outputOptions.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                    {outputOptions.map((option) => (
                      <OutputFieldBadge
                        key={`${candidate.id}:${option.inputName}`}
                        candidate={candidate}
                        option={option}
                        onUpdateWorkflowOutputField={onUpdateWorkflowOutputField}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {hasNoSelectedWorkflowOutputs ? (
          <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-2 text-[11px] leading-5 text-red-100/80">
            Select at least one output port before running this workflow.
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
