import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NodeType, type Scene3DNode } from '@blackboard/types';
import { createDefaultScene3DSettings } from '@/nodes/builtin/scene_3d/scene3d';
import {
  SCENE_3D_RENDER_COLOR_BOUNDARY,
  applyScene3DSplatImportOrientation,
  configureScene3DDepthRenderTarget,
  configureScene3DSceneLinearRenderer,
  createScene3DBackdropPlaneGeometry,
  createScene3DRenderableScene,
  fitImportedScene3DObjectToScene,
  renderScene3DToTarget,
  updateScene3DSplatProjection,
} from './scene3dRenderer';

const createRendererMock = () =>
  ({
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 2,
    getRenderTarget: vi.fn(() => null),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  }) as unknown as THREE.WebGLRenderer;

const createScene3DTestNode = (): Scene3DNode => {
  const scene3d = createDefaultScene3DSettings(320, 180);
  return {
    id: 'scene3d',
    type: NodeType.SCENE_3D,
    name: 'Scene 3D',
    enabled: true,
    opacity: 100,
    operator: 'over',
    viewportMode: 'scene3d',
    inputs: { backdrop: 'image' },
    inputSourcePorts: { backdrop: 'output' },
    scene3d: {
      ...scene3d,
      world: {
        ...scene3d.world,
        environmentColor: '#112233',
        environmentGroundColor: '#445566',
        environmentIntensity: 6.5,
      },
      items: [
        ...scene3d.items,
        {
          id: 'light',
          name: 'HDR Light',
          type: 'light',
          visible: true,
          transform: {
            position: { x: 100, y: 100, z: 500 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          color: '#ffddaa',
          intensity: 14.25,
        },
        {
          id: 'box',
          name: 'Box',
          type: 'box',
          visible: true,
          transform: {
            position: { x: 0, y: 0, z: scene3d.bounds.z * 0.1 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          size: { x: 80, y: 80, z: 80 },
          color: '#336699',
        },
      ],
    },
  } as Scene3DNode;
};

describe('Scene 3D scene-linear renderer', () => {
  it('declares a pipeline scene-linear output boundary', () => {
    expect(SCENE_3D_RENDER_COLOR_BOUNDARY).toEqual({
      outputContract: 'pipeline',
      rendererWorkingSpace: 'scene_linear',
      renderTargetColorSpace: 'scene_linear',
      backdropInput: 'scene_linear',
    });
  });

  it('uses a linear Three.js output configuration without tone mapping', () => {
    const renderer = createRendererMock();

    configureScene3DSceneLinearRenderer(renderer);

    expect(renderer.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
  });

  it('upgrades the color-only compositor target with depth for 3D rendering', () => {
    const target = new THREE.WebGLRenderTarget(64, 36, {
      depthBuffer: false,
      stencilBuffer: true,
    });
    const dispose = vi.spyOn(target, 'dispose');

    configureScene3DDepthRenderTarget(target);

    expect(target.depthBuffer).toBe(true);
    expect(target.stencilBuffer).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('builds renderable scene geometry with converted HDR environment, light, and base colors', () => {
    const backdropTexture = new THREE.Texture();
    const renderable = createScene3DRenderableScene({
      node: createScene3DTestNode(),
      sceneNode: { width: 320, height: 180 },
      aspect: 16 / 9,
      backdropTexture,
      transformColorPickingToSceneLinear: ([r, g, b]) => [r + 1, g + 2, b + 3],
    });

    try {
      const meshes = renderable.scene.children.filter(
        (child): child is THREE.Mesh => (child as THREE.Mesh).isMesh,
      );
      const backdropPlane = meshes.find(
        (mesh) => (mesh.material as THREE.MeshBasicMaterial).map === backdropTexture,
      );
      const boxMesh = meshes.find((mesh) => mesh.geometry instanceof THREE.BoxGeometry);
      const boxMaterial = boxMesh?.material as THREE.MeshStandardMaterial | undefined;
      const environmentLight = renderable.scene.children.find(
        (child): child is THREE.HemisphereLight => child instanceof THREE.HemisphereLight,
      );
      const directLight = renderable.scene.children.find(
        (child): child is THREE.DirectionalLight =>
          child instanceof THREE.DirectionalLight && child.name === 'light',
      );

      expect(backdropPlane).toBeDefined();
      const backdropMaterial = backdropPlane?.material as THREE.MeshBasicMaterial;
      expect(backdropMaterial.transparent).toBe(false);
      expect(backdropMaterial.depthTest).toBe(false);
      expect(backdropMaterial.depthWrite).toBe(false);
      expect(backdropPlane?.renderOrder).toBeLessThan(0);
      expect(boxMesh).toBeDefined();
      expect(boxMaterial?.color.r).toBeGreaterThan(1);
      expect(environmentLight?.color.r).toBeGreaterThan(1);
      expect(environmentLight?.groundColor.g).toBeGreaterThan(2);
      expect(environmentLight?.intensity).toBe(6.5);
      expect(directLight?.color.b).toBeGreaterThan(3);
      expect(directLight?.intensity).toBe(14.25);
    } finally {
      renderable.dispose();
    }
  });

  it('projects a prepared model object with live item transforms without disposing cached assets', () => {
    const node = createScene3DTestNode();
    const modelItem = {
      id: 'model',
      name: 'Model',
      type: 'model' as const,
      visible: true,
      transform: {
        position: { x: 20, y: -10, z: 40 },
        rotation: { x: 0, y: 45, z: 0 },
        scale: { x: 1.5, y: 1.5, z: 1.5 },
      },
      color: '#ffffff',
      asset: {
        assetId: 'model-asset',
        fileName: 'model.glb',
        kind: 'mesh' as const,
        format: 'glb' as const,
      },
    };
    node.scene3d = {
      ...node.scene3d,
      items: [...node.scene3d.items, modelItem],
    };
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const cachedObject = new THREE.Mesh(geometry, material);
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const renderable = createScene3DRenderableScene({
      node,
      sceneNode: { width: 320, height: 180 },
      aspect: 16 / 9,
      assetObjects: new Map([[modelItem.id, cachedObject]]),
    });

    const projectedRoot = renderable.scene.getObjectByName(modelItem.id);
    expect(projectedRoot).toBeDefined();
    expect(projectedRoot?.position.x).toBeCloseTo(
      modelItem.transform.position.x * node.scene3d.world.pixelScale,
    );
    expect(projectedRoot?.position.y).toBeCloseTo(
      modelItem.transform.position.y * node.scene3d.world.pixelScale,
    );
    expect(projectedRoot?.children).toContain(cachedObject);

    renderable.dispose();

    expect(cachedObject.parent).toBeNull();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    geometry.dispose();
    material.dispose();
  });

  it('creates DOM-canvas backdrop geometry with top-left UV orientation', () => {
    const renderTargetGeometry = createScene3DBackdropPlaneGeometry(2, 2, 'render-target');
    const domCanvasGeometry = createScene3DBackdropPlaneGeometry(2, 2, 'dom-canvas');
    const renderTargetUv = renderTargetGeometry.getAttribute('uv');
    const domCanvasUv = domCanvasGeometry.getAttribute('uv');

    try {
      for (let index = 0; index < renderTargetUv.count; index += 1) {
        expect(domCanvasUv.getX(index)).toBe(renderTargetUv.getX(index));
        expect(domCanvasUv.getY(index)).toBe(1 - renderTargetUv.getY(index));
      }
    } finally {
      renderTargetGeometry.dispose();
      domCanvasGeometry.dispose();
    }
  });

  it('applies Spark splat import orientation once at the object boundary', () => {
    const object = new THREE.Object3D();

    applyScene3DSplatImportOrientation(object);

    expect(object.quaternion.x).toBeCloseTo(1, 6);
    expect(object.quaternion.y).toBeCloseTo(0, 6);
    expect(object.quaternion.z).toBeCloseTo(0, 6);
    expect(object.quaternion.w).toBeCloseTo(0, 6);
  });

  it('awaits Spark projection updates while the render scene and camera remain available', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const renderSize = new THREE.Vector2();
    let finishUpdate: (() => void) | undefined;
    const update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUpdate = resolve;
        }),
    );
    const splatRenderer = Object.assign(new THREE.Object3D(), { renderSize, update });
    scene.add(splatRenderer);

    const pending = updateScene3DSplatProjection({
      splatRenderer,
      scene,
      camera,
      width: 640,
      height: 360,
    });

    expect(renderSize.toArray()).toEqual([640, 360]);
    expect(update).toHaveBeenCalledWith({ scene, camera });
    expect(splatRenderer.parent).toBe(scene);
    finishUpdate?.();
    await pending;
  });

  it('fits splat-like imported objects around the scene origin after scaling and orientation', () => {
    const scene3d = createDefaultScene3DSettings(1000, 500);
    const localCenter = new THREE.Vector3(3, 4, 5);
    const object = new THREE.Object3D() as THREE.Object3D & { getBoundingBox: () => THREE.Box3 };
    object.getBoundingBox = () =>
      new THREE.Box3(
        new THREE.Vector3(localCenter.x - 1, localCenter.y - 2, localCenter.z - 3),
        new THREE.Vector3(localCenter.x + 1, localCenter.y + 2, localCenter.z + 3),
      );
    object.quaternion.set(1, 0, 0, 0);

    fitImportedScene3DObjectToScene(object, scene3d, 1);
    const fittedCenter = localCenter
      .clone()
      .multiply(object.scale)
      .applyQuaternion(object.quaternion)
      .add(object.position);

    expect(fittedCenter.x).toBeCloseTo(0, 6);
    expect(fittedCenter.y).toBeCloseTo(0, 6);
    expect(fittedCenter.z).toBeCloseTo(0, 6);
  });

  it('renders to a scene-linear target and restores renderer state', () => {
    const renderer = createRendererMock();
    const target = new THREE.WebGLRenderTarget(64, 36);
    const clearRenderTargetTransparent = vi.fn();

    const rendered = renderScene3DToTarget({
      renderer,
      target,
      node: createScene3DTestNode(),
      sceneNode: { width: 320, height: 180 },
      backdropTexture: new THREE.Texture(),
      clearRenderTargetTransparent,
    });

    expect(rendered).toBe(true);
    expect(clearRenderTargetTransparent).toHaveBeenCalledWith(target);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(2);
    target.dispose();
  });
});
