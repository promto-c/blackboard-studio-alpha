export const NodeKind = {
  SCENE: 'scene',
  OUTPUT: 'output',
  EFFECT: 'effect',
  GROUP: 'group',
} as const;

export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export const NodeType = {
  SCENE: 'scene',
  OUTPUT: 'output',
  GROUP: 'group',
  IMAGE: 'image',
  VIDEO: 'video',
  IMAGE_SEQUENCE: 'image_sequence',
  TEXT: 'text',
  MERGE: 'merge',
  GRADE: 'grade',
  BLUR: 'blur',
  CUSTOM_SHADER: 'custom_shader',
  BOKEH_BLUR: 'bokeh_blur',
  LIQUID_GLASS: 'liquid_glass',
  PIXELATE: 'pixelate',
  LENS_DISTORTION: 'lens_distortion',
  ROTO: 'roto',
  PAINT: 'paint',
  CHROMA_KEY: 'chroma_key',
  WARP: 'warp',
  COMFY: 'comfy',
  ONNX_MODEL: 'onnx_model',
} as const;

type BuiltinNodeType = (typeof NodeType)[keyof typeof NodeType];

export type NodeType = BuiltinNodeType | (string & {});

export type FlowId = string;
export type NodeId = string;
export type RelationshipId = string;

export enum BlendMode {
  OVER = 'normal',
  ADD = 'add',
  MULTIPLY = 'multiply',
  SCREEN = 'screen',
}

export enum ImageFitMode {
  FIT = 'fit',
  FILL = 'fill',
  NONE = 'none',
  STRETCH = 'stretch',
}

export type DirectoryImportMode = 'copy' | 'reference';
export type DirectoryImportModePreference = DirectoryImportMode | 'ask';

export enum EditorTab {
  Tools = 'tools',
  Flow = 'flow',
  Gallery = 'gallery',
  Chats = 'chats',
  History = 'history',
}

export interface Pan {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Keyframe {
  frame: number;
  value: number;
  inTangent?: { x: number; y: number };
  outTangent?: { x: number; y: number };
}

export type AnimatableNumber = number | Keyframe[];

export interface SelectedKeyframeRef {
  nodeId?: string;
  path: string;
  frame: number;
}

export interface RotoPointRef {
  pathId: string;
  pointIndex: number;
}

export interface Grade {
  brightness: AnimatableNumber;
  contrast: AnimatableNumber;
  saturation: AnimatableNumber;
  gain: AnimatableNumber;
  gamma: AnimatableNumber;
}

export enum BlurMethod {
  GAUSSIAN = 'gaussian',
  BOX = 'box',
}

export interface Blur {
  radius: AnimatableNumber;
  method: BlurMethod;
}

export interface ImageTransform {
  x: AnimatableNumber;
  y: AnimatableNumber;
  scaleX: AnimatableNumber;
  scaleY: AnimatableNumber;
  fitMode: ImageFitMode;
}

export interface AiVariant {
  src: string;
  prompt: string;
  createdAt?: number;
  deletedAt?: number;
  width?: number;
  height?: number;
  taskId?: string;
  status?: 'queued' | 'generating' | 'error';
  queuePosition?: number;
}

export interface AiMetadata {
  sourceNodeId?: string;
  prompt: string;
  variants: AiVariant[];
  activeVariantIndex: number;
  lastError?: string;
}

export type AiChatFeature = 'assistant' | 'shader' | (string & {});
export type AiChatRole = 'user' | 'assistant';
export type AiChatMessageStatus = 'pending' | 'complete' | 'error';
export type AiChatAttachmentKind = 'image' | 'text' | 'file';
export type AiChatBranchSource = 'original' | 'edit' | 'regenerate';
export type AiProvider = 'gemini' | 'ollama' | 'openai';

export interface AiChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AiChatAttachmentKind;
  dataUrl?: string;
  text?: string;
}

export interface AiChatShaderArtifact {
  type: 'shader';
  code: string;
  provider?: AiProvider;
  model?: string;
  suggestions?: string[];
  validationErrors?: string[];
}

export interface AiChatGradePreviewArtifact {
  type: 'grade-preview';
  values: {
    brightness: number;
    contrast: number;
    saturation: number;
  };
  summary?: string;
  provider?: 'ollama';
  model?: string;
}

export interface AiChatPromptPreviewArtifact {
  type: 'prompt-preview';
  originalPrompt: string;
  options: string[];
  draft: string;
  suggestions?: string[];
  summary?: string;
  provider?: AiProvider;
  model?: string;
  target: {
    kind: 'comfy-control';
    nodeId: NodeId;
    controlId: string;
    controlLabel: string;
    inputName: string;
  };
}

export type AiChatArtifact =
  | AiChatShaderArtifact
  | AiChatGradePreviewArtifact
  | AiChatPromptPreviewArtifact;

export interface AiChatMessage {
  id: string;
  role: AiChatRole;
  content: string;
  thinking?: string;
  isThinking?: boolean;
  createdAt: number;
  status?: AiChatMessageStatus;
  attachments?: AiChatAttachment[];
  artifact?: AiChatArtifact;
  provider?: AiProvider;
  model?: string;
  branchPointId?: string;
}

export interface AiChatBranch {
  id: string;
  label: string;
  source: AiChatBranchSource;
  parentBranchId?: string;
  createdAt: number;
  updatedAt: number;
  variantOfBranchPointIds?: string[];
  messages: AiChatMessage[];
}

export interface AiChatThread {
  id: string;
  title: string;
  feature: AiChatFeature;
  nodeId?: NodeId;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'generating' | 'error';
  messages: AiChatMessage[];
  branches?: AiChatBranch[];
  activeBranchId?: string;
  lastError?: string;
  toolState?: {
    gradePreview?: AiChatGradePreviewArtifact;
  };
}

export type InputPortType = 'texture' | 'mask' | 'data';
export type NodeInputs = Record<string, string>;

export interface BaseNode {
  id: NodeId;
  kind?: NodeKind;
  type: NodeType;
  name: string;
  visible: boolean;
  inputs?: NodeInputs;
  stacked?: boolean;
  detachedFromPipe?: boolean;
}

export interface SceneNode extends BaseNode {
  kind?: typeof NodeKind.SCENE;
  type: typeof NodeType.SCENE;
  width: number;
  height: number;
  bitDepth: 8 | 16 | 32;
  colorSpace: 'sRGB' | 'Linear';
  maxFrames: number;
  fps: number;
}

export interface OutputNode extends BaseNode {
  kind?: typeof NodeKind.OUTPUT;
  type: typeof NodeType.OUTPUT;
}

export interface GroupNode extends BaseNode {
  kind?: typeof NodeKind.GROUP;
  type: typeof NodeType.GROUP;
  childFlowId: FlowId | null;
}

export interface EffectNode extends BaseNode {
  kind?: typeof NodeKind.EFFECT;
}

export interface ImageNode extends EffectNode {
  type: typeof NodeType.IMAGE;
  src: string;
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  colorSpace: 'sRGB' | 'Linear' | 'Raw';
  aiMetadata?: AiMetadata;
}

export interface VideoNode extends EffectNode {
  type: typeof NodeType.VIDEO;
  src: string;
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  duration: number;
  loop: boolean;
}

export interface ImageSequenceNode extends EffectNode {
  type: typeof NodeType.IMAGE_SEQUENCE;
  frames: string[];
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  colorSpace: 'sRGB' | 'Linear' | 'Raw';
  fps: number;
  startFrame: number;
  loop: boolean;
}

export interface TextNode extends EffectNode {
  type: typeof NodeType.TEXT;
  text: string;
  fontFamily: string;
  fontSize: AnimatableNumber;
  color: [number, number, number];
  position: { x: AnimatableNumber; y: AnimatableNumber };
  rotation: AnimatableNumber;
  opacity: AnimatableNumber;
  operator: BlendMode;
}

export interface MergeNode extends EffectNode {
  type: typeof NodeType.MERGE;
  opacity: AnimatableNumber;
  operator: BlendMode;
}

export interface GradeNode extends EffectNode {
  type: typeof NodeType.GRADE;
  grade: Grade;
}

export interface BlurNode extends EffectNode {
  type: typeof NodeType.BLUR;
  blur: Blur;
}

export enum UniformUIType {
  SLIDER = 'slider',
  COLOR = 'color',
  TOGGLE = 'toggle',
  SEGMENTED = 'segmented',
  NUMBER = 'number',
}

export interface SliderUniform {
  label: string;
  ui: UniformUIType.SLIDER;
  value: AnimatableNumber;
  min: number;
  max: number;
  step: number;
}

export interface ColorUniform {
  label: string;
  ui: UniformUIType.COLOR;
  value: [number, number, number];
}

export interface ToggleUniform {
  label: string;
  ui: UniformUIType.TOGGLE;
  value: boolean;
}

export interface SegmentedUniformOption {
  label: string;
  value: number;
}

export interface SegmentedUniform {
  label: string;
  ui: UniformUIType.SEGMENTED;
  value: number;
  options: SegmentedUniformOption[];
}

export interface NumberUniform {
  label: string;
  ui: UniformUIType.NUMBER;
  value: number;
  step: number;
}

export type AnyUniform =
  | SliderUniform
  | ColorUniform
  | ToggleUniform
  | SegmentedUniform
  | NumberUniform;

export interface CustomShaderNode extends EffectNode {
  type: typeof NodeType.CUSTOM_SHADER;
  fragmentShader: string;
  uniforms: Record<string, AnyUniform>;
  promptSuggestionPages?: string[][];
  promptSuggestionPageIndex?: number;
  promptSuggestionsVisible?: boolean;
}

export type DepthSource = 'uniform' | 'luminance' | 'radial' | 'linear_h' | 'linear_v' | 'node';

export interface BokehBlurNode extends EffectNode {
  type: typeof NodeType.BOKEH_BLUR;
  uniforms: Record<string, AnyUniform>;
  depthSource: DepthSource;
  previewDepth?: boolean;
  depthInvert?: boolean;
}

export interface LiquidGlassNode extends EffectNode {
  type: typeof NodeType.LIQUID_GLASS;
  uniforms: Record<string, AnyUniform>;
}

export interface PixelateNode extends EffectNode {
  type: typeof NodeType.PIXELATE;
  uniforms: Record<string, AnyUniform>;
}

export interface LensDistortionNode extends EffectNode {
  type: typeof NodeType.LENS_DISTORTION;
  uniforms: Record<string, AnyUniform>;
}

export enum RotoPathBlend {
  ADD = 'add',
  SUBTRACT = 'subtract',
}

export enum RotoShapeType {
  POLYGON = 'polygon',
  BSPLINE = 'bspline',
}

export enum RotoDrawMode {
  FILL = 'fill',
  STROKE = 'stroke',
  FILL_AND_STROKE = 'fill_and_stroke',
}

export type RotoMotionCueMode = 'gradient_trail' | 'speed_heatline';
export type RotoMotionCueScope = 'selected' | 'all';
export type RotoTrackingModel = 'translation' | 'similarity' | 'affine' | 'homography';
export type RotoTrackingMatrix4 = AnimatableNumber[][];

export interface RotoTrackingTransform {
  matrix: RotoTrackingMatrix4;
  model: RotoTrackingModel;
  sourcePathIds: string[];
}

export interface RotoLayer {
  id: string;
  name: string;
  parentLayerId?: string | null;
  stackOrder?: number;
  visible?: boolean;
  expanded?: boolean;
  /**
   * Optional blend mode for all shapes in this layer.
   * When set, it is applied to shapes within the layer unless they explicitly override it.
   */
  blend?: RotoPathBlend;
  trackingTransform?: RotoTrackingTransform;
  userTransform?: RotoTrackingTransform;
  trackingData?: { [frame: number]: number };
}

export type RotoPointType = 'bspline' | 'cardinal' | 'corner';
export type RotoPointWeightMode = 'global' | 'local';

export interface RotoPath {
  id: string;
  name: string;
  parentLayerId?: string | null;
  stackOrder?: number;
  visible?: boolean;
  shapeType: RotoShapeType;
  points: { x: AnimatableNumber; y: AnimatableNumber }[];
  pointWeights?: number[];
  pointWeightModes?: (RotoPointWeightMode | null)[];
  pointTypes?: RotoPointType[];
  trackPoints?: { x: AnimatableNumber; y: AnimatableNumber }[];
  closed: boolean;
  feather: AnimatableNumber;
  opacity: AnimatableNumber;
  blend: RotoPathBlend;
  style: {
    mode: RotoDrawMode;
    strokeWidth: AnimatableNumber;
  };
  trackingTransform?: RotoTrackingTransform;
  userTransform?: RotoTrackingTransform;
  originalPoints?: { x: number; y: number }[];
  epsilon?: number;
  trackingData?: { [frame: number]: number };
}

export interface RotoMotionBlurSettings {
  enabled: boolean;
  shutter: number;
  samples: number;
  phase?: RotoMotionBlurPhase;
}

export type RotoMotionBlurPhase = 'start' | 'centered' | 'end';

export interface RotoNode extends EffectNode {
  type: typeof NodeType.ROTO;
  paths: RotoPath[];
  layers?: RotoLayer[];
  invert: boolean;
  motionBlur?: RotoMotionBlurSettings;
}

export type PaintTool = 'brush' | 'erase' | 'clone';
export type PaintViewportTool = PaintTool | 'select' | 'nudge';
export type PaintStrokeChannels = 'rgb' | 'r' | 'g' | 'b' | 'a';
export type PaintBrushChannels = PaintStrokeChannels | 'view';

export interface PaintBrushSettings {
  size: number;
  softness: number;
  opacity: number;
  color: [number, number, number];
  alpha: number;
  channels: PaintBrushChannels;
}

export type PaintLifetimeMode = 'all' | 'single' | 'range';

export type PaintLifetime =
  | {
      mode: 'all';
    }
  | {
      mode: 'single';
      frame: number;
    }
  | {
      mode: 'range';
      startFrame: number;
      endFrame: number;
    };

export type PaintLifetimePresetMode = 'all' | 'current_frame' | 'range';

export type PaintLifetimePreset =
  | {
      mode: 'all';
    }
  | {
      mode: 'current_frame';
    }
  | {
      mode: 'range';
      startFrame: number;
      endFrame: number;
    };

export interface PaintLayer {
  id: string;
  name: string;
  parentLayerId?: string | null;
  stackOrder?: number;
  visible?: boolean;
  expanded?: boolean;
  lifetime?: PaintLifetime | null;
}

export type PaintStrokeCurveMode = 'polyline' | 'bspline';

export type PaintStrokePathsMode = 'all' | 'selected_layer';

export interface PaintStrokePath {
  mode: PaintStrokeCurveMode;
  points: Point[];
}

export interface PaintStroke {
  id: string;
  name: string;
  tool: PaintTool;
  visible: boolean;
  raster: string;
  path?: PaintStrokePath | null;
  pointCount: number;
  size: number;
  softness: number;
  opacity: number;
  color?: [number, number, number];
  alpha?: number;
  channels?: PaintStrokeChannels;
  parentLayerId?: string | null;
  stackOrder?: number;
  cloneOffset?: Point | null;
  lifetime?: PaintLifetime | null;
}

export interface PaintNode extends EffectNode {
  type: typeof NodeType.PAINT;
  strokes: PaintStroke[];
  layers?: PaintLayer[];
  defaultLifetime?: PaintLifetimePreset | null;
}

export interface ChromaKeyNode extends EffectNode {
  type: typeof NodeType.CHROMA_KEY;
  uniforms: Record<string, AnyUniform>;
}

export interface WarpPin {
  id: string;
  position: { x: number; y: number };
  translation: { x: AnimatableNumber; y: AnimatableNumber };
}

export interface WarpNode extends EffectNode {
  type: typeof NodeType.WARP;
  pins: WarpPin[];
  radius: AnimatableNumber;
  strength: AnimatableNumber;
}

export interface ComfyWorkflow {
  id: string;
  name: string;
  prompt: Record<string, unknown>;
  sourceGraph?: Record<string, unknown>;
  inputCandidates?: ComfyWorkflowInputCandidate[];
  controlOptions?: ComfyWorkflowControlOptions[];
  outputCandidates?: ComfyWorkflowOutputCandidate[];
  selectedOutputIds?: string[];
  createdAt: number;
  updatedAt?: number;
}

export interface ComfyWorkflowControlOptions {
  nodeId: string;
  inputName: string;
  options: Array<string | number>;
}

export interface ComfyWorkflowInputCandidate {
  id: string;
  nodeId: string;
  nodeType: string;
  inputName: string;
  label: string;
}

export interface ComfyWorkflowOutputCandidate {
  id: string;
  nodeId: string;
  nodeType: string;
  kind: 'existing' | 'synthetic';
  outputIndex: number;
  outputName: string;
  label: string;
  promptLink?: [string, number];
  previewNodeId: string;
}

export type ComfyWorkflowControlValue = string | number | boolean;
export type ComfyWorkflowControlRunMode = 'fixed' | 'randomize' | 'increment' | 'randomRange';

export interface ComfyWorkflowControl {
  id: string;
  workflowId: string;
  nodeId: string;
  classType?: string;
  inputName: string;
  label: string;
  description?: string;
  value: ComfyWorkflowControlValue;
  defaultValue: ComfyWorkflowControlValue;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<string | number>;
  runMode?: ComfyWorkflowControlRunMode;
  randomMin?: number;
  randomMax?: number;
  incrementStep?: number;
  promptSuggestionPages?: string[][];
  promptSuggestionPageIndex?: number;
  promptSuggestionsVisible?: boolean;
}

export interface GeneratedOutput {
  id: string;
  src: string;
  width: number;
  height: number;
  createdAt: number;
  deletedAt?: number;
  label?: string;
  prompt?: string;
  promptId?: string;
  workflowId?: string;
  workflowName?: string;
}

export interface ComfyWorkflowInputImage {
  assetId: string;
  name: string;
  type?: string;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface ComfyNode extends EffectNode {
  type: typeof NodeType.COMFY;
  workflows: ComfyWorkflow[];
  selectedWorkflowId?: string;
  workflowControls?: ComfyWorkflowControl[];
  workflowInputImages?: Record<string, ComfyWorkflowInputImage>;
  generatedOutputs?: GeneratedOutput[];
  activeGeneratedOutputId?: string;
  src: string;
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  colorSpace: 'sRGB' | 'Linear' | 'Raw';
  lastPromptId?: string;
  lastRunAt?: number;
  lastError?: string;
}

export type OnnxBackend = 'webgpu' | 'wasm';
export type OnnxPrecision =
  | 'fp16'
  | 'fp32'
  | 'fp64'
  | 'bfloat16'
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'quantized'
  | 'q4'
  | 'q4f16'
  | 'q2'
  | 'unknown';
export type OnnxModelScale = 'small' | 'base' | 'large' | 'unknown';
export type OnnxModelTask = 'depth-estimation' | 'inpainting' | 'generic';
export type OnnxNormalization = 'imagenet' | 'zeroToOne' | 'none';

export interface OnnxInputMetadata {
  name: string;
  type: string;
  dims: number[];
  isDynamic: boolean;
  dimsLabel: string;
  kind: 'image' | 'scalar';
  defaultValue?: number | string | boolean;
}

export interface OnnxOutputMetadata {
  name: string;
  type: string;
  dims: number[];
  isDynamic: boolean;
  dimsLabel: string;
  kind: 'image' | 'scalar';
}

export interface OnnxNodeOutput {
  id: string;
  name: string;
  outputIndex: number;
  src: string;
  width: number;
  height: number;
  createdAt: number;
  kind: 'image' | 'scalar';
  scalarValue?: number;
  dims: number[];
  type: string;
}

export interface OnnxModelExternalData {
  path: string;
  cacheKey: string;
  sizeBytes?: number;
}

export interface OnnxModelVariantMetadata {
  id: string;
  repoName: string;
  filePath: string;
  label: string;
  sizeBytes?: number;
  precision?: OnnxPrecision;
  scale?: OnnxModelScale;
  supportedBackends: OnnxBackend[];
  inputShape?: number[];
  outputShape?: number[];
  preprocessing?: string;
  postprocessing?: string;
  externalDataFiles?: { path: string; size?: number }[];
  inputMetadata?: OnnxInputMetadata[];
  outputMetadata?: OnnxOutputMetadata[];
  metadataError?: string;
}

export interface InstalledOnnxModel {
  id: string;
  recipeId: string;
  name: string;
  repoName: string;
  variant: OnnxModelVariantMetadata;
  cacheKey: string;
  installedAt: number;
  sizeBytes?: number;
  externalData?: OnnxModelExternalData[];
}

export type OnnxChannelMode = 'RGB' | 'R' | 'G' | 'B' | 'A' | 'Luminance';

export interface OnnxModelNode extends EffectNode {
  type: typeof NodeType.ONNX_MODEL;
  modelId?: string;
  modelName?: string;
  modelRepo?: string;
  variantId?: string;
  variantLabel?: string;
  backend: OnnxBackend;
  inputSize: { width: number; height: number };
  task: OnnxModelTask;
  inputChannelModes?: Record<string, OnnxChannelMode>;
  inputValues?: Record<string, number | string | boolean>;
  outputs?: OnnxNodeOutput[];
  activeOutputId?: string;
  src: string;
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  colorSpace: 'sRGB' | 'Linear' | 'Raw';
  lastRunAt?: number;
  lastError?: string;
}

export type AnyEffectNode =
  | ImageNode
  | VideoNode
  | ImageSequenceNode
  | TextNode
  | MergeNode
  | GradeNode
  | BlurNode
  | CustomShaderNode
  | BokehBlurNode
  | LiquidGlassNode
  | PixelateNode
  | LensDistortionNode
  | RotoNode
  | PaintNode
  | ChromaKeyNode
  | WarpNode
  | ComfyNode
  | OnnxModelNode;

export type AnyNode = SceneNode | OutputNode | GroupNode | AnyEffectNode;

export interface FlowConnection {
  id: RelationshipId;
  kind: 'connection';
  sourceNodeId: NodeId;
  sourcePort: 'output';
  targetNodeId: NodeId;
  targetPort: string;
}

export interface FlowStackRelationship {
  id: RelationshipId;
  kind: 'stack';
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
}

export type FlowRelationship = FlowConnection | FlowStackRelationship;

export interface Flow {
  id: FlowId;
  name: string;
  nodes: AnyNode[];
  nodeOrder: NodeId[];
  relationships: FlowRelationship[];
}

export interface ViewerSettings {
  channels: 'RGB' | 'R' | 'G' | 'B' | 'A';
  alphaOverlay: boolean;
  alphaMode: 'STRAIGHT' | 'TRANSPARENT' | 'FILL_BLACK' | 'FILL_WHITE';
  showOverlays: boolean;
  ocioView: string;
  gain: number;
  gamma: number;
  saturation: number;
  lastCustomGain: number;
  lastCustomGamma: number;
  lastCustomSaturation: number;
}

export const VIEWER_SLOTS = [1, 2, 3, 4] as const;
export type ViewerSlot = (typeof VIEWER_SLOTS)[number];
export type ViewerSlotAssignments = Partial<Record<ViewerSlot, NodeId>>;

export interface RenderSettings {
  exportMode?: 'single' | 'sequence';
  filename: string;
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  quality: number;
  outputColorSpace: 'scene_linear' | 'srgb' | 'match_viewport';
  includeAlpha: boolean;
  sequenceFilenamePattern?: string;
  sequenceStartFrame?: number;
  sequenceEndFrame?: number;
  sequencePadding?: number;
}

export interface CacheStatus {
  memoryUsed: number;
  memoryLimit: number;
  cachedFrames: boolean[];
  cachingFrames: boolean[];
}

export interface RotoRefinement {
  name: string;
  originalPoints: { x: number; y: number }[];
  epsilon: number;
  closed: boolean;
  popupPosition?: { left: number; top: number };
  targetPathId?: string;
}

export interface TransformData {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  matrix?: number[][];
  /** Separate pure-translation matrix for keyframe point delta (full scope).
   *  Applied after component reduction so it acts like a viewport pan
   *  and does not disturb the perspective decomposition. */
  auxiliaryTranslation?: number[][];
}

export interface TrackingConfig {
  translation: boolean;
  rotation: boolean;
  scale: boolean;
  affine: boolean;
  perspective: boolean;
  deform: boolean;
  driftTolerance?: number;
}

export interface StabilizationConfig {
  translation: boolean;
  rotation: boolean;
  scale: boolean;
  affine: boolean;
  perspective: boolean;
  scope: StabilizationScope;
}

export type StabilizationScope = 'target' | 'composite' | 'parent' | 'full';

export interface AiGenerationTaskInput {
  nodeId?: string;
  prompt: string;
  isTextToImage?: boolean;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  maskedImageBase64?: string;
  outputWidth?: number;
  outputHeight?: number;
}

export interface QueuedAiGenerationTask extends AiGenerationTaskInput {
  taskId: string;
}

export type NodePositions = Record<string, { x: number; y: number }>;

export type EditorStateSlice = Partial<{
  projectId: string | null;
  flows: Record<FlowId, Flow>;
  rootFlowId: FlowId | null;
  activeFlowId: FlowId | null;
  nodes: AnyNode[];
  selectedNodeId: NodeId | null;
  selectedPaintLayerIds: string[];
  selectedPaintStrokeIds: string[];
  selectedRotoLayerIds: string[];
  selectedRotoPathIds: string[];
  selectedRotoPointRefs: RotoPointRef[];
  selectedKeyframes: SelectedKeyframeRef[];
  activeTab: EditorTab;
  aiChats: AiChatThread[];
  activeAiChatId: string | null;
  zoom: number;
  pan: Pan;
  history: HistoryEntry[];
  historyIndex: number;
  viewerNodeId: NodeId | null;
  viewerSlots: ViewerSlotAssignments;
  activeViewerSlot: ViewerSlot | null;
  viewerSettings: ViewerSettings;
  renderSettings: RenderSettings;
  isPlaying: boolean;
  currentFrame: number;
  fps: number;
  rotoRefinement: RotoRefinement | null;
  isStabilized: boolean;
  stabilizationReference: TransformData | null;
  stabilizationReferenceFrame: number | null;
  stabilizationConfig: StabilizationConfig;
  nodePositionsByFlow: Record<FlowId, NodePositions>;
  nodePositions: NodePositions;
}>;

export interface HistoryEntry {
  id: string;
  label: string;
  state: EditorStateSlice;
  createdAt?: number;
  checkpointLabel?: string;
  consolidatedCount?: number;
}

export interface ProjectIndexEntry {
  id: string;
  name: string;
  lastModified: number;
  thumbnail?: string;
  thumbnailAssetId?: string;
  estimatedSize?: number;
  schemaVersion?: number;
}

export interface FlowValidationIssue {
  code:
    | 'missing_scene'
    | 'missing_output'
    | 'multiple_scene'
    | 'multiple_output'
    | 'duplicate_node_id'
    | 'invalid_node_order'
    | 'invalid_relationship_reference'
    | 'invalid_stack_target'
    | 'connection_cycle';
  message: string;
}

export const isFlowConnection = (relationship: FlowRelationship): relationship is FlowConnection =>
  relationship.kind === 'connection';

export const isFlowStackRelationship = (
  relationship: FlowRelationship,
): relationship is FlowStackRelationship => relationship.kind === 'stack';

const hasFlowConnectionCycle = (
  nodeIds: Iterable<NodeId>,
  relationships: FlowRelationship[],
): boolean => {
  const adjacency = new Map<string, string[]>();
  for (const relationship of relationships) {
    if (!isFlowConnection(relationship)) {
      continue;
    }

    if (!adjacency.has(relationship.sourceNodeId)) {
      adjacency.set(relationship.sourceNodeId, []);
    }

    adjacency.get(relationship.sourceNodeId)!.push(relationship.targetNodeId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const hasCycle = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }

    visiting.add(nodeId);
    const nextNodeIds = adjacency.get(nodeId) ?? [];
    for (const nextNodeId of nextNodeIds) {
      if (hasCycle(nextNodeId)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  for (const nodeId of nodeIds) {
    if (hasCycle(nodeId)) {
      return true;
    }
  }

  return false;
};

const BUILTIN_SOURCE_NODE_TYPES = new Set<string>([
  NodeType.IMAGE,
  NodeType.VIDEO,
  NodeType.IMAGE_SEQUENCE,
  NodeType.TEXT,
  NodeType.COMFY,
  NodeType.ONNX_MODEL,
]);

const getBuiltinMergeSourceNodeIds = (flow: Flow): Set<string> => {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const mergeSourceNodeIds = new Set<string>();
  let sourceCount = 0;

  for (const nodeId of flow.nodeOrder) {
    const node = nodesById.get(nodeId);
    if (!node || node.detachedFromPipe || !BUILTIN_SOURCE_NODE_TYPES.has(node.type)) {
      continue;
    }

    if (sourceCount > 0) {
      mergeSourceNodeIds.add(node.id);
    }
    sourceCount += 1;
  }

  return mergeSourceNodeIds;
};

export const removeCycleCreatingFlowConnections = (flow: Flow): Flow => {
  const nodeIds = flow.nodes.map((node) => node.id);
  const mergeSourceNodeIds = getBuiltinMergeSourceNodeIds(flow);
  const baseRelationships = flow.relationships.filter(
    (relationship) =>
      !isFlowConnection(relationship) ||
      (relationship.targetPort === 'pipe' &&
        !mergeSourceNodeIds.has(relationship.sourceNodeId) &&
        !mergeSourceNodeIds.has(relationship.targetNodeId)),
  );
  const explicitConnections = flow.relationships.filter(
    (relationship): relationship is FlowConnection =>
      isFlowConnection(relationship) && relationship.targetPort !== 'pipe',
  );
  const removedRelationshipIds = new Set(
    flow.relationships
      .filter(
        (relationship) =>
          isFlowConnection(relationship) &&
          relationship.targetPort === 'pipe' &&
          (mergeSourceNodeIds.has(relationship.sourceNodeId) ||
            mergeSourceNodeIds.has(relationship.targetNodeId)),
      )
      .map((relationship) => relationship.id),
  );

  if (hasFlowConnectionCycle(nodeIds, baseRelationships)) {
    return flow;
  }

  const keptExplicitConnections: FlowConnection[] = [];

  for (const relationship of explicitConnections) {
    const nextRelationships = [...baseRelationships, ...keptExplicitConnections, relationship];

    if (hasFlowConnectionCycle(nodeIds, nextRelationships)) {
      removedRelationshipIds.add(relationship.id);
      continue;
    }

    keptExplicitConnections.push(relationship);
  }

  if (removedRelationshipIds.size === 0) {
    return flow;
  }

  return {
    ...flow,
    relationships: flow.relationships.filter(
      (relationship) => !removedRelationshipIds.has(relationship.id),
    ),
  };
};

export const validateRootFlow = (flow: Flow): FlowValidationIssue[] => {
  const issues: FlowValidationIssue[] = [];
  const nodesById = new Map<string, AnyNode>();
  const nodeIds = new Set<string>();

  for (const node of flow.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        code: 'duplicate_node_id',
        message: `Duplicate node id "${node.id}".`,
      });
      continue;
    }

    nodeIds.add(node.id);
    nodesById.set(node.id, node);
  }

  const sceneNodes = flow.nodes.filter((node) => node.kind === NodeKind.SCENE);
  const outputNodes = flow.nodes.filter((node) => node.kind === NodeKind.OUTPUT);

  if (sceneNodes.length === 0) {
    issues.push({
      code: 'missing_scene',
      message: 'Root flow must contain exactly one scene node.',
    });
  } else if (sceneNodes.length > 1) {
    issues.push({
      code: 'multiple_scene',
      message: 'Root flow contains multiple scene nodes.',
    });
  }

  if (outputNodes.length === 0) {
    issues.push({
      code: 'missing_output',
      message: 'Root flow must contain exactly one output node.',
    });
  } else if (outputNodes.length > 1) {
    issues.push({
      code: 'multiple_output',
      message: 'Root flow contains multiple output nodes.',
    });
  }

  const orderSet = new Set(flow.nodeOrder);
  if (orderSet.size !== flow.nodeOrder.length || flow.nodeOrder.length !== flow.nodes.length) {
    issues.push({
      code: 'invalid_node_order',
      message: 'Flow nodeOrder must contain each node exactly once.',
    });
  } else if (flow.nodes.some((node) => !orderSet.has(node.id))) {
    issues.push({
      code: 'invalid_node_order',
      message: 'Flow nodeOrder does not match node ids.',
    });
  }

  for (const relationship of flow.relationships) {
    if (!nodesById.has(relationship.sourceNodeId) || !nodesById.has(relationship.targetNodeId)) {
      issues.push({
        code: 'invalid_relationship_reference',
        message: `Relationship "${relationship.id}" references missing nodes.`,
      });
      continue;
    }

    if (isFlowStackRelationship(relationship)) {
      const sourceNode = nodesById.get(relationship.sourceNodeId)!;
      const targetNode = nodesById.get(relationship.targetNodeId)!;
      if (sourceNode.kind !== NodeKind.EFFECT || targetNode.kind !== NodeKind.EFFECT) {
        issues.push({
          code: 'invalid_stack_target',
          message: `Stack relationship "${relationship.id}" must connect effect nodes only.`,
        });
      }
    }
  }

  if (hasFlowConnectionCycle(nodeIds, flow.relationships)) {
    issues.push({
      code: 'connection_cycle',
      message: 'Flow connections must not contain cycles.',
    });
  }

  return issues;
};
