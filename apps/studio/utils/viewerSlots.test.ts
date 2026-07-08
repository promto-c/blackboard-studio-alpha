import { describe, expect, it } from 'vitest';
import {
  AnyNode,
  BlendMode,
  Flow,
  ImageFitMode,
  NodeType,
  ViewerSlotAssignments,
} from '@blackboard/types';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { createDefaultGrade } from '@/nodes/effects/grade/gradeModel';
import {
  assignViewerSlotToNode,
  getNodeInputRenderNodes,
  getOutputRenderNodes,
  getScene3DProjectionRenderNodes,
  getViewerRenderNodes,
  getViewerTargetLabel,
  getViewportRenderNodes,
  sanitizeActiveViewerSlot,
  sanitizeViewerNodeId,
  sanitizeViewerSlots,
} from '@/utils/viewerSlots';

const SCENE_NODE: AnyNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'Linear',
  maxFrames: 0,
  fps: 30,
};

const IMAGE_A: AnyNode = {
  id: 'img_a',
  type: NodeType.MEDIA_SOURCE,
  mediaKind: 'image',
  name: 'Image A',
  enabled: true,
  src: 'a',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: 'sRGB',
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
};

const IMAGE_B: AnyNode = {
  id: 'img_b',
  type: NodeType.MEDIA_SOURCE,
  mediaKind: 'image',
  name: 'Image B',
  enabled: true,
  src: 'b',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: 'sRGB',
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
};

const IMAGE_C: AnyNode = {
  id: 'img_c',
  type: NodeType.MEDIA_SOURCE,
  mediaKind: 'image',
  name: 'Image C',
  enabled: true,
  src: 'c',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: 'sRGB',
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
};

const SMALL_IMAGE: AnyNode = {
  ...IMAGE_A,
  id: 'img_small',
  name: 'Small Image',
  width: 1024,
  height: 1245,
  transform: { x: 20, y: -10, scaleX: 1.5, scaleY: 1.5, fitMode: ImageFitMode.FIT },
};

const COMFY_SOURCE: AnyNode = {
  ...IMAGE_B,
  id: 'comfy',
  type: NodeType.COMFY,
  name: 'Comfy',
  src: 'comfy-output',
  width: 2048,
  height: 2490,
  colorSpace: 'sRGB',
  detachedFromPipe: true,
  workflows: [],
  workflowControls: [],
  workflowInputImages: {},
  generatedOutputs: [],
};

const ROTO_NODE: AnyNode = {
  id: 'roto',
  type: NodeType.ROTO,
  name: 'Roto',
  enabled: true,
  paths: [],
  layers: [],
  invert: false,
};

const REFORMAT_NODE: AnyNode = {
  id: 'reformat',
  type: NodeType.REFORMAT,
  name: 'Reformat',
  enabled: true,
  width: 503,
  height: 1033,
  resizeMode: 'none',
};

const DETACHED_IMAGE_B: AnyNode = {
  ...IMAGE_B,
  detachedFromPipe: true,
};

const GRADE_B: AnyNode = {
  id: 'grade_b',
  type: NodeType.GRADE,
  name: 'Grade B',
  enabled: true,
  stacked: true,
  grade: createDefaultGrade(),
};

const MERGE_B: AnyNode = {
  id: 'merge_b',
  type: NodeType.MERGE,
  name: 'Merge B',
  enabled: true,
  opacity: 100,
  operator: BlendMode.OVER,
  inputs: { source: 'img_b' },
};

const NODES = [SCENE_NODE, IMAGE_A, IMAGE_B, GRADE_B, IMAGE_C];
const MERGED_SOURCE_NODES = [SCENE_NODE, IMAGE_A, DETACHED_IMAGE_B, MERGE_B];

const OUTPUT_NODE: AnyNode = {
  id: OUTPUT_NODE_ID,
  type: NodeType.OUTPUT,
  name: 'Output',
  enabled: true,
};

const SCENE_3D_NODE: AnyNode = {
  id: 'scene_3d',
  type: NodeType.SCENE_3D,
  name: 'Scene 3D',
  enabled: true,
  viewportMode: 'scene3d',
  scene3d: {
    bounds: { x: 1920, y: 1080, z: 720 },
    camera: {
      position: { x: 0, y: 0, z: 1152 },
      target: { x: 0, y: 0, z: 0 },
      fov: 45,
      near: 1,
      far: 6000,
    },
    world: {
      pixelScale: 0.01,
      environmentColor: '#ffffff',
      environmentGroundColor: '#1f2937',
      environmentIntensity: 1.2,
      gridEnabled: true,
      gridSize: 1920,
      gridDivisions: 16,
      showAxes: true,
      showOutputPlane: true,
    },
    items: [],
  },
};

const FLOW_TO_IMAGE_A: Flow = {
  id: 'flow',
  name: 'Flow',
  nodes: [...NODES, OUTPUT_NODE],
  edges: [
    {
      id: 'edge_img_a_output_pipe',
      sourceNodeId: 'img_a',
      sourcePort: 'output',
      targetNodeId: OUTPUT_NODE_ID,
      targetPort: 'pipe',
    },
  ],
  stacks: [],
  outputNodeId: OUTPUT_NODE_ID,
};

describe('viewerSlots utils', () => {
  it('returns full node list when no viewer node is set', () => {
    expect(getViewerRenderNodes(NODES, null)).toEqual(NODES);
  });

  it('returns full node list when viewer node cannot be found', () => {
    expect(getViewerRenderNodes(NODES, 'missing')).toEqual(NODES);
  });

  it('truncates nodes at the active viewer node', () => {
    expect(getViewerRenderNodes(NODES, 'img_a')).toEqual([SCENE_NODE, IMAGE_A]);
  });

  it('views source nodes with their pipeline transform intact', () => {
    expect(getViewerRenderNodes([SCENE_NODE, SMALL_IMAGE], 'img_small')).toEqual([
      SCENE_NODE,
      SMALL_IMAGE,
    ]);
  });

  it('derives output scene size from match-output sources without baking keep-scene mode', () => {
    const matchOutputImage: AnyNode = {
      ...SMALL_IMAGE,
      id: 'img_match_output',
      width: 2048,
      height: 2490,
      useOutputSizeAsScene: true,
    };

    expect(getOutputRenderNodes([SCENE_NODE, matchOutputImage], null)).toEqual([
      { ...SCENE_NODE, width: 2048, height: 2490 },
      {
        ...matchOutputImage,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      },
    ]);

    const keepSceneImage = { ...matchOutputImage, useOutputSizeAsScene: false };
    expect(getOutputRenderNodes([SCENE_NODE, keepSceneImage], null)).toEqual([
      SCENE_NODE,
      keepSceneImage,
    ]);
  });

  it('derives output scene size from reformat nodes', () => {
    expect(getOutputRenderNodes([SCENE_NODE, IMAGE_A, REFORMAT_NODE], null)).toEqual([
      { ...SCENE_NODE, width: 503, height: 1033 },
      IMAGE_A,
      { ...REFORMAT_NODE, sourceWidth: 1920, sourceHeight: 1080 },
    ]);
  });

  it('preserves each reformat input size when multiple reformats are chained', () => {
    const secondReformat = {
      ...REFORMAT_NODE,
      id: 'reformat_b',
      width: 1280,
      height: 720,
    } as AnyNode;

    expect(
      getOutputRenderNodes([SCENE_NODE, IMAGE_A, REFORMAT_NODE, secondReformat], null),
    ).toEqual([
      { ...SCENE_NODE, width: 1280, height: 720 },
      IMAGE_A,
      { ...REFORMAT_NODE, sourceWidth: 1920, sourceHeight: 1080 },
      { ...secondReformat, sourceWidth: 503, sourceHeight: 1033 },
    ]);
  });

  it('views downstream nodes in the latest reformat scene size', () => {
    const gradeAfterReformat = { ...GRADE_B, inputs: { pipe: REFORMAT_NODE.id } } as AnyNode;

    expect(
      getViewerRenderNodes(
        [SCENE_NODE, IMAGE_A, REFORMAT_NODE, gradeAfterReformat],
        gradeAfterReformat.id,
      ),
    ).toEqual([
      { ...SCENE_NODE, width: 503, height: 1033 },
      IMAGE_A,
      { ...REFORMAT_NODE, sourceWidth: 1920, sourceHeight: 1080 },
      gradeAfterReformat,
    ]);
  });

  it('views downstream nodes with match-output sources in their native output bbox', () => {
    const matchOutputImage: AnyNode = {
      ...SMALL_IMAGE,
      id: 'img_match_output_branch',
      width: 2048,
      height: 2490,
      useOutputSizeAsScene: true,
    };
    const rotoFromMatchOutput = {
      ...ROTO_NODE,
      inputs: { pipe: matchOutputImage.id },
    } as AnyNode;

    expect(
      getViewerRenderNodes([SCENE_NODE, matchOutputImage, rotoFromMatchOutput], 'roto'),
    ).toEqual([
      { ...SCENE_NODE, width: 2048, height: 2490 },
      {
        ...matchOutputImage,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      },
      rotoFromMatchOutput,
    ]);
  });

  it('views explicitly connected pipe branches instead of earlier list sources', () => {
    const rotoFromComfy = { ...ROTO_NODE, inputs: { pipe: COMFY_SOURCE.id } } as AnyNode;

    expect(
      getViewerRenderNodes([SCENE_NODE, IMAGE_A, rotoFromComfy, COMFY_SOURCE], 'roto'),
    ).toEqual([SCENE_NODE, COMFY_SOURCE, rotoFromComfy]);
  });

  it('views detached floating adjustments from an empty scene', () => {
    const floatingRoto = { ...ROTO_NODE, detachedFromPipe: true } as AnyNode;

    expect(getViewerRenderNodes([SCENE_NODE, IMAGE_A, floatingRoto], 'roto')).toEqual([
      SCENE_NODE,
      ROTO_NODE,
    ]);
  });

  it('uses flow edges as canonical viewer pipe inputs', () => {
    const flowToRoto: Flow = {
      id: 'flow_roto',
      name: 'Roto Flow',
      nodes: [SCENE_NODE, IMAGE_A, ROTO_NODE, COMFY_SOURCE, OUTPUT_NODE],
      edges: [
        {
          id: 'edge_comfy_roto_pipe',
          sourceNodeId: COMFY_SOURCE.id,
          sourcePort: 'output',
          targetNodeId: ROTO_NODE.id,
          targetPort: 'pipe',
        },
      ],
      stacks: [],
      outputNodeId: OUTPUT_NODE_ID,
    };

    expect(
      getViewerRenderNodes([SCENE_NODE, IMAGE_A, ROTO_NODE, COMFY_SOURCE], 'roto', flowToRoto),
    ).toEqual([SCENE_NODE, COMFY_SOURCE, { ...ROTO_NODE, inputs: { pipe: COMFY_SOURCE.id } }]);
  });

  it('uses flow edges as canonical output pipe inputs', () => {
    const flowToRotoOutput: Flow = {
      id: 'flow_roto_output',
      name: 'Roto Output Flow',
      nodes: [SCENE_NODE, IMAGE_A, ROTO_NODE, COMFY_SOURCE, OUTPUT_NODE],
      edges: [
        {
          id: 'edge_comfy_roto_pipe',
          sourceNodeId: COMFY_SOURCE.id,
          sourcePort: 'output',
          targetNodeId: ROTO_NODE.id,
          targetPort: 'pipe',
        },
        {
          id: 'edge_roto_output_pipe',
          sourceNodeId: ROTO_NODE.id,
          sourcePort: 'output',
          targetNodeId: OUTPUT_NODE_ID,
          targetPort: 'pipe',
        },
      ],
      stacks: [],
      outputNodeId: OUTPUT_NODE_ID,
    };

    expect(
      getOutputRenderNodes([SCENE_NODE, IMAGE_A, ROTO_NODE, COMFY_SOURCE], flowToRotoOutput),
    ).toEqual([SCENE_NODE, COMFY_SOURCE, { ...ROTO_NODE, inputs: { pipe: COMFY_SOURCE.id } }]);
  });

  it('renders a viewed source branch without earlier sources', () => {
    expect(getViewerRenderNodes(MERGED_SOURCE_NODES, 'img_b')).toEqual([SCENE_NODE, IMAGE_B]);
  });

  it('renders merge nodes from their explicitly connected inputs', () => {
    expect(getViewerRenderNodes(MERGED_SOURCE_NODES, 'merge_b')).toEqual([
      SCENE_NODE,
      DETACHED_IMAGE_B,
      MERGE_B,
    ]);

    const mergeWithPipe = {
      ...MERGE_B,
      inputs: { source: IMAGE_B.id, pipe: IMAGE_A.id },
    } as AnyNode;

    expect(
      getViewerRenderNodes([SCENE_NODE, IMAGE_A, DETACHED_IMAGE_B, mergeWithPipe], 'merge_b'),
    ).toEqual([SCENE_NODE, IMAGE_A, DETACHED_IMAGE_B, mergeWithPipe]);
  });

  it('treats output viewer target as full node list', () => {
    expect(getViewerRenderNodes(NODES, OUTPUT_NODE_ID)).toEqual(NODES);
  });

  it('sanitizes slot assignments for missing nodes', () => {
    const slots: ViewerSlotAssignments = { 1: 'img_a', 2: 'missing', 3: 'img_b' };
    expect(sanitizeViewerSlots(slots, NODES)).toEqual({ 1: 'img_a', 3: 'img_b' });
  });

  it('keeps only one slot per node when sanitizing duplicates', () => {
    const slots: ViewerSlotAssignments = { 1: 'img_a', 2: 'img_a', 3: 'img_b' };
    expect(sanitizeViewerSlots(slots, NODES)).toEqual({ 1: 'img_a', 3: 'img_b' });
  });

  it('reassigns a node to a new slot by removing its old slot', () => {
    const slots: ViewerSlotAssignments = { 1: 'img_a', 2: 'img_b' };
    expect(assignViewerSlotToNode(slots, 4, 'img_a')).toEqual({ 2: 'img_b', 4: 'img_a' });
  });

  it('clears invalid active slot and invalid viewer node', () => {
    const slots: ViewerSlotAssignments = { 1: 'img_a' };
    const viewerNodeId = sanitizeViewerNodeId('img_b', NODES);
    const activeViewerSlot = sanitizeActiveViewerSlot(1, slots, viewerNodeId);
    expect(viewerNodeId).toBe('img_b');
    expect(activeViewerSlot).toBeNull();
  });

  it('accepts output as viewer node target', () => {
    expect(sanitizeViewerNodeId(OUTPUT_NODE_ID, NODES)).toBe(OUTPUT_NODE_ID);
  });

  it('formats labels for viewer targets', () => {
    expect(getViewerTargetLabel(null, NODES)).toBe('Output');
    expect(getViewerTargetLabel(OUTPUT_NODE_ID, NODES)).toBe('Output');
    expect(getViewerTargetLabel('img_a', NODES)).toBe('Image A');
    expect(getViewerTargetLabel('missing', NODES)).toBe('Missing Node');
  });

  it('limits output rendering to the explicit output branch', () => {
    expect(getOutputRenderNodes(NODES, FLOW_TO_IMAGE_A)).toEqual([SCENE_NODE, IMAGE_A]);
  });

  it('returns scene-only render nodes for an unconnected input branch', () => {
    expect(
      getNodeInputRenderNodes([SCENE_NODE, IMAGE_A, SCENE_3D_NODE], 'scene_3d', 'backdrop'),
    ).toEqual([SCENE_NODE]);
  });

  it('resolves a node input branch from node input projections', () => {
    const scene3DWithBackdrop = {
      ...SCENE_3D_NODE,
      inputs: { backdrop: IMAGE_B.id },
    } as AnyNode;

    expect(
      getNodeInputRenderNodes(
        [SCENE_NODE, IMAGE_A, IMAGE_B, scene3DWithBackdrop],
        'scene_3d',
        'backdrop',
      ),
    ).toEqual([SCENE_NODE, IMAGE_B]);
  });

  it('resolves a node input branch from canonical flow edges', () => {
    const flowToScene3DBackdrop: Flow = {
      id: 'flow_scene3d_backdrop',
      name: 'Scene 3D Backdrop Flow',
      nodes: [SCENE_NODE, IMAGE_A, IMAGE_B, SCENE_3D_NODE, OUTPUT_NODE],
      edges: [
        {
          id: 'edge_img_b_scene3d_backdrop',
          sourceNodeId: IMAGE_B.id,
          sourcePort: 'output',
          targetNodeId: SCENE_3D_NODE.id,
          targetPort: 'backdrop',
        },
      ],
      stacks: [],
      outputNodeId: OUTPUT_NODE_ID,
    };

    expect(
      getNodeInputRenderNodes(
        [SCENE_NODE, IMAGE_A, IMAGE_B, SCENE_3D_NODE],
        'scene_3d',
        'backdrop',
        flowToScene3DBackdrop,
      ),
    ).toEqual([SCENE_NODE, IMAGE_B]);
  });

  it('renders the Scene 3D projection instead of only its backdrop branch', () => {
    const scene3DWithBackdrop = {
      ...SCENE_3D_NODE,
      detachedFromPipe: true,
      inputs: { backdrop: IMAGE_B.id },
    } as AnyNode;
    const flowToScene3DBackdrop: Flow = {
      id: 'flow_scene3d_projection',
      name: 'Scene 3D Projection',
      nodes: [SCENE_NODE, IMAGE_B, scene3DWithBackdrop, OUTPUT_NODE],
      edges: [
        {
          id: 'edge_img_b_scene3d_backdrop',
          sourceNodeId: IMAGE_B.id,
          sourcePort: 'output',
          targetNodeId: scene3DWithBackdrop.id,
          targetPort: 'backdrop',
        },
      ],
      stacks: [],
      outputNodeId: OUTPUT_NODE_ID,
    };

    expect(
      getScene3DProjectionRenderNodes(
        [SCENE_NODE, IMAGE_B, scene3DWithBackdrop],
        scene3DWithBackdrop.id,
        flowToScene3DBackdrop,
      ),
    ).toEqual([
      SCENE_NODE,
      IMAGE_B,
      expect.objectContaining({
        id: scene3DWithBackdrop.id,
        inputs: { backdrop: IMAGE_B.id },
      }),
    ]);
  });

  it('renders unconnected canonical viewer targets from an empty scene', () => {
    expect(getViewportRenderNodes(NODES, 'grade_b', FLOW_TO_IMAGE_A)).toEqual([
      SCENE_NODE,
      GRADE_B,
    ]);
  });

  it('uses output rendering when the viewport target is output', () => {
    expect(getViewportRenderNodes(NODES, OUTPUT_NODE_ID, FLOW_TO_IMAGE_A)).toEqual([
      SCENE_NODE,
      IMAGE_A,
    ]);
  });
});
