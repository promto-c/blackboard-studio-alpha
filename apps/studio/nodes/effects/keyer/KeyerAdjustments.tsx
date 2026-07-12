import { useEffect, useRef } from 'react';
import type { AnyNode, AnyUniform, KeyerNode, SegmentedUniform } from '@blackboard/types';
import { CollapsibleSection, ColorInput, RangeSlider, Slider } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { SegmentedControl, SettingRow, ShaderCodeButton, ToggleSettingRow } from '@/components';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { useOcio } from '@/state/ocioContext';
import { colorManagementService } from '@/color-management';
import { KEYER_SHADER } from './keyerShader';
import {
  KEYER_DEFAULTS,
  KEYER_SAMPLE_TOOL_ID,
  getHueRangeAroundColor,
  getKeyerColor,
  getKeyerNumber,
  hexToRgb,
  rgbToHex,
} from './keyerModel';

const percent = (value: number) => `${Math.round(value * 100)}%`;

function KeyerAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as KeyerNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const activeViewportTool = useEditorSelector((state) => state.activeViewportTool);
  const { setKeyframe, setActiveViewportTool, updateNode } = useEditorActions();
  const ocio = useOcio();
  const uniforms = node.uniforms;
  const uniformsRef = useRef(uniforms);
  const previewViewRef = useRef<number | null>(null);
  uniformsRef.current = uniforms;

  const numberValue = (name: string, fallback: number) =>
    getKeyerNumber(uniforms, name, currentFrame, fallback);

  const updateStaticUniforms = (
    values: Record<string, boolean | number | [number, number, number]>,
    withHistory = true,
  ) => {
    const currentUniforms = uniformsRef.current;
    const nextUniforms = Object.fromEntries(
      Object.entries(currentUniforms).map(([name, uniform]) => [
        name,
        Object.prototype.hasOwnProperty.call(values, name)
          ? { ...uniform, value: values[name] }
          : uniform,
      ]),
    ) as Record<string, AnyUniform>;
    uniformsRef.current = nextUniforms;
    updateNode(node.id, { uniforms: nextUniforms }, withHistory);
  };

  const beginMatteOverlay = () => {
    if (!node.matteOverlayWhileAdjusting || previewViewRef.current !== null) return;
    const currentView = Number(uniformsRef.current.u_viewMode?.value ?? 0);
    if (currentView !== 0) return;
    previewViewRef.current = currentView;
    updateStaticUniforms({ u_viewMode: 2 }, false);
  };

  const endMatteOverlay = () => {
    const previousView = previewViewRef.current;
    if (previousView === null) return;
    previewViewRef.current = null;
    updateStaticUniforms({ u_viewMode: previousView }, false);
  };

  useEffect(
    () => () => {
      const previousView = previewViewRef.current;
      if (previousView === null) return;
      previewViewRef.current = null;
      const currentUniforms = uniformsRef.current;
      updateNode(
        node.id,
        {
          uniforms: {
            ...currentUniforms,
            u_viewMode: { ...currentUniforms.u_viewMode, value: previousView },
          },
        },
        false,
      );
    },
    [node.id, updateNode],
  );

  const setAnimatedUniform = (name: string, value: number) =>
    setKeyframe(node.id, `uniforms.${name}.value`, value);

  const setRange = (lowName: string, highName: string, value: [number, number]) => {
    setAnimatedUniform(lowName, value[0]);
    setAnimatedUniform(highName, value[1]);
  };

  const applyScreenColor = (color: [number, number, number]) => {
    const sceneLinearColor = colorManagementService.transformRgb(
      ocio.colorPickingColorSpace,
      ocio.workingColorSpace,
      color,
    );
    const [hueLow, hueHigh] = getHueRangeAroundColor(sceneLinearColor);
    updateStaticUniforms({ u_keyColor: color, u_hueLow: hueLow, u_hueHigh: hueHigh });
  };

  const viewUniform = uniforms.u_viewMode as SegmentedUniform | undefined;
  const viewMode = Number(viewUniform?.value ?? 0);
  const keyColor = getKeyerColor(uniforms);
  const keyHex = rgbToHex(keyColor);
  const isSampling = activeViewportTool === KEYER_SAMPLE_TOOL_ID;
  const despillEnabled = uniforms.u_despillEnabled?.value !== false;
  const invertMatte = uniforms.u_invertMatte?.value === true;

  const hueRange: [number, number] = [
    numberValue('u_hueLow', KEYER_DEFAULTS.hueRange[0]),
    numberValue('u_hueHigh', KEYER_DEFAULTS.hueRange[1]),
  ];
  const saturationRange: [number, number] = [
    numberValue('u_satLow', KEYER_DEFAULTS.saturationRange[0]),
    numberValue('u_satHigh', KEYER_DEFAULTS.saturationRange[1]),
  ];
  const luminanceRange: [number, number] = [
    numberValue('u_lumaLow', KEYER_DEFAULTS.luminanceRange[0]),
    numberValue('u_lumaHigh', KEYER_DEFAULTS.luminanceRange[1]),
  ];
  const clipRange: [number, number] = [
    numberValue('u_clipBlack', KEYER_DEFAULTS.clipBlack),
    numberValue('u_clipWhite', KEYER_DEFAULTS.clipWhite),
  ];

  return (
    <div>
      <CollapsibleSection title="Keyer" defaultOpen>
        <div className="space-y-3">
          <SettingRow label="View">
            <SegmentedControl
              value={viewMode}
              options={
                viewUniform?.options ?? [
                  { label: 'Result', value: 0 },
                  { label: 'Matte', value: 1 },
                  { label: 'Overlay', value: 2 },
                  { label: 'Spill', value: 3 },
                  { label: 'Source', value: 4 },
                ]
              }
              onChange={(value) => updateStaticUniforms({ u_viewMode: Number(value) })}
              className="w-full"
            />
          </SettingRow>
          <ToggleSettingRow
            label="Overlay While Adjusting"
            checked={node.matteOverlayWhileAdjusting}
            onCheckedChange={(checked) =>
              updateNode(node.id, { matteOverlayWhileAdjusting: checked }, true)
            }
            description="Temporarily highlights the removed screen and matte edge while refining the key."
          />

          <SettingRow label="Screen Color">
            <div className="flex min-w-0 items-center gap-2">
              <ColorInput
                aria-label="Screen color"
                value={keyHex}
                onValueChange={(value) => applyScreenColor(hexToRgb(value))}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-400">
                {keyHex}
              </span>
              <button
                type="button"
                onClick={() => setActiveViewportTool(isSampling ? null : KEYER_SAMPLE_TOOL_ID)}
                className={`bb-control-button inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition ${
                  isSampling
                    ? 'border-primary-400/50 bg-primary-500/20 text-primary-100'
                    : 'border-white/10 bg-white/[0.06] text-gray-300 hover:bg-white/10'
                }`}
                aria-pressed={isSampling}
                title="Sample screen color in the viewport"
              >
                <Icons.CursorArrow className="h-3.5 w-3.5" />
                Pick
              </button>
            </div>
          </SettingRow>

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => applyScreenColor([0.04, 0.78, 0.12])}
              className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 transition hover:bg-emerald-500/20"
            >
              Green screen
            </button>
            <button
              type="button"
              onClick={() => applyScreenColor([0.05, 0.2, 0.9])}
              className="rounded-md border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-200 transition hover:bg-blue-500/20"
            >
              Blue screen
            </button>
          </div>

          {isSampling ? (
            <p className="rounded-lg border border-primary-400/20 bg-primary-500/10 px-2.5 py-2 text-[10px] leading-4 text-primary-100">
              Click for a focused sample, or drag across the screen to capture its color range. You
              can sample repeatedly.
            </p>
          ) : null}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Qualification" defaultOpen>
        <div className="space-y-4">
          <RangeSlider
            label="Hue"
            value={hueRange}
            min={0}
            max={1}
            step={0.001}
            minGap={0.01}
            onValueChange={(value) => setRange('u_hueLow', 'u_hueHigh', value)}
            onInteractionStart={beginMatteOverlay}
            onInteractionEnd={endMatteOverlay}
            onReset={() => setRange('u_hueLow', 'u_hueHigh', [...KEYER_DEFAULTS.hueRange])}
            displayFormatter={(value) => `${Math.round(value * 360)}°`}
            trackBackground="linear-gradient(90deg, #ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)"
          />
          <RangeSlider
            label="Saturation"
            value={saturationRange}
            min={0}
            max={1}
            step={0.001}
            minGap={0.01}
            onValueChange={(value) => setRange('u_satLow', 'u_satHigh', value)}
            onInteractionStart={beginMatteOverlay}
            onInteractionEnd={endMatteOverlay}
            onReset={() => setRange('u_satLow', 'u_satHigh', [...KEYER_DEFAULTS.saturationRange])}
            displayFormatter={percent}
            trackBackground={`linear-gradient(90deg, #777, ${keyHex})`}
          />
          <RangeSlider
            label="Luminance"
            value={luminanceRange}
            min={0}
            max={1}
            step={0.001}
            minGap={0.01}
            onValueChange={(value) => setRange('u_lumaLow', 'u_lumaHigh', value)}
            onInteractionStart={beginMatteOverlay}
            onInteractionEnd={endMatteOverlay}
            onReset={() => setRange('u_lumaLow', 'u_lumaHigh', [...KEYER_DEFAULTS.luminanceRange])}
            displayFormatter={percent}
            trackBackground="linear-gradient(90deg, #050505, #f5f5f5)"
          />
          <Slider
            label="Qualifier Softness"
            value={numberValue('u_qualifierSoftness', KEYER_DEFAULTS.qualifierSoftness)}
            min={0}
            max={0.25}
            step={0.001}
            onChange={(value) => setAnimatedUniform('u_qualifierSoftness', value)}
            onInteractionStart={beginMatteOverlay}
            onInteractionEnd={endMatteOverlay}
            onReset={() =>
              setAnimatedUniform('u_qualifierSoftness', KEYER_DEFAULTS.qualifierSoftness)
            }
            displayFormatter={percent}
          />
          <Slider
            label="Key Density"
            value={numberValue('u_keyDensity', KEYER_DEFAULTS.keyDensity)}
            min={0}
            max={1.5}
            step={0.01}
            onChange={(value) => setAnimatedUniform('u_keyDensity', value)}
            onInteractionStart={beginMatteOverlay}
            onInteractionEnd={endMatteOverlay}
            onReset={() => setAnimatedUniform('u_keyDensity', KEYER_DEFAULTS.keyDensity)}
            displayFormatter={(value) => `${Math.round(value * 100)}%`}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Matte Finesse" defaultOpen>
        <div className="space-y-4">
          <RangeSlider
            label="Clip"
            value={clipRange}
            min={0}
            max={1}
            step={0.001}
            minGap={0.02}
            onValueChange={(value) => setRange('u_clipBlack', 'u_clipWhite', value)}
            onInteractionStart={beginMatteOverlay}
            onInteractionEnd={endMatteOverlay}
            onReset={() =>
              setRange('u_clipBlack', 'u_clipWhite', [
                KEYER_DEFAULTS.clipBlack,
                KEYER_DEFAULTS.clipWhite,
              ])
            }
            displayFormatter={percent}
            trackBackground="linear-gradient(90deg, #050505, #f5f5f5)"
          />
          <Slider
            label="Denoise"
            value={numberValue('u_matteDenoise', KEYER_DEFAULTS.matteDenoise)}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => setAnimatedUniform('u_matteDenoise', value)}
            onInteractionStart={beginMatteOverlay}
            onInteractionEnd={endMatteOverlay}
            onReset={() => setAnimatedUniform('u_matteDenoise', KEYER_DEFAULTS.matteDenoise)}
            displayFormatter={percent}
          />
          <Slider
            label="Grow / Shrink"
            value={numberValue('u_matteGrow', KEYER_DEFAULTS.matteGrow)}
            min={-4}
            max={4}
            step={0.1}
            onChange={(value) => setAnimatedUniform('u_matteGrow', value)}
            onInteractionStart={beginMatteOverlay}
            onInteractionEnd={endMatteOverlay}
            onReset={() => setAnimatedUniform('u_matteGrow', KEYER_DEFAULTS.matteGrow)}
            displayFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)} px`}
          />
          <ToggleSettingRow
            label="Invert Matte"
            checked={invertMatte}
            onCheckedChange={(checked) => updateStaticUniforms({ u_invertMatte: checked })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Despill" defaultOpen>
        <div className="space-y-4">
          <ToggleSettingRow
            label="Enable Despill"
            checked={despillEnabled}
            onCheckedChange={(checked) => updateStaticUniforms({ u_despillEnabled: checked })}
          />
          <div
            className={despillEnabled ? 'space-y-4' : 'pointer-events-none space-y-4 opacity-45'}
          >
            <Slider
              label="Amount"
              value={numberValue('u_despillAmount', KEYER_DEFAULTS.despillAmount)}
              min={0}
              max={1.5}
              step={0.01}
              onChange={(value) => setAnimatedUniform('u_despillAmount', value)}
              onReset={() => setAnimatedUniform('u_despillAmount', KEYER_DEFAULTS.despillAmount)}
              displayFormatter={(value) => `${Math.round(value * 100)}%`}
            />
            <Slider
              label="Bias"
              value={numberValue('u_despillBias', KEYER_DEFAULTS.despillBias)}
              min={-1}
              max={1}
              step={0.01}
              onChange={(value) => setAnimatedUniform('u_despillBias', value)}
              onReset={() => setAnimatedUniform('u_despillBias', KEYER_DEFAULTS.despillBias)}
              displayFormatter={(value) => (value < 0 ? 'Warm' : value > 0 ? 'Cool' : 'Neutral')}
            />
          </div>
        </div>
      </CollapsibleSection>

      <ShaderCodeButton title={`${node.name} GLSL Code`} code={KEYER_SHADER} />
    </div>
  );
}

export default KeyerAdjustments;
