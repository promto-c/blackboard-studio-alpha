import {
  AnyNode,
  BlurNode,
  CustomShaderNode,
  GradeNode,
  NodeType,
  TextNode,
} from '@blackboard/types';
import { supportsAiNodeTools } from './aiNodeTools';

export type AiChatScopeMode = 'generic' | 'context' | 'action';

const formatAnimatableValue = (value: number | Array<unknown>) =>
  typeof value === 'number' ? String(value) : 'animated';

export const getNodeTypeLabel = (nodeType: string) =>
  nodeType
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const isAiActionCapableNode = (node: AnyNode | null | undefined) =>
  Boolean(node && (node.type === NodeType.CUSTOM_SHADER || supportsAiNodeTools(node)));

export const getAiChatScopeMode = (
  feature: string | undefined,
  node: AnyNode | null | undefined,
): AiChatScopeMode => {
  if (feature === 'shader') {
    return 'action';
  }

  if (isAiActionCapableNode(node)) {
    return 'action';
  }

  return node ? 'context' : 'generic';
};

export const getAiChatScopeLabel = (node: AnyNode | null | undefined) =>
  node ? `Node: ${node.name}` : 'General';

export const getAiChatCapabilityLabel = (mode: AiChatScopeMode) => {
  if (mode === 'action') return 'Actions';
  if (mode === 'context') return 'Assist';
  return null;
};

export const getAiChatModeDescription = (mode: AiChatScopeMode) => {
  if (mode === 'action') {
    return 'Context-aware chat with staged node actions and confirmation-aware tools.';
  }
  if (mode === 'context') {
    return 'Context-aware chat without node actions.';
  }
  return 'General Blackboard Studio help without attached node context.';
};

export const getAiChatComposerPlaceholder = (mode: AiChatScopeMode) => {
  if (mode === 'action') {
    return 'Ask for a node change, staged preview, or refinement...';
  }
  if (mode === 'context') {
    return 'Ask about this node or request suggested settings...';
  }
  return 'Ask about workflows, effects, or troubleshooting...';
};

const summarizeGradeNode = (node: GradeNode) =>
  [
    `Grade controls: brightness ${formatAnimatableValue(node.grade.brightness)}, contrast ${formatAnimatableValue(node.grade.contrast)}, saturation ${formatAnimatableValue(node.grade.saturation)}, gain ${formatAnimatableValue(node.grade.gain)}, gamma ${formatAnimatableValue(node.grade.gamma)}.`,
  ].join('\n');

const summarizeBlurNode = (node: BlurNode) =>
  [
    `Blur controls: radius ${formatAnimatableValue(node.blur.radius)}, method ${node.blur.method}.`,
  ].join('\n');

const summarizeTextNode = (node: TextNode) =>
  [
    `Text content: "${node.text}".`,
    `Font: ${node.fontFamily}, size ${formatAnimatableValue(node.fontSize)}.`,
    `Opacity: ${formatAnimatableValue(node.opacity)}.`,
  ].join('\n');

const summarizeCustomShaderNode = (node: CustomShaderNode) => {
  const uniformNames = Object.keys(node.uniforms);
  return [
    `Shader uniforms: ${uniformNames.length > 0 ? uniformNames.join(', ') : '(none)'}.`,
    `Shader length: ${node.fragmentShader.split('\n').length} lines.`,
  ].join('\n');
};

export const summarizeNodeForAiChat = (node: AnyNode | null | undefined) => {
  if (!node) {
    return '';
  }

  const header = [`Focused node: ${node.name}.`, `Node type: ${getNodeTypeLabel(node.type)}.`];

  let details = '';
  if (node.type === NodeType.GRADE) {
    details = summarizeGradeNode(node as GradeNode);
  } else if (node.type === NodeType.BLUR) {
    details = summarizeBlurNode(node as BlurNode);
  } else if (node.type === NodeType.TEXT) {
    details = summarizeTextNode(node as TextNode);
  } else if (node.type === NodeType.CUSTOM_SHADER) {
    details = summarizeCustomShaderNode(node as CustomShaderNode);
  }

  return [...header, details].filter(Boolean).join('\n');
};
