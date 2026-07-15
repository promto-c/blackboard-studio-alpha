import { useEffect, useMemo, useRef, useState } from 'react';
import { createStudioRenderer } from '@blackboard/renderer';
import type { MediaColorManagement } from '@blackboard/types';
import type * as THREE from 'three';
import { resolveProjectDisplayOutput } from '@/color-management';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import { createMediaPreviewGraph } from '@/utils/thumbnailRenderer';
import {
  createAssetPreviewCacheKey,
  isAbortError,
  PreviewRenderScheduler,
  markAssetPreviewMilestone,
  recordAssetPreviewMetric,
} from '@/services/assetPreview';
import { useMediaPreviewColorManagement } from '@/hooks/useMediaPreviewColorManagement';

export interface ColorManagedImagePreviewProps {
  assetId: string;
  width: number;
  height: number;
  mediaColorManagement: MediaColorManagement;
  className?: string;
  maxDimension?: number;
  autoDetectDisplayView?: boolean;
}

export function ColorManagedImagePreview({
  assetId,
  width,
  height,
  mediaColorManagement,
  className = '',
  maxDimension = 2048,
  autoDetectDisplayView = false,
}: ColorManagedImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const schedulerRef = useRef(new PreviewRenderScheduler(1));
  const activeControllerRef = useRef<AbortController | null>(null);
  const renderPromisesRef = useRef(new Set<Promise<void>>());
  const [rendererReady, setRendererReady] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const projectColorManagement = useMediaPreviewColorManagement(
    mediaColorManagement,
    autoDetectDisplayView,
  );
  const source = useMemo(
    () => ({ assetId, width, height, mediaColorManagement, mediaKind: 'image' as const }),
    [assetId, height, mediaColorManagement, width],
  );
  const previewKey = createAssetPreviewCacheKey(source, projectColorManagement, {
    mode: 'viewer-preview',
    maxDimension,
  });
  const renderInputRef = useRef({ source, projectColorManagement });
  renderInputRef.current = { source, projectColorManagement };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scheduler = schedulerRef.current;
    const renderPromises = renderPromisesRef.current;
    const renderer = createStudioRenderer({
      canvas,
      preserveDrawingBuffer: true,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    rendererRef.current = renderer;
    setRendererReady(true);
    return () => {
      activeControllerRef.current?.abort();
      scheduler.cancelQueued();
      rendererRef.current = null;
      const pendingRenders = [...renderPromises];
      if (pendingRenders.length > 0) {
        void Promise.allSettled(pendingRenders).then(() => renderer.dispose());
      } else {
        renderer.dispose();
      }
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!rendererReady || !renderer) return;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const current = renderInputRef.current;
    setStatus('loading');
    setError(null);

    const renderPromise = schedulerRef.current.schedule(
      async (signal) => {
        recordAssetPreviewMetric('rendererExecutions');
        const graph = createMediaPreviewGraph(
          current.source,
          current.projectColorManagement,
          maxDimension,
        );
        const output = resolveProjectDisplayOutput(current.projectColorManagement.viewer);
        const result = await renderWithSharedPipeline({
          nodes: graph.nodes,
          sceneNode: graph.sceneNode,
          projectColorManagement: current.projectColorManagement,
          frame: 0,
          width: graph.sceneNode.width,
          height: graph.sceneNode.height,
          ...output,
          textureCacheMode: 'persistent',
          renderer,
        });
        result.dispose();
        if (signal.aborted) {
          throw new DOMException('Preview canceled.', 'AbortError');
        }
      },
      { priority: 'viewer', signal: controller.signal },
    );
    renderPromisesRef.current.add(renderPromise);
    void renderPromise
      .then(() => {
        if (!controller.signal.aborted) {
          setStatus('ready');
          markAssetPreviewMilestone('viewerPreviewMs');
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || isAbortError(cause)) return;
        recordAssetPreviewMetric('failures');
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Could not render this image.');
      })
      .finally(() => {
        if (activeControllerRef.current === controller) activeControllerRef.current = null;
        renderPromisesRef.current.delete(renderPromise);
      });

    return () => controller.abort();
  }, [maxDimension, previewKey, rendererReady]);

  return (
    <div className={`relative flex min-h-0 min-w-0 items-center justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        className={`max-h-full max-w-full rounded-md object-contain shadow-2xl shadow-black/40 ${
          status === 'ready' ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label="Color-managed image preview"
      />
      {status === 'loading' ? (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-gray-500"
          aria-busy="true"
        >
          Rendering preview…
        </div>
      ) : null}
      {status === 'error' ? (
        <p role="alert" className="absolute inset-x-4 text-center text-xs text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
