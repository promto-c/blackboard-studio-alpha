import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as Icons from '@blackboard/icons';
import type { Scene3DAssetReference, Scene3DItem } from '@blackboard/types';
import { loadScene3DAssetObject } from '@/renderer/scene3dAssetLoader';
import { createScene3DPreviewRenderer } from '@/renderer/scene3dPreviewRenderer';
import {
  disposeScene3DObject,
  getImportedScene3DObjectBox,
  identityScene3DColorTransform,
} from '@/renderer/scene3dRenderer';
import { getAsset } from '@/state/assetStorage';
import { VIEWPORT_BACKGROUND } from '@/utils/colors';

export interface Scene3DAssetPreviewProps {
  asset: Scene3DAssetReference;
  className?: string;
}

type PreviewStatus = 'loading' | 'ready' | 'error';

const createPreviewItem = (asset: Scene3DAssetReference): Scene3DItem => ({
  id: `asset-preview:${asset.assetId}`,
  name: asset.fileName,
  type: asset.kind === 'splat' ? 'splat' : 'model',
  visible: true,
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
  color: asset.kind === 'splat' ? '#67e8f9' : '#e5e7eb',
  asset,
});

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'The 3D asset could not be loaded.';

export function Scene3DAssetPreview({ asset, className = '' }: Scene3DAssetPreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<PreviewStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frameId: number | null = null;
    let importedObject: THREE.Object3D | null = null;
    let splatRenderer: THREE.Object3D | null = null;
    let grid: THREE.GridHelper | null = null;
    let resizeObserver: ResizeObserver | null = null;

    setStatus('loading');
    setErrorMessage('');

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = createScene3DPreviewRenderer();
    } catch (error) {
      setStatus('error');
      setErrorMessage(getErrorMessage(error));
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(VIEWPORT_BACKGROUND, 1);
    renderer.domElement.className = 'block h-full w-full touch-none';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1f2937, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(4, 3, 5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };

    const resize = () => {
      const bounds = mount.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const renderLoop = () => {
      if (disposed) return;
      controls.update();
      camera.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(renderLoop);
    };

    const frameAsset = (object: THREE.Object3D) => {
      object.updateMatrixWorld(true);
      const box = getImportedScene3DObjectBox(object, true);
      const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty() ? new THREE.Vector3(2, 2, 2) : box.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.5);
      const direction = new THREE.Vector3(1, 0.65, 1).normalize();
      const distance = Math.max(radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)), 2);
      const resetPosition = center.clone().add(direction.multiplyScalar(distance * 1.15));

      camera.near = Math.max(distance / 1000, 0.001);
      camera.far = Math.max(distance * 100, 100);
      camera.updateProjectionMatrix();

      const resetView = () => {
        camera.position.copy(resetPosition);
        controls.target.copy(center);
        camera.lookAt(center);
        controls.update();
      };
      resetViewRef.current = resetView;
      resetView();

      const gridSize = Math.max(size.x, size.z, radius * 2, 2) * 2.5;
      grid = new THREE.GridHelper(gridSize, 16, 0x334155, 0x1f2937);
      grid.position.set(center.x, box.isEmpty() ? -radius : box.min.y, center.z);
      scene.add(grid);
    };

    resize();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
    } else {
      window.addEventListener('resize', resize);
    }
    frameId = requestAnimationFrame(renderLoop);

    void (async () => {
      try {
        const blob = await getAsset(asset.assetId);
        if (!blob) throw new Error(`Asset "${asset.fileName}" was not found.`);

        const loaded = await loadScene3DAssetObject(
          createPreviewItem(asset),
          blob,
          () => import('@/renderer/scene3dSplatRuntime'),
          identityScene3DColorTransform,
        );
        if (disposed) {
          disposeScene3DObject(loaded.object);
          return;
        }

        importedObject = loaded.object;
        scene.add(importedObject);

        if (loaded.usesSplatRenderer) {
          const runtime = await import('@/renderer/scene3dSplatRuntime');
          if (disposed) return;
          splatRenderer = runtime.createScene3DSplatRenderer(renderer);
          scene.add(splatRenderer);
        }

        frameAsset(importedObject);
        setStatus('ready');
      } catch (error) {
        if (disposed) return;
        console.error(`Failed to preview 3D asset ${asset.fileName}`, error);
        setErrorMessage(getErrorMessage(error));
        setStatus('error');
      }
    })();

    return () => {
      disposed = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', resize);
      controls.dispose();
      if (grid) {
        scene.remove(grid);
        disposeScene3DObject(grid);
      }
      if (importedObject) {
        scene.remove(importedObject);
        disposeScene3DObject(importedObject);
      }
      if (splatRenderer) {
        scene.remove(splatRenderer);
        disposeScene3DObject(splatRenderer);
      }
      renderer.dispose();
      renderer.domElement.remove();
      resetViewRef.current = () => {};
    };
  }, [asset]);

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <div
        ref={mountRef}
        className="absolute inset-0"
        aria-label={`3D preview of ${asset.fileName}`}
      />
      {status === 'loading' ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-950/45 text-cyan-100">
          <Icons.CubeTransparent className="h-8 w-8 animate-pulse text-cyan-300" />
          <span className="text-xs">Loading 3D asset…</span>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-950/90 px-8 text-center">
          <Icons.CubeTransparent className="h-8 w-8 text-rose-300" />
          <p className="text-sm font-medium text-rose-100">3D preview unavailable</p>
          <p className="max-w-md text-xs leading-5 text-gray-400">{errorMessage}</p>
        </div>
      ) : null}
      {status === 'ready' ? (
        <>
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-gray-950/70 px-2 py-1 text-[10px] text-gray-400 backdrop-blur">
            Drag to orbit · Scroll to zoom · Right-drag to pan
          </div>
          <button
            type="button"
            onClick={() => resetViewRef.current()}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-gray-950/70 text-gray-300 shadow-lg backdrop-blur transition hover:bg-white/10 hover:text-white"
            title="Reset 3D view"
            aria-label="Reset 3D view"
          >
            <Icons.Reset className="h-4 w-4" />
          </button>
        </>
      ) : null}
    </div>
  );
}

export default Scene3DAssetPreview;
