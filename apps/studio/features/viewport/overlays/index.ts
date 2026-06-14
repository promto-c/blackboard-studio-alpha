/**
 * Barrel export for viewport overlay modules.
 *
 * Re-exports the public API consumed by Viewport.tsx:
 * - ViewportOverlayRenderer (component)
 * - resolveOverlayVisibility (function)
 * - ViewportOverlayExtraContext (interface)
 *
 * Overlay components are assigned directly in each node definition
 * via `ViewportOverlayComponent` on the NodeDefinition object.
 */
export { ViewportOverlayRenderer, resolveOverlayVisibility } from './renderer';
export { ecc } from './context';
export type {
  PaintOverlayContext,
  RotoOverlayContext,
  ViewportOverlayExtraContext,
  ViewportOverlayViewportContext,
} from './context';
