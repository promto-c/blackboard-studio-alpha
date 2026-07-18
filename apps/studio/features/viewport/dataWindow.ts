import {
  getValueAtFrame,
  type RendererDataWindowPlan,
  type RendererNodeDataWindow,
  type RenderWindowRect,
} from '@blackboard/renderer';
import type {
  AnimatableNumber,
  AnyNode,
  ComfyNode,
  GeneratedOutput,
  ImageTransform,
  SceneNode,
  SpatialTransform,
} from '@blackboard/types';
import { NodeType } from '@blackboard/types';
import { isFiniteNumber, hasPositiveSize } from '@/utils/guards';
import {
  getComfyGeneratedOutputTextureKey,
  getVisibleComfyGeneratedOutputs,
} from '@/nodes/ai/comfy/comfyOutputLayers';
import { getComfyOutputTransform } from '@/nodes/ai/comfy/comfyOutputTransform';

export interface SourceDataWindowNode {
  width: number;
  height: number;
  transform: ImageTransform;
  useOutputSizeAsScene?: boolean;
}

export interface CropDataWindowNode {
  crop: {
    left: AnimatableNumber;
    right: AnimatableNumber;
    top: AnimatableNumber;
    bottom: AnimatableNumber;
  };
}

export interface TransformDataWindowNode {
  transform: SpatialTransform;
}

export type DataWindowNode = SourceDataWindowNode | CropDataWindowNode | TransformDataWindowNode;

export interface DataWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Size of the data window before the selected node's bbox operation. */
  nativeWidth: number;
  nativeHeight: number;
}

export interface DataWindowProjection extends RendererDataWindowPlan {
  inputs: Map<string, DataWindowRect>;
  outputs: Map<string, DataWindowRect>;
  /** Nodes that explicitly create, combine, or spatially modify their output data window. */
  handledDataWindowNodeIds: Set<string>;
}

type Bounds = Pick<DataWindowRect, 'x' | 'y' | 'width' | 'height'>;

const toRect = (bounds: Bounds, native: Bounds): DataWindowRect => ({
  x: bounds.x,
  y: bounds.y,
  width: Math.max(0, bounds.width),
  height: Math.max(0, bounds.height),
  nativeWidth: Math.max(0, native.width),
  nativeHeight: Math.max(0, native.height),
});

const fullDisplayWindow = (displayWindow: Pick<SceneNode, 'width' | 'height'>): DataWindowRect =>
  toRect(
    { x: 0, y: 0, width: displayWindow.width, height: displayWindow.height },
    { x: 0, y: 0, width: displayWindow.width, height: displayWindow.height },
  );

const emptyDataWindow = (): DataWindowRect =>
  toRect({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 });

const getWindowKey = (window: Pick<SceneNode, 'width' | 'height'>): string =>
  `${window.width}x${window.height}`;

const getCenteredStorageWindow = (
  displayWindow: Pick<SceneNode, 'width' | 'height'>,
  bounds: Bounds,
): RenderWindowRect => {
  const horizontalPadding = Math.max(
    0,
    Math.ceil(-bounds.x),
    Math.ceil(bounds.x + bounds.width - displayWindow.width),
  );
  const verticalPadding = Math.max(
    0,
    Math.ceil(-bounds.y),
    Math.ceil(bounds.y + bounds.height - displayWindow.height),
  );
  return {
    x: horizontalPadding === 0 ? 0 : -horizontalPadding,
    y: verticalPadding === 0 ? 0 : -verticalPadding,
    width: displayWindow.width + horizontalPadding * 2,
    height: displayWindow.height + verticalPadding * 2,
  };
};

const normalizeBounds = (bounds: Bounds): Bounds => {
  const x = bounds.width < 0 ? bounds.x + bounds.width : bounds.x;
  const y = bounds.height < 0 ? bounds.y + bounds.height : bounds.y;
  return {
    x,
    y,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
};

const unionBounds = (left: Bounds | null, right: Bounds | null): Bounds | null => {
  if (!left) return right;
  if (!right) return left;
  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const intersectBounds = (left: Bounds, right: Bounds): Bounds => {
  const minX = Math.max(left.x, right.x);
  const minY = Math.max(left.y, right.y);
  const maxX = Math.min(left.x + left.width, right.x + right.width);
  const maxY = Math.min(left.y + left.height, right.y + right.height);
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};

const isSourceDataWindowNode = (node: unknown): node is SourceDataWindowNode => {
  if (!hasPositiveSize(node) || !('transform' in node)) return false;
  const transform = (node as { transform?: unknown }).transform as
    | Partial<ImageTransform>
    | undefined;
  return (
    !!transform &&
    (isFiniteNumber(transform.x) || Array.isArray(transform.x)) &&
    (isFiniteNumber(transform.y) || Array.isArray(transform.y)) &&
    (isFiniteNumber(transform.scaleX) || Array.isArray(transform.scaleX)) &&
    (isFiniteNumber(transform.scaleY) || Array.isArray(transform.scaleY))
  );
};

const isCropDataWindowNode = (node: DataWindowNode | AnyNode): node is CropDataWindowNode =>
  'crop' in node;

const isTransformDataWindowNode = (
  node: DataWindowNode | AnyNode,
): node is TransformDataWindowNode =>
  'transform' in node &&
  typeof node.transform === 'object' &&
  node.transform !== null &&
  'translateX' in node.transform &&
  'translateY' in node.transform &&
  'rotation' in node.transform;

const isReformatDataWindowNode = (
  node: AnyNode,
): node is AnyNode & {
  width: number;
  height: number;
  resizeMode?: 'fill' | 'fit' | 'none' | 'stretch';
  sourceWidth?: number;
  sourceHeight?: number;
} => node.type === NodeType.REFORMAT && hasPositiveSize(node);

const isComfyDataWindowNode = (node: AnyNode): node is ComfyNode => node.type === NodeType.COMFY;

const clampToRange = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const rotatePoint = (x: number, y: number, radians: number): { x: number; y: number } => {
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return {
    x: cos * x - sin * y,
    y: sin * x + cos * y,
  };
};

const transformBounds = (
  displayWindow: Pick<SceneNode, 'width' | 'height'>,
  input: Bounds,
  transform: SpatialTransform,
  frame: number,
): Bounds => {
  const translateX = getValueAtFrame(transform.translateX, frame);
  const translateY = getValueAtFrame(transform.translateY, frame);
  const scaleX = getValueAtFrame(transform.scaleX, frame);
  const scaleY = getValueAtFrame(transform.scaleY, frame);
  const rotation = (getValueAtFrame(transform.rotation, frame) * Math.PI) / 180;
  const pivotX = getValueAtFrame(transform.pivotX, frame);
  const pivotY = getValueAtFrame(transform.pivotY, frame);
  const halfWidth = displayWindow.width / 2;
  const halfHeight = displayWindow.height / 2;
  const left = input.x - halfWidth;
  const right = input.x + input.width - halfWidth;
  const top = input.y - halfHeight;
  const bottom = input.y + input.height - halfHeight;
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ].map((corner) => {
    const scaledX = (corner.x - pivotX) * scaleX;
    const scaledY = (corner.y + pivotY) * scaleY;
    const rotated = rotatePoint(scaledX, scaledY, rotation);
    return {
      x: rotated.x + translateX + pivotX,
      y: rotated.y - translateY - pivotY,
    };
  });
  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const maxY = Math.max(...corners.map((corner) => corner.y));

  return {
    x: halfWidth + minX,
    y: halfHeight + minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const getSourceDataWindowRect = (
  displayWindow: Pick<SceneNode, 'width' | 'height'>,
  node: SourceDataWindowNode,
  frame: number,
): DataWindowRect => {
  const useNativeOutputWindow = node.useOutputSizeAsScene === true;
  const scaleXAtFrame = useNativeOutputWindow ? 1 : getValueAtFrame(node.transform.scaleX, frame);
  const scaleYAtFrame = useNativeOutputWindow ? 1 : getValueAtFrame(node.transform.scaleY, frame);
  const xAtFrame = useNativeOutputWindow ? 0 : getValueAtFrame(node.transform.x, frame);
  const yAtFrame = useNativeOutputWindow ? 0 : getValueAtFrame(node.transform.y, frame);
  const width = node.width * scaleXAtFrame;
  const height = node.height * scaleYAtFrame;
  const x = displayWindow.width / 2 + xAtFrame - width / 2;
  const y = displayWindow.height / 2 - yAtFrame - height / 2;

  return toRect(normalizeBounds({ x, y, width, height }), {
    x: 0,
    y: 0,
    width: node.width,
    height: node.height,
  });
};

const hasRenderableComfyOutput = (output: GeneratedOutput, frame: number): boolean =>
  hasPositiveSize(output) && getComfyGeneratedOutputTextureKey(output, frame) !== null;

const getComfyDataWindowRect = (
  displayWindow: Pick<SceneNode, 'width' | 'height'>,
  node: ComfyNode,
  frame: number,
): DataWindowRect | null => {
  const activeOutputRects = getVisibleComfyGeneratedOutputs(node)
    .filter((output) => hasRenderableComfyOutput(output, frame))
    .map((output) =>
      getSourceDataWindowRect(
        displayWindow,
        {
          width: output.width,
          height: output.height,
          transform: getComfyOutputTransform({ node, output, sceneNode: displayWindow }),
          useOutputSizeAsScene: output.useOutputSizeAsScene,
        },
        frame,
      ),
    );

  if (activeOutputRects.length === 0) return null;

  const bounds = activeOutputRects.reduce<Bounds | null>(
    (currentBounds, rect) => unionBounds(currentBounds, rect),
    null,
  );

  return bounds ? toRect(bounds, bounds) : null;
};

const getCropDataWindowRect = (
  displayWindow: Pick<SceneNode, 'width' | 'height'>,
  cropNode: CropDataWindowNode,
  frame: number,
  input = fullDisplayWindow(displayWindow),
): DataWindowRect => {
  const left = clampToRange(getValueAtFrame(cropNode.crop.left, frame), 0, displayWindow.width);
  const right = clampToRange(getValueAtFrame(cropNode.crop.right, frame), 0, displayWindow.width);
  const top = clampToRange(getValueAtFrame(cropNode.crop.top, frame), 0, displayWindow.height);
  const bottom = clampToRange(
    getValueAtFrame(cropNode.crop.bottom, frame),
    0,
    displayWindow.height,
  );
  const cropWindow = {
    x: left,
    y: top,
    width: Math.max(0, displayWindow.width - left - right),
    height: Math.max(0, displayWindow.height - top - bottom),
  };

  return toRect(intersectBounds(input, cropWindow), input);
};

const getTransformDataWindowRect = (
  displayWindow: Pick<SceneNode, 'width' | 'height'>,
  transformNode: TransformDataWindowNode,
  frame: number,
  input = fullDisplayWindow(displayWindow),
): DataWindowRect =>
  toRect(transformBounds(displayWindow, input, transformNode.transform, frame), input);

const getReformatDataWindowRect = (
  displayWindow: Pick<SceneNode, 'width' | 'height'>,
  node: AnyNode & {
    width: number;
    height: number;
    resizeMode?: 'fill' | 'fit' | 'none' | 'stretch';
    sourceWidth?: number;
    sourceHeight?: number;
  },
  input: DataWindowRect,
): DataWindowRect => {
  const sourceWidth = node.sourceWidth ?? displayWindow.width;
  const sourceHeight = node.sourceHeight ?? displayWindow.height;
  const targetWidth = node.width;
  const targetHeight = node.height;

  if (node.resizeMode === 'stretch') {
    return toRect(
      {
        x: (input.x / sourceWidth) * targetWidth,
        y: (input.y / sourceHeight) * targetHeight,
        width: (input.width / sourceWidth) * targetWidth,
        height: (input.height / sourceHeight) * targetHeight,
      },
      input,
    );
  }

  const scale =
    node.resizeMode === 'fill'
      ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : node.resizeMode === 'none'
        ? 1
        : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const x = targetWidth / 2 + (input.x - sourceWidth / 2) * scale;
  const y = targetHeight / 2 + (input.y - sourceHeight / 2) * scale;

  return toRect({ x, y, width: input.width * scale, height: input.height * scale }, input);
};

export const getDataWindowRect = (
  sceneNode: Pick<SceneNode, 'width' | 'height'>,
  node: DataWindowNode,
  frame: number,
): DataWindowRect => {
  if (isCropDataWindowNode(node)) {
    return getCropDataWindowRect(sceneNode, node, frame);
  }

  if (isTransformDataWindowNode(node)) {
    return getTransformDataWindowRect(sceneNode, node, frame);
  }

  return getSourceDataWindowRect(sceneNode, node, frame);
};

const getExplicitPipeInput = (
  node: AnyNode,
  outputs: Map<string, DataWindowRect>,
): DataWindowRect | null => {
  const pipeInputId = node.inputs?.pipe;
  return pipeInputId ? (outputs.get(pipeInputId) ?? null) : null;
};

const getInitialDisplayWindow = (
  sceneNode: Pick<SceneNode, 'width' | 'height'>,
  nodes: AnyNode[],
): Pick<SceneNode, 'width' | 'height'> => {
  const firstReformat = nodes.find(
    (node) =>
      node.enabled !== false &&
      node.type === NodeType.REFORMAT &&
      isFiniteNumber((node as { sourceWidth?: unknown }).sourceWidth) &&
      isFiniteNumber((node as { sourceHeight?: unknown }).sourceHeight),
  ) as { sourceWidth: number; sourceHeight: number } | undefined;

  return firstReformat
    ? { width: firstReformat.sourceWidth, height: firstReformat.sourceHeight }
    : sceneNode;
};

export const getDataWindowProjection = (
  sceneNode: Pick<SceneNode, 'width' | 'height'>,
  nodes: AnyNode[],
  frame: number,
): DataWindowProjection => {
  const inputs = new Map<string, DataWindowRect>();
  const outputs = new Map<string, DataWindowRect>();
  const handledDataWindowNodeIds = new Set<string>();
  const initialDisplayWindow = getInitialDisplayWindow(sceneNode, nodes);
  let displayWindow = initialDisplayWindow;
  const provisionalNodeWindows = new Map<
    string,
    Omit<RendererNodeDataWindow, 'inputStorageWindow' | 'outputStorageWindow'>
  >();

  for (const node of nodes) {
    if (node.enabled === false || node.type === NodeType.SCENE || node.type === NodeType.OUTPUT) {
      continue;
    }

    const explicitPipeInput = getExplicitPipeInput(node, outputs);
    const input = explicitPipeInput ?? emptyDataWindow();
    const inputDisplayWindow = { ...displayWindow };
    inputs.set(node.id, input);

    let output: DataWindowRect;
    let handlesDataWindow = false;
    if (isComfyDataWindowNode(node)) {
      handlesDataWindow = true;
      const comfyRect = getComfyDataWindowRect(displayWindow, node, frame);
      if (comfyRect) {
        const compositedBounds = unionBounds(explicitPipeInput, comfyRect) ?? comfyRect;
        output = toRect(compositedBounds, comfyRect);
      } else if (
        (node.generatedOutputs ?? []).some((generatedOutput) => !generatedOutput.deletedAt)
      ) {
        output = input;
      } else if (isSourceDataWindowNode(node)) {
        const sourceRect = getSourceDataWindowRect(displayWindow, node, frame);
        const compositedBounds = unionBounds(explicitPipeInput, sourceRect) ?? sourceRect;
        output = toRect(compositedBounds, sourceRect);
      } else {
        output = input;
      }
    } else if (isSourceDataWindowNode(node)) {
      handlesDataWindow = true;
      const sourceRect = getSourceDataWindowRect(displayWindow, node, frame);
      const compositedBounds = unionBounds(explicitPipeInput, sourceRect) ?? sourceRect;
      output = toRect(compositedBounds, sourceRect);
    } else if (isCropDataWindowNode(node)) {
      handlesDataWindow = true;
      output = getCropDataWindowRect(displayWindow, node, frame, input);
    } else if (isTransformDataWindowNode(node)) {
      handlesDataWindow = true;
      output = getTransformDataWindowRect(displayWindow, node, frame, input);
    } else if (isReformatDataWindowNode(node)) {
      handlesDataWindow = true;
      output = getReformatDataWindowRect(displayWindow, node, input);
      displayWindow = { width: node.width, height: node.height };
    } else if (
      node.type === NodeType.MERGE ||
      node.type === NodeType.MASKED_MERGE ||
      node.type === NodeType.MERGE_CHANNELS
    ) {
      handlesDataWindow = true;
      const connectedBounds = Object.values(node.inputs ?? {}).reduce<Bounds | null>(
        (bounds, inputNodeId) => unionBounds(bounds, outputs.get(inputNodeId) ?? null),
        null,
      );
      const mergedBounds = unionBounds(input, connectedBounds) ?? input;
      output = toRect(mergedBounds, mergedBounds);
    } else {
      output = input;
    }

    outputs.set(node.id, output);
    if (handlesDataWindow) handledDataWindowNodeIds.add(node.id);
    provisionalNodeWindows.set(node.id, {
      inputDisplayWindow,
      outputDisplayWindow: { ...displayWindow },
      inputDataWindow: input,
      outputDataWindow: output,
    });
  }

  const segmentBounds = new Map<string, Bounds>();
  const includeSegmentBounds = (window: Pick<SceneNode, 'width' | 'height'>, bounds: Bounds) => {
    const key = getWindowKey(window);
    const displayBounds = { x: 0, y: 0, width: window.width, height: window.height };
    const renderableBounds = bounds.width > 0 && bounds.height > 0 ? bounds : null;
    segmentBounds.set(
      key,
      unionBounds(unionBounds(segmentBounds.get(key) ?? null, displayBounds), renderableBounds) ??
        displayBounds,
    );
  };

  provisionalNodeWindows.forEach((window) => {
    includeSegmentBounds(window.inputDisplayWindow, window.inputDataWindow);
    includeSegmentBounds(window.outputDisplayWindow, window.outputDataWindow);
  });

  const storageWindows = new Map<string, RenderWindowRect>();
  provisionalNodeWindows.forEach((window) => {
    for (const display of [window.inputDisplayWindow, window.outputDisplayWindow]) {
      const key = getWindowKey(display);
      if (!storageWindows.has(key)) {
        const bounds = segmentBounds.get(key) ?? {
          x: 0,
          y: 0,
          width: display.width,
          height: display.height,
        };
        storageWindows.set(key, getCenteredStorageWindow(display, bounds));
      }
    }
  });

  const nodeWindows = new Map<string, RendererNodeDataWindow>();
  provisionalNodeWindows.forEach((window, nodeId) => {
    nodeWindows.set(nodeId, {
      ...window,
      inputStorageWindow:
        storageWindows.get(getWindowKey(window.inputDisplayWindow)) ??
        getCenteredStorageWindow(window.inputDisplayWindow, window.inputDataWindow),
      outputStorageWindow:
        storageWindows.get(getWindowKey(window.outputDisplayWindow)) ??
        getCenteredStorageWindow(window.outputDisplayWindow, window.outputDataWindow),
    });
  });

  const storageWindow =
    storageWindows.get(getWindowKey(displayWindow)) ??
    getCenteredStorageWindow(displayWindow, fullDisplayWindow(displayWindow));

  return {
    inputs,
    outputs,
    handledDataWindowNodeIds,
    nodeWindows,
    initialDisplayWindow,
    displayWindow,
    storageWindow,
  };
};
