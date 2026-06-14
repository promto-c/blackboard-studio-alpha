import React from 'react';
import * as THREE from 'three';
import { NodeType, type AnyNode } from '@blackboard/types';
import { isPromiseLike, type ResolveOutputContext } from '@blackboard/renderer';
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
  { name: 'r', label: 'R', description: 'Red channel.' },
  { name: 'g', label: 'G', description: 'Green channel.' },
  { name: 'b', label: 'B', description: 'Blue channel.' },
  { name: 'a', label: 'A', description: 'Alpha channel.' },
];

export const extractChannelsNode: NodeDefinition = {
  type: NodeType.EXTRACT_CHANNELS,
  name: 'Extract Channels',
  category: 'Utility',
  renderMode: 'utility',
  description: 'Split one texture into isolated R, G, B, and A outputs.',
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
  outputPorts: channelPorts,
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
      const material = context.getMaterial(`${node.id}_extract_channels`, ChannelShader.EXTRACT, {
        u_tDiffuse: { value: sourceTexture ?? context.getTransparentInputTexture() },
        u_channel: { value: context.getChannelIndex(portName, 'r') },
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
    const chPorts = ['r', 'g', 'b', 'a'];

    const resolveChannel = (port: string) => {
      const sourceNodeId = inputs[port];
      const sourcePort = context.getInputSourcePort(node, port, port);
      return sourceNodeId ? context.resolveOutput(sourceNodeId, sourcePort) : undefined;
    };

    const renderMerge = (textures: (THREE.Texture | undefined)[]): boolean => {
      const uniforms: Record<string, { value: unknown }> = {};
      chPorts.forEach((port, idx) => {
        uniforms[`u_t${port.toUpperCase()}`] = {
          value: textures[idx] ?? context.getTransparentInputTexture(),
        };
        const sourcePort = context.getInputSourcePort(node, port, port);
        uniforms[`u_sourceChannel${port.toUpperCase()}`] = {
          value: context.getChannelIndex(sourcePort, port),
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
