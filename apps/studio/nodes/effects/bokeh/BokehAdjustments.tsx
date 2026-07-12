import { useMemo, useEffect } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import {
  AnyNode,
  BokehBlurNode,
  UniformUIType,
  AnyUniform,
  DepthSource,
  AnimatableNumber,
  NodeType,
} from '@blackboard/types';
import { CollapsibleSection, Slider, StyledDropdown } from '@blackboard/ui';
import { SettingRow, ShaderCodeButton, ToggleSettingRow } from '@/components';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import { BOKEH_BLUR_SHADER } from '@/nodes/effects/bokeh/bokehShader';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

function BokehAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as BokehBlurNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const nodes = useEditorSelector((s) => s.nodes);
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
  const { updateNode, setKeyframe, connectNodeInput, disconnectNodeInput } = useEditorActions();
  const depthSourceOptions = [
    { value: 'uniform', label: 'Uniform (Flat)' },
    { value: 'luminance', label: 'Luminance' },
    { value: 'radial', label: 'Radial Gradient' },
    { value: 'linear_h', label: 'Linear Horizontal' },
    { value: 'linear_v', label: 'Linear Vertical' },
    { value: 'node', label: 'External Node' },
  ];

  const shapeOptions = [
    { value: 0, label: 'Circle' },
    { value: 1, label: 'Hexagon' },
    { value: 2, label: 'Octagon' },
    { value: 3, label: 'Star' },
    { value: 4, label: 'Heart' },
    { value: 5, label: 'Ring' },
  ];

  const availableNodes = useMemo(() => {
    return nodes
      .filter((candidate) => candidate.type === NodeType.MEDIA_SOURCE && candidate.id !== node.id)
      .map((candidate) => ({ value: candidate.id, label: candidate.name }));
  }, [nodes, node.id]);

  const defaultDepthNodeId = useMemo(() => {
    const currentIndex = nodes.findIndex((candidate) => candidate.id === node.id);
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = nodes[i];
      if (candidate.type === NodeType.MEDIA_SOURCE) {
        return candidate.id;
      }
    }
    return undefined;
  }, [nodes, node.id]);

  const depthNodeId = node.inputs?.depth;

  useEffect(() => {
    // If mode is 'node' and no valid ID is set, set the default.
    if (
      node.depthSource === 'node' &&
      (!depthNodeId || !nodes.some((node) => node.id === depthNodeId)) &&
      defaultDepthNodeId
    ) {
      if (depthNodeId !== defaultDepthNodeId) {
        connectNodeInput(node.id, 'depth', defaultDepthNodeId);
      }
    }
  }, [node.depthSource, depthNodeId, defaultDepthNodeId, nodes, connectNodeInput, node.id]);

  const handleUniformChange = (name: string, value: number | string) => {
    setKeyframe(
      node.id,
      `uniforms.${name}.value`,
      typeof value === 'string' ? Number(value) : value,
    );
  };

  const handleDepthSourceChange = (value: DepthSource) => {
    updateNode(node.id, { depthSource: value }, true);
  };

  const handleDepthNodeChange = (nodeId: string) => {
    if (nodeId) {
      connectNodeInput(node.id, 'depth', nodeId);
    } else {
      disconnectNodeInput(node.id, 'depth');
    }
  };

  const handleToggleDepthPreview = () => {
    updateNode(node.id, { previewDepth: !node.previewDepth }, true);
  };

  const handleToggleDepthInvert = () => {
    updateNode(node.id, { depthInvert: !node.depthInvert }, true);
  };

  const handleReset = (name: string) => () => {
    const defaultUniforms = parseUniformsFromGLSL(BOKEH_BLUR_SHADER);
    const defaultUniform = defaultUniforms[name];
    if (defaultUniform && typeof defaultUniform.value === 'number') {
      setKeyframe(node.id, `uniforms.${name}.value`, defaultUniform.value, true);
    }
  };

  const renderUniformControl = (name: string, uniform: AnyUniform) => {
    if (uniform.ui === UniformUIType.SLIDER) {
      const valueAtFrame = getValueAtFrame(uniform.value as AnimatableNumber, currentFrame);
      return (
        <Slider
          key={name}
          label={uniform.label}
          value={valueAtFrame}
          min={uniform.min}
          max={uniform.max}
          step={uniform.step}
          onChange={(v) => handleUniformChange(name, v)}
          onReset={handleReset(name)}
          displayFormatter={(v) => v.toFixed(uniform.step < 1 ? 2 : 0)}
          isKeyframed={hasKeyframeAt(uniform.value as AnimatableNumber, currentFrame)}
          onToggleKeyframe={() => setKeyframe(node.id, `uniforms.${name}.value`)}
        />
      );
    }
    return null;
  };

  const u = node.uniforms;

  return (
    <>
      <div>
        <CollapsibleSection title="Depth Map Control" defaultOpen>
          <div className="space-y-4">
            <ToggleSettingRow
              label="Depth Preview"
              checked={node.previewDepth}
              onCheckedChange={handleToggleDepthPreview}
              description="Visualize current depth settings"
            />

            <SettingRow label="Source">
              <StyledDropdown
                value={node.depthSource}
                options={depthSourceOptions}
                onChange={(val) => handleDepthSourceChange(val as DepthSource)}
                widthClass="w-full"
              />
            </SettingRow>

            {node.depthSource === 'node' && (
              <SettingRow label="Select Node" className="animate-[fadeIn_150ms_ease-out]">
                <StyledDropdown
                  value={depthNodeId || ''}
                  options={availableNodes}
                  onChange={handleDepthNodeChange}
                  widthClass="w-full"
                />
              </SettingRow>
            )}

            <ToggleSettingRow
              label="Invert"
              checked={node.depthInvert}
              onCheckedChange={handleToggleDepthInvert}
              ariaLabel="Invert depth"
            />

            {u.u_depthContrast &&
              renderUniformControl('u_depthContrast', u.u_depthContrast as AnyUniform)}
            {u.u_depthBias && renderUniformControl('u_depthBias', u.u_depthBias as AnyUniform)}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Lens Focus" defaultOpen>
          <div className="space-y-4">
            <div
              className={`p-2 rounded border transition-colors ${activeViewportTool === 'bokeh_pick' ? 'bg-primary-900/20 border-primary-500' : 'bg-gray-800 border-gray-700'}`}
            >
              <p className="text-[10px] text-gray-400 leading-tight">
                {activeViewportTool === 'bokeh_pick'
                  ? 'Click in the Viewport to set focus point'
                  : 'Use the Pick tool in the Viewport for interactive focus'}
              </p>
            </div>
            {u.u_focusDepth && renderUniformControl('u_focusDepth', u.u_focusDepth as AnyUniform)}
            {u.u_focusWidth && renderUniformControl('u_focusWidth', u.u_focusWidth as AnyUniform)}
            {u.u_maxCoC && renderUniformControl('u_maxCoC', u.u_maxCoC as AnyUniform)}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Vintage Characteristics" defaultOpen>
          <div className="space-y-4">
            {u.u_swirl && renderUniformControl('u_swirl', u.u_swirl as AnyUniform)}
            {u.u_catEye && renderUniformControl('u_catEye', u.u_catEye as AnyUniform)}
            {u.u_chroma && renderUniformControl('u_chroma', u.u_chroma as AnyUniform)}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Aperture Shape">
          <div className="space-y-4">
            <SettingRow label="Shape Type">
              <StyledDropdown
                value={
                  u.u_shapeType
                    ? getValueAtFrame(u.u_shapeType.value as AnimatableNumber, currentFrame)
                    : 0
                }
                options={shapeOptions}
                onChange={(val) => handleUniformChange('u_shapeType', val)}
                widthClass="w-full"
              />
            </SettingRow>
            {u.u_roundness && renderUniformControl('u_roundness', u.u_roundness as AnyUniform)}
            {u.u_anamorphic && renderUniformControl('u_anamorphic', u.u_anamorphic as AnyUniform)}
            {u.u_shapeType &&
              getValueAtFrame(u.u_shapeType.value as AnimatableNumber, currentFrame) === 3 &&
              u.u_starPoints &&
              renderUniformControl('u_starPoints', u.u_starPoints as AnyUniform)}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Sampling & Highlights">
          <div className="space-y-4">
            {u.u_threshold && renderUniformControl('u_threshold', u.u_threshold as AnyUniform)}
            {u.u_gain && renderUniformControl('u_gain', u.u_gain as AnyUniform)}
            {u.u_samples && renderUniformControl('u_samples', u.u_samples as AnyUniform)}
          </div>
        </CollapsibleSection>
      </div>
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={BOKEH_BLUR_SHADER} />
    </>
  );
}

export default BokehAdjustments;
