import * as THREE from 'three';
import type { ViewportPipelineResources } from '@blackboard/renderer';

export interface OwnedViewportPipelineResources extends ViewportPipelineResources {
  dispose: () => void;
}

export const createViewportPipelineResources = (
  renderer: THREE.WebGLRenderer,
): OwnedViewportPipelineResources => {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geometry);
  const initialMaterials = Array.isArray(quad.material) ? quad.material : [quad.material];
  const materials = new Map<string, THREE.ShaderMaterial>();
  const renderTargets: THREE.WebGLRenderTarget[] = [];
  const utilityTargets = new Map<string, THREE.WebGLRenderTarget>();
  const ocioTextures = new Map<string, THREE.Texture>();

  scene.add(quad);
  let disposed = false;

  const resources: OwnedViewportPipelineResources = {
    renderer,
    scene,
    camera,
    quad,
    materials,
    renderTargets,
    utilityTargets,
    ocioTextures,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      materials.forEach((material) => material.dispose());
      resources.renderTargets.forEach((target) => target.dispose());
      utilityTargets.forEach((target) => target.dispose());
      ocioTextures.forEach((texture) => texture.dispose());
      materials.clear();
      resources.renderTargets = [];
      utilityTargets.clear();
      ocioTextures.clear();
      scene.remove(quad);
      initialMaterials.forEach((material) => material.dispose());
      geometry.dispose();
    },
  };
  return resources;
};
