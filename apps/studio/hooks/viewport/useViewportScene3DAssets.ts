import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  NodeType,
  type AnyNode,
  type ProjectColorManagement,
  type Scene3DNode,
  type SceneNode,
} from '@blackboard/types';
import { colorManagementService, convertColorPickingToSceneLinear } from '@/color-management';
import {
  disposeScene3DProjectionRuntimes,
  prepareScene3DProjectionAssets,
  pruneScene3DProjectionRuntimes,
  type Scene3DColorTransform,
} from '@/renderer/scene3dRenderer';

interface UseViewportScene3DAssetsOptions {
  renderer: THREE.WebGLRenderer | null;
  nodes: AnyNode[];
  sceneNode: SceneNode | undefined;
  projectColorManagement: ProjectColorManagement;
  onAssetsReady: () => void;
}

/**
 * Prepares renderer-owned 3D objects outside the synchronous viewport pass.
 * Once decoded, object/camera edits only update transforms and redraw the GPU scene.
 */
export const useViewportScene3DAssets = ({
  renderer,
  nodes,
  sceneNode,
  projectColorManagement,
  onAssetsReady,
}: UseViewportScene3DAssetsOptions): void => {
  const colorRoles = useMemo(
    () => colorManagementService.resolveProjectColorManagement(projectColorManagement),
    [projectColorManagement],
  );
  const transformColorPickingToSceneLinear = useMemo<Scene3DColorTransform>(
    () => (color) => convertColorPickingToSceneLinear(color, colorRoles),
    [colorRoles],
  );
  const scene3DNodes = useMemo(
    () =>
      nodes.filter(
        (node): node is Scene3DNode => node.type === NodeType.SCENE_3D && node.enabled !== false,
      ),
    [nodes],
  );

  useEffect(() => {
    if (!renderer) return;
    pruneScene3DProjectionRuntimes(renderer, new Set(scene3DNodes.map((node) => node.id)));
    if (!sceneNode || scene3DNodes.length === 0) return;
    let cancelled = false;

    void Promise.all(
      scene3DNodes.map((node) =>
        prepareScene3DProjectionAssets({
          renderer,
          node,
          sceneNode,
          transformColorPickingToSceneLinear,
          onDirty: onAssetsReady,
        }),
      ),
    )
      .then(() => {
        if (!cancelled) onAssetsReady();
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to prepare a 3D scene for the 2D projection.', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onAssetsReady, renderer, scene3DNodes, sceneNode, transformColorPickingToSceneLinear]);

  useEffect(
    () => () => {
      if (renderer) disposeScene3DProjectionRuntimes(renderer);
    },
    [renderer],
  );
};
