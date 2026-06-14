/**
 * ViewportOverlayRenderer — Registry-based overlay dispatch component.
 *
 * Renders the correct overlay component by looking up the node's
 * definition from the node registry. No if/else chains on node types.
 */
import React from 'react';
import type { AnyNode } from '@blackboard/types';
import type {
  ViewportOverlayProps,
  ViewportOverlayVisibilityContext,
} from '@/nodes/NodeDefinition';
import { nodeRegistry } from '@/nodes/registry';

interface ViewportOverlayRendererProps {
  node?: { type: string } | null;
  mode: 'svg' | 'svg-direct' | 'html';
  overlayProps: ViewportOverlayProps;
}

export function ViewportOverlayRenderer({
  node,
  mode,
  overlayProps,
}: ViewportOverlayRendererProps) {
  if (!node) return null;
  const def = nodeRegistry.get(node.type);
  if (!def) return null;

  let Component: React.ComponentType<ViewportOverlayProps> | undefined;
  if (mode === 'svg') Component = def.ViewportOverlayComponent;
  else if (mode === 'svg-direct') Component = def.ViewportOverlayDirectComponent;
  else if (mode === 'html') Component = def.ViewportHtmlOverlayComponent;

  if (!Component) return null;

  return <Component {...overlayProps} />;
}

/**
 * Resolve overlay visibility for the current node using the registry.
 * Returns `{ forceShowSvg }` where `forceShowSvg` indicates the SVG
 * overlay container should render even when the global showOverlays is off.
 */
export function resolveOverlayVisibility(
  node: AnyNode | null | undefined,
  context: ViewportOverlayVisibilityContext,
): { forceShowSvg: boolean } {
  if (!node) return { forceShowSvg: false };
  const def = nodeRegistry.get(node.type);
  if (!def?.getOverlayVisibility) return { forceShowSvg: false };
  const result = def.getOverlayVisibility(node, context);
  return { forceShowSvg: result?.forceShowSvg ?? false };
}
