import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { type AnyUniform, UniformUIType } from '@blackboard/types';
import { CollapsibleSection, ColorPicker, ToggleSwitch } from '@blackboard/ui';
import { Slider, SegmentedControl } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const getStepPrecision = (step: number): number => {
  if (!Number.isFinite(step)) return 0;
  const stepString = step.toString().toLowerCase();
  if (stepString.includes('e-')) {
    return parseInt(stepString.split('e-')[1] ?? '0', 10) || 0;
  }
  return stepString.includes('.') ? (stepString.split('.')[1]?.length ?? 0) : 0;
};

const defaultDisplayFormatter = (value: number, step: number): string => {
  const precision = Math.min(6, Math.max(0, getStepPrecision(step)));
  return value.toFixed(precision);
};

export interface UniformRendererProps {
  /** The node's uniforms map (keyed by uniform name). */
  uniforms: Record<string, AnyUniform>;
  /** The node ID, used to construct keyframe paths. */
  nodeId: string;
  /**
   * Resolves the default value for a uniform name, used when the user clicks
   * the reset button on a slider. Typically wraps `parseUniformsFromGLSL`.
   */
  getDefaultValue: (name: string) => number | undefined;
  /**
   * Called when a COLOR uniform changes, instead of the default slider path.
   * If omitted, COLOR uniforms use `updateNode` internally but still render.
   */
  onColorChange?: (name: string, value: [number, number, number]) => void;
  /**
   * Section title for the surrounding CollapsibleSection. Defaults to "Parameters".
   */
  sectionTitle?: string;
  /**
   * Optional custom display formatter for slider values.
   * Defaults to auto-precision from step.
   */
  displayFormatter?: (value: number, step: number) => string;
}

/**
 * Generic uniform controls renderer for shader-effect node adjustment panels.
 *
 * Renders the appropriate control (Slider, ColorPicker, ToggleSwitch, SegmentedControl,
 * or number input) based on each uniform's `ui` type. Handles keyframe binding for
 * SLIDER uniforms transparently via `useEditorActions`.
 */
export function UniformRenderer({
  uniforms,
  nodeId,
  getDefaultValue,
  onColorChange,
  sectionTitle = 'Parameters',
  displayFormatter = defaultDisplayFormatter,
}: UniformRendererProps) {
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { setKeyframe, updateNode } = useEditorActions();

  const handleSliderChange = (name: string, value: number) => {
    setKeyframe(nodeId, `uniforms.${name}.value`, value);
  };

  const handleSliderReset = (name: string) => () => {
    const defaultValue = getDefaultValue(name);
    if (defaultValue !== undefined) {
      setKeyframe(nodeId, `uniforms.${name}.value`, defaultValue, true);
    }
  };

  const handleColorChange = (name: string, value: [number, number, number]) => {
    if (onColorChange) {
      onColorChange(name, value);
      return;
    }
    // Default: use updateNode (colors are not animated)
    updateNode(
      nodeId,
      {
        uniforms: {
          ...uniforms,
          [name]: { ...uniforms[name], value },
        },
      },
      true,
    );
  };

  const handleStaticChange = (name: string, value: boolean | number) => {
    updateNode(
      nodeId,
      {
        uniforms: {
          ...uniforms,
          [name]: { ...uniforms[name], value },
        },
      },
      true,
    );
  };

  const renderControl = (name: string, uniform: AnyUniform) => {
    switch (uniform.ui) {
      case UniformUIType.SLIDER: {
        const valueAtFrame = getValueAtFrame(uniform.value, currentFrame);
        return (
          <Slider
            key={name}
            label={uniform.label}
            value={valueAtFrame}
            min={uniform.min}
            max={uniform.max}
            step={uniform.step}
            onChange={(v) => handleSliderChange(name, v)}
            onReset={handleSliderReset(name)}
            displayFormatter={(v) => displayFormatter(v, uniform.step)}
            isKeyframed={hasKeyframeAt(uniform.value, currentFrame)}
            onToggleKeyframe={() => setKeyframe(nodeId, `uniforms.${name}.value`)}
          />
        );
      }

      case UniformUIType.COLOR: {
        return (
          <ColorPicker
            key={name}
            label={uniform.label}
            value={uniform.value as [number, number, number]}
            onChange={(v) => handleColorChange(name, v)}
          />
        );
      }

      case UniformUIType.TOGGLE: {
        return (
          <ToggleSwitch
            key={name}
            label={uniform.label}
            checked={uniform.value as boolean}
            onCheckedChange={(checked) => handleStaticChange(name, checked)}
            size="sm"
          />
        );
      }

      case UniformUIType.SEGMENTED: {
        return (
          <div key={name} className="space-y-2">
            <label className="text-xs font-medium text-gray-400">{uniform.label}</label>
            <SegmentedControl
              options={(uniform.options ?? []).map(
                (opt: { value: string | number; label: string }) => ({
                  value: opt.value,
                  label: opt.label,
                }),
              )}
              value={uniform.value}
              onChange={(value) => {
                const numericValue = typeof value === 'number' ? value : Number(value);
                if (Number.isFinite(numericValue)) {
                  handleStaticChange(name, numericValue);
                }
              }}
            />
          </div>
        );
      }

      case UniformUIType.NUMBER: {
        return (
          <div key={name} className="space-y-1">
            <label className="text-xs font-medium text-gray-400">{uniform.label}</label>
            <input
              type="number"
              aria-label={uniform.label}
              value={uniform.value as number}
              step={uniform.step}
              onChange={(event) => {
                if (event.target.value === '') return;
                const numericValue = Number(event.target.value);
                if (Number.isFinite(numericValue)) {
                  handleStaticChange(name, numericValue);
                }
              }}
              className="block w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-100 outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
            />
          </div>
        );
      }

      default:
        return null;
    }
  };

  const entries = Object.entries(uniforms);
  if (entries.length === 0) return null;

  return (
    <CollapsibleSection title={sectionTitle} defaultOpen>
      <div className="space-y-4">
        {entries.map(([name, uniform]) => renderControl(name, uniform as AnyUniform))}
      </div>
    </CollapsibleSection>
  );
}
