import { NodeType, type AnyUniform, type KeyerNode } from '@blackboard/types';
import type { ViewportPointerEvent } from '@/nodes/NodeDefinition';
import { colorManagementService } from '@/color-management';
import { getSourcePixelDataForFrame } from '@/state/editor/services/sourcePixelData';
import type { PixelDataResult } from '@/state/editor/services/pixelData';
import { getUpstreamSourceNodes } from '@/utils/mediaSourceSelection';
import { KEYER_SAMPLE_TOOL_ID, clampUnit } from '@/nodes/effects/keyer/keyerModel';
import {
  collectKeyerAreaColors,
  createKeyerSampleResult,
  type KeyerSampleResult,
} from '@/nodes/effects/keyer/keyerSampling';
import { setKeyerSampleDrag } from '@/nodes/effects/keyer/keyerSampleDragStore';
import type { ViewportAdapterContext } from '../viewportAdapterContext';
import { BaseViewportInteraction } from './BaseViewportInteraction';

type ScenePoint = { x: number; y: number };

interface KeyerSampleSession {
  node: KeyerNode;
  start: ScenePoint;
  current: ScenePoint;
  isAreaDrag: boolean;
  released: boolean;
  originalUniforms: Record<string, AnyUniform>;
  currentUniforms: Record<string, AnyUniform>;
  restoreViewMode: number | null;
  pixels: PixelDataResult | null;
  pixelsPromise: Promise<PixelDataResult | null> | null;
}

export class KeyerViewportInteraction extends BaseViewportInteraction {
  private session: KeyerSampleSession | null = null;
  private previewFrameId: number | null = null;

  constructor(ctx: ViewportAdapterContext) {
    super(ctx);
  }

  getCursor(): string | null {
    return this.ctx.activeViewportTool === KEYER_SAMPLE_TOOL_ID ? 'cursor-crosshair' : null;
  }

  handleMouseDown(event: ViewportPointerEvent): boolean {
    const selectedNode = this.ctx.selectedNode;
    if (
      event.button !== 0 ||
      selectedNode?.type !== NodeType.KEYER ||
      this.ctx.activeViewportTool !== KEYER_SAMPLE_TOOL_ID
    ) {
      return false;
    }

    event.nativeEvent.preventDefault();
    this.cancelSession();
    const start = { x: event.sceneX, y: event.sceneY };
    const uniforms = selectedNode.uniforms as Record<string, AnyUniform>;
    this.session = {
      node: selectedNode as KeyerNode,
      start,
      current: start,
      isAreaDrag: false,
      released: false,
      originalUniforms: uniforms,
      currentUniforms: uniforms,
      restoreViewMode: null,
      pixels: null,
      pixelsPromise: null,
    };
    setKeyerSampleDrag({ nodeId: selectedNode.id, start, current: start });
    return true;
  }

  handleMouseMove(event: ViewportPointerEvent): boolean {
    const session = this.session;
    if (!session || session.released || this.ctx.selectedNode?.type !== NodeType.KEYER)
      return false;

    session.current = { x: event.sceneX, y: event.sceneY };
    setKeyerSampleDrag({
      nodeId: session.node.id,
      start: session.start,
      current: session.current,
    });

    if (!session.isAreaDrag && this.getDistance(session) > this.getClickThreshold()) {
      session.isAreaDrag = true;
      this.beginOverlayPreview(session);
      this.ensureAreaPixels(session);
    }

    if (session.isAreaDrag && session.pixels) {
      this.scheduleAreaPreview(session);
    }
    return true;
  }

  handleMouseUp(event: ViewportPointerEvent): boolean {
    const session = this.session;
    if (!session || session.released || this.ctx.selectedNode?.type !== NodeType.KEYER)
      return false;

    session.current = { x: event.sceneX, y: event.sceneY };
    session.released = true;
    this.cancelScheduledPreview();
    setKeyerSampleDrag(null);

    if (!session.isAreaDrag) {
      const pixel = this.ctx.pixelInfo;
      if (pixel) {
        const sample = createKeyerSampleResult([
          [...pixel.color.slice(0, 3)] as [number, number, number],
        ]);
        const uniforms = this.createSampledUniforms(session.currentUniforms, sample);
        if (uniforms) this.ctx.updateNode(session.node.id, { uniforms }, true);
      }
      this.session = null;
      return true;
    }

    void this.commitAreaSample(session);
    return true;
  }

  hasGlobalMouseCapture(): boolean {
    return this.session !== null && !this.session.released;
  }

  cleanupOnToolChange(): void {
    this.cancelSession();
  }

  private getClickThreshold(): number {
    return 4 / Math.max(this.ctx.zoom, 0.01);
  }

  private getDistance(session: KeyerSampleSession): number {
    return Math.hypot(session.current.x - session.start.x, session.current.y - session.start.y);
  }

  private beginOverlayPreview(session: KeyerSampleSession): void {
    if (!session.node.matteOverlayWhileAdjusting) return;
    const currentView = Number(session.currentUniforms.u_viewMode?.value ?? 0);
    if (currentView !== 0 && currentView !== 4) return;

    session.restoreViewMode = currentView;
    session.currentUniforms = this.withUniformValues(session.currentUniforms, { u_viewMode: 2 });
    this.ctx.updateNode(session.node.id, { uniforms: session.currentUniforms }, false);
  }

  private ensureAreaPixels(session: KeyerSampleSession): Promise<PixelDataResult | null> {
    if (session.pixelsPromise) return session.pixelsPromise;
    const sceneNode = this.ctx.sceneNode;
    const upstreamNodes = getUpstreamSourceNodes(this.ctx.nodes, session.node.id);
    if (!sceneNode || upstreamNodes.length === 0) {
      session.pixelsPromise = Promise.resolve(null);
      return session.pixelsPromise;
    }

    session.pixelsPromise = getSourcePixelDataForFrame(
      {
        kind: 'upstream',
        nodes: upstreamNodes,
        sceneNode,
        projectColorManagement: this.ctx.projectColorManagement,
      },
      this.ctx.visualFrame,
      sceneNode.fps || 30,
      { finalColorSpace: 'scene_linear' },
    )
      .catch(() => null)
      .then((pixels) => {
        if (this.session === session) session.pixels = pixels;
        if (pixels && this.session === session && !session.released) {
          this.scheduleAreaPreview(session);
        }
        return pixels;
      });
    return session.pixelsPromise;
  }

  private scheduleAreaPreview(session: KeyerSampleSession): void {
    if (this.previewFrameId !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.applyAreaPreview(session);
      return;
    }

    this.previewFrameId = requestAnimationFrame(() => {
      this.previewFrameId = null;
      this.applyAreaPreview(session);
    });
  }

  private applyAreaPreview(session: KeyerSampleSession): void {
    if (this.session !== session || session.released || !session.pixels) return;
    const sample = this.createAreaSample(session, session.pixels);
    const uniforms = this.createSampledUniforms(session.currentUniforms, sample);
    if (!uniforms) return;

    session.currentUniforms = uniforms;
    this.ctx.updateNode(session.node.id, { uniforms }, false);
  }

  private async commitAreaSample(session: KeyerSampleSession): Promise<void> {
    const pixels = session.pixels ?? (await this.ensureAreaPixels(session));
    if (this.session !== session) return;

    const sample = pixels ? this.createAreaSample(session, pixels) : null;
    let uniforms = this.createSampledUniforms(session.currentUniforms, sample);
    if (uniforms && session.restoreViewMode !== null) {
      uniforms = this.withUniformValues(uniforms, { u_viewMode: session.restoreViewMode });
    }

    if (uniforms) {
      this.ctx.updateNode(session.node.id, { uniforms }, true);
    } else if (session.restoreViewMode !== null) {
      this.ctx.updateNode(
        session.node.id,
        {
          uniforms: this.withUniformValues(session.currentUniforms, {
            u_viewMode: session.restoreViewMode,
          }),
        },
        false,
      );
    }
    this.session = null;
  }

  private createAreaSample(
    session: KeyerSampleSession,
    pixels: PixelDataResult,
  ): KeyerSampleResult | null {
    const sceneNode = this.ctx.sceneNode;
    if (!sceneNode) return null;
    const colors = collectKeyerAreaColors({
      ...pixels,
      sceneWidth: sceneNode.width,
      sceneHeight: sceneNode.height,
      start: session.start,
      end: session.current,
    });
    return createKeyerSampleResult(colors);
  }

  private createSampledUniforms(
    uniforms: Record<string, AnyUniform>,
    sample: KeyerSampleResult | null,
  ): Record<string, AnyUniform> | null {
    if (!sample) return null;
    const snapshot = colorManagementService.getSnapshot();
    const pickingColor = colorManagementService
      .transformRgb(snapshot.workingColorSpace, snapshot.colorPickingColorSpace, sample.keyColor)
      .map(clampUnit) as [number, number, number];

    return this.withUniformValues(uniforms, {
      u_keyColor: pickingColor,
      u_hueLow: sample.hueRange[0],
      u_hueHigh: sample.hueRange[1],
      u_satLow: sample.saturationRange[0],
      u_satHigh: sample.saturationRange[1],
      u_lumaLow: sample.luminanceRange[0],
      u_lumaHigh: sample.luminanceRange[1],
    });
  }

  private withUniformValues(
    uniforms: Record<string, AnyUniform>,
    values: Record<string, boolean | number | [number, number, number]>,
  ): Record<string, AnyUniform> {
    return Object.fromEntries(
      Object.entries(uniforms).map(([name, uniform]) => [
        name,
        Object.prototype.hasOwnProperty.call(values, name)
          ? { ...uniform, value: values[name] }
          : uniform,
      ]),
    ) as Record<string, AnyUniform>;
  }

  private cancelScheduledPreview(): void {
    if (this.previewFrameId === null) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.previewFrameId);
    this.previewFrameId = null;
  }

  private cancelSession(): void {
    const session = this.session;
    this.cancelScheduledPreview();
    setKeyerSampleDrag(null);
    if (session?.isAreaDrag) {
      this.ctx.updateNode(session.node.id, { uniforms: session.originalUniforms }, false);
    }
    this.session = null;
  }
}
