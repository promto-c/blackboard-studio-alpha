import { getValueAtFrame } from '@blackboard/renderer';
import {
  ColorPicker,
  NumberInput,
  Slider,
  StyledDropdown,
  TextInputField,
  ToggleSwitch,
} from '@blackboard/ui';
import type { AnimatableNumber } from '@blackboard/types';
import type { NodeExposableFieldDescriptor } from '@/nodes/NodeDefinition';
import { SettingRow } from './SettingRow';

export interface NodeFieldControlProps {
  field: NodeExposableFieldDescriptor;
  value: unknown;
  currentFrame: number;
  onValueChange: (value: string | number | boolean | [number, number, number]) => void;
}

const isAnimatableNumber = (value: unknown): value is AnimatableNumber =>
  typeof value === 'number' ||
  (Array.isArray(value) &&
    value.every(
      (entry) =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { frame?: unknown }).frame === 'number' &&
        typeof (entry as { value?: unknown }).value === 'number',
    ));

export function NodeFieldControl({
  field,
  value,
  currentFrame,
  onValueChange,
}: NodeFieldControlProps) {
  if (field.control === 'slider' && isAnimatableNumber(value)) {
    return (
      <Slider
        label={field.label}
        value={getValueAtFrame(value, currentFrame)}
        min={field.min ?? 0}
        max={field.max ?? 1}
        step={field.step ?? 0.01}
        onChange={onValueChange}
      />
    );
  }

  if (field.control === 'number' && isAnimatableNumber(value)) {
    return (
      <SettingRow label={field.label}>
        <NumberInput
          aria-label={field.label}
          value={getValueAtFrame(value, currentFrame)}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onValueChange={onValueChange}
        />
      </SettingRow>
    );
  }

  if (field.control === 'toggle' && typeof value === 'boolean') {
    return (
      <ToggleSwitch
        label={field.label}
        description={field.description}
        checked={value}
        onCheckedChange={onValueChange}
        size="sm"
      />
    );
  }

  if (field.control === 'select' && (typeof value === 'string' || typeof value === 'number')) {
    return (
      <SettingRow label={field.label}>
        <StyledDropdown
          value={value}
          options={field.options ?? []}
          onChange={onValueChange}
          density="compact"
        />
      </SettingRow>
    );
  }

  if (
    field.control === 'color' &&
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((channel) => typeof channel === 'number')
  ) {
    return (
      <ColorPicker
        label={field.label}
        value={value as [number, number, number]}
        onChange={onValueChange}
      />
    );
  }

  if (field.control === 'text' && typeof value === 'string') {
    return (
      <TextInputField
        label={field.label}
        description={field.description}
        value={value}
        onValueChange={onValueChange}
      />
    );
  }

  return null;
}
