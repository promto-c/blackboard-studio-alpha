import {
  AiChatMessage,
  AiChatThread,
  AnyNode,
  CustomShaderNode,
  NodeType,
} from '@blackboard/types';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import type { ShaderGenerationStreamUpdate } from '@/utils/ai';

/* ------------------------------------------------------------------ */
/*  Type guard                                                        */
/* ------------------------------------------------------------------ */

export const isCustomShaderNode = (node: AnyNode | undefined | null): node is CustomShaderNode =>
  !!node && node.type === NodeType.CUSTOM_SHADER;

/* ------------------------------------------------------------------ */
/*  ID generator (non-exported)                                       */
/* ------------------------------------------------------------------ */

const createShaderNodeId = () =>
  `custom_shader_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const getPreferredShaderNodeName = (chat: AiChatThread) => {
  const titleWithoutSuffix = chat.title.replace(/\s+chat$/i, '').trim();
  return titleWithoutSuffix || 'Shader';
};

const createUniqueShaderNodeName = (nodes: AnyNode[], preferredName: string) => {
  const takenNames = new Set(nodes.map((node) => node.name));
  if (!takenNames.has(preferredName)) {
    return preferredName;
  }

  let nextIndex = 2;
  while (takenNames.has(`${preferredName} ${nextIndex}`)) {
    nextIndex += 1;
  }

  return `${preferredName} ${nextIndex}`;
};

export const createCustomShaderNodeFromCode = (
  nodes: AnyNode[],
  chat: AiChatThread,
  shaderCode: string,
): CustomShaderNode => {
  const name = createUniqueShaderNodeName(nodes, getPreferredShaderNodeName(chat));

  return {
    id: createShaderNodeId(),
    type: NodeType.CUSTOM_SHADER,
    name,
    enabled: true,
    fragmentShader: shaderCode,
    uniforms: parseUniformsFromGLSL(shaderCode),
  };
};

export const applyShaderCodeToNodes = (
  nodes: AnyNode[],
  nodeId: string,
  shaderCode: string,
): AnyNode[] =>
  nodes.map((node) =>
    node.id === nodeId && node.type === NodeType.CUSTOM_SHADER
      ? ({
          ...node,
          fragmentShader: shaderCode,
          uniforms: parseUniformsFromGLSL(shaderCode),
        } as CustomShaderNode)
      : node,
  );

export const buildShaderArtifactFromStream = (
  existingMessage: AiChatMessage,
  update: ShaderGenerationStreamUpdate,
) => {
  const existingArtifact =
    existingMessage.artifact?.type === 'shader' ? existingMessage.artifact : undefined;

  if (!update.shaderCode.trim() && !(update.suggestions.length > 0) && !existingArtifact) {
    return existingMessage.artifact;
  }

  return {
    type: 'shader' as const,
    code: update.shaderCode || existingArtifact?.code || '',
    provider: update.provider,
    model: update.model,
    suggestions: update.suggestions.length > 0 ? update.suggestions : existingArtifact?.suggestions,
    validationErrors: existingArtifact?.validationErrors,
  };
};
