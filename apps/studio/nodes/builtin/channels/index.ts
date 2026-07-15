import React from 'react';
import * as THREE from 'three';
import { NodeType, type AnyNode, type RgbaChannel } from '@blackboard/types';
import {
  isPromiseLike,
  RendererShader,
  resolveRendererNodeOutputPort,
  type ResolveOutputContext,
} from '@blackboard/renderer';
import { NodeDefinition } from '../../NodeDefinition';
import * as Icons from '@blackboard/icons';
import { ExtractChannelsTool, MergeChannelsTool } from './ChannelTools';
import { ChannelShader } from './channelShader';

function NoChannelAdjustments() {
  return null;
}

function ChannelIcon({ className }: { className?: string }) {
  return React.createElement(Icons.Channels, { channel: 'RGB', className });
}

const channelPorts = [
  {
    name: 'r',
    label: 'R',
    channel: 'r' as const,
    processingDomain: 'data' as const,
    color: '#c96f78',
    description: 'Red channel.',
  },
  {
    name: 'g',
    label: 'G',
    channel: 'g' as const,
    processingDomain: 'data' as const,
    color: '#70ad87',
    description: 'Green channel.',
  },
  {
    name: 'b',
    label: 'B',
    channel: 'b' as const,
    processingDomain: 'data' as const,
    color: '#7293c2',
    description: 'Blue channel.',
  },
  {
    name: 'a',
    label: 'A',
    channel: 'a' as const,
    dataSemantic: 'alpha' as const,
    processingDomain: 'alpha' as const,
    color: '#9da5b2',
    description: 'Alpha channel.',
  },
];

const extractOutputPorts = [
  {
    name: 'output',
    label: 'RGBA',
    processingDomain: 'scene_linear' as const,
    description: 'Unchanged scene-linear RGBA pass-through used for node viewing and chaining.',
  },
  ...channelPorts,
];

export const extractChannelsNode: NodeDefinition = {
  type: NodeType.EXTRACT_CHANNELS,
  name: 'Extract Channels',
  category: 'Utility',
  renderMode: 'utility',
  processingDomain: 'scene_linear',
  description: 'Pass through RGBA and expose isolated R, G, B, and A technical outputs.',
  IconComponent: ChannelIcon,
  ToolComponent: ExtractChannelsTool,
  AdjustmentComponent: NoChannelAdjustments,
  flags: {},
  inputPorts: [
    {
      name: 'source',
      label: 'Source',
      type: 'texture',
      required: true,
      description: 'Texture to split into isolated channel outputs.',
    },
  ],
  outputPorts: extractOutputPorts,
  renderOutput: (
    node: AnyNode,
    target: THREE.WebGLRenderTarget,
    _inputTexture: THREE.Texture | undefined,
    context: ResolveOutputContext,
    portName?: string,
  ): boolean | Promise<boolean> => {
    const sourceNodeId = (node as { inputs?: Record<string, string> }).inputs?.source;
    const sourcePort = context.getInputSourcePort(node, 'source');
    const sourceResult = sourceNodeId
      ? context.resolveOutput(sourceNodeId, sourcePort)
      : _inputTexture;

    const doRender = (sourceTexture: THREE.Texture | undefined): boolean => {
      const inputTexture = sourceTexture ?? context.getTransparentInputTexture();
      const channelPort = channelPorts.find((port) => port.name === portName);
      const resolvedPortName = channelPort?.name ?? 'output';
      const material = channelPort
        ? context.getMaterial(
            `${node.id}_extract_channels_${resolvedPortName}`,
            ChannelShader.EXTRACT,
            {
              u_tDiffuse: { value: inputTexture },
              u_channel: { value: context.getChannelIndex(resolvedPortName, 'r') },
            },
          )
        : context.getMaterial(`${node.id}_extract_channels_output`, RendererShader.TEXTURE, {
            u_tDiffuse: { value: inputTexture },
          });
      context.applyNoBlending(material);
      context.clearRenderTargetTransparent(target);
      (context.quad as THREE.Mesh).material = material;
      context.renderer.setRenderTarget(target);
      context.renderer.render(context.scene, context.camera);
      return true;
    };

    if (sourceResult && isPromiseLike(sourceResult)) {
      return sourceResult.then(doRender);
    }
    return doRender(sourceResult);
  },
  getInitialNodeProps: () => ({}),
};

export const mergeChannelsNode: NodeDefinition = {
  type: NodeType.MERGE_CHANNELS,
  name: 'Merge Channels',
  category: 'Utility',
  renderMode: 'utility',
  processingDomain: 'scene_linear',
  description: 'Build one RGBA texture from channel inputs.',
  IconComponent: ChannelIcon,
  ToolComponent: MergeChannelsTool,
  AdjustmentComponent: NoChannelAdjustments,
  flags: {
    isRenderable: true,
  },
  inputPorts: channelPorts.map((port) => ({
    ...port,
    type: 'texture',
    required: false,
  })),
  renderOutput: (
    node: AnyNode,
    target: THREE.WebGLRenderTarget,
    _inputTexture: THREE.Texture | undefined,
    context: ResolveOutputContext,
  ): boolean | Promise<boolean> => {
    const inputs = (node as { inputs?: Record<string, string> }).inputs ?? {};
    const chPorts: RgbaChannel[] = ['r', 'g', 'b', 'a'];
    const sourcePorts = chPorts.map((port) => context.getInputSourcePort(node, port));
    const sourceChannels = chPorts.map((targetChannel, index): RgbaChannel => {
      const sourceNodeId = inputs[targetChannel];
      const sourceNode = context.nodes.find((candidate) => candidate.id === sourceNodeId);
      if (!sourceNode) return targetChannel;
      const sourceDefinition = context.nodeRegistry.get(sourceNode.type);
      const sourcePort = sourceDefinition
        ? resolveRendererNodeOutputPort(sourceDefinition, sourceNode, sourcePorts[index])
        : undefined;
      return sourcePort?.channel ?? targetChannel;
    });

    const resolveChannel = (port: RgbaChannel, index: number) => {
      const sourceNodeId = inputs[port];
      return sourceNodeId ? context.resolveOutput(sourceNodeId, sourcePorts[index]) : undefined;
    };

    const renderMerge = (textures: (THREE.Texture | undefined)[]): boolean => {
      const uniforms: Record<string, { value: unknown }> = {};
      chPorts.forEach((port, idx) => {
        uniforms[`u_t${port.toUpperCase()}`] = {
          value: textures[idx] ?? context.getTransparentInputTexture(),
        };
        uniforms[`u_sourceChannel${port.toUpperCase()}`] = {
          value: context.getChannelIndex(sourceChannels[idx], port),
        };
      });
      const material = context.getMaterial(
        `${node.id}_merge_channels`,
        ChannelShader.MERGE,
        uniforms,
      );
      context.applyNoBlending(material);
      context.clearRenderTargetTransparent(target);
      (context.quad as THREE.Mesh).material = material;
      context.renderer.setRenderTarget(target);
      context.renderer.render(context.scene, context.camera);
      return true;
    };

    const results = chPorts.map(resolveChannel);
    const hasAsync = results.some((r) => r && isPromiseLike(r));
    if (hasAsync) {
      return Promise.all(results).then(renderMerge);
    }
    return renderMerge(results as (THREE.Texture | undefined)[]);
  },
  getInitialNodeProps: () => ({}),
};
