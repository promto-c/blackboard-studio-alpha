import type {
  ComfyWorkflowControl,
  ComfyWorkflowControlRunMode,
  ComfyWorkflowControlValue,
} from '@blackboard/types';

export const coerceControlValue = (
  value: string,
  originalValue: ComfyWorkflowControlValue,
): ComfyWorkflowControlValue => {
  if (typeof originalValue === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : originalValue;
  }
  if (typeof originalValue === 'boolean') return value === 'true';
  return value;
};

export const formatControlValue = (value: number): string => {
  if (Number.isInteger(value)) return String(value);
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2);
};

const formatDefaultValueLabel = (value: ComfyWorkflowControlValue): string => {
  if (typeof value === 'number') return formatControlValue(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : '(empty)';
};

export const getControlResetTooltip = (control: ComfyWorkflowControl): string =>
  `Reset ${control.label} to default (${formatDefaultValueLabel(control.defaultValue)})`;

export const getIntegerRangeDefaults = (
  control: ComfyWorkflowControl,
): { min: number; max: number } => {
  const value = typeof control.value === 'number' ? control.value : 0;
  const min =
    typeof control.min === 'number' && Number.isFinite(control.min)
      ? control.min
      : Math.min(0, value);
  const max =
    typeof control.max === 'number' && Number.isFinite(control.max)
      ? control.max
      : Math.max(10, value);
  return min <= max ? { min, max } : { min: max, max: min };
};

export const getIntegerStepDefault = (control: ComfyWorkflowControl): number => {
  const step = control.incrementStep ?? control.step ?? 1;
  const integerStep = Math.trunc(step);
  return integerStep === 0 ? 1 : integerStep;
};

export const parseFiniteIntegerInput = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

export const getNumericModeSelectorValue = (
  mode: ComfyWorkflowControlRunMode,
): 'fixed' | 'randomize' | 'increment' => {
  if (mode === 'randomRange') return 'randomize';
  return mode;
};

export const getNumericModeLabel = (mode: ComfyWorkflowControlRunMode): string => {
  switch (mode) {
    case 'randomize':
      return 'Random on run';
    case 'randomRange':
      return 'Random on run';
    case 'increment':
      return 'Increment on run';
    case 'fixed':
    default:
      return 'Fixed value';
  }
};

export const formatIncrementBadgeStep = (step: number): string => {
  const integerStep = Math.trunc(step);
  if (integerStep <= -10) return '-9';
  if (integerStep >= 100) return '99';
  return String(integerStep);
};
