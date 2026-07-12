export const NodeKind = {
  SCENE: 'scene',
  OUTPUT: 'output',
  EFFECT: 'effect',
  GROUP: 'group',
  INPUT: 'input',
} as const;

export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export const NodeType = {
  SCENE: 'scene',
  SCENE_3D: 'scene_3d',
  OUTPUT: 'output',
  GROUP: 'group',
  INPUT: 'input',
  MEDIA_SOURCE: 'media_source',
  IMAGE_SEQUENCE: 'image_sequence',
  TEXT: 'text',
  MERGE: 'merge',
  EXTRACT_CHANNELS: 'extract_channels',
  MERGE_CHANNELS: 'merge_channels',
  GRADE: 'grade',
  BLUR: 'blur',
  REFORMAT: 'reformat',
  TRANSFORM: 'transform',
  CROP: 'crop',
  CUSTOM_SHADER: 'custom_shader',
  BOKEH_BLUR: 'bokeh_blur',
  LIQUID_GLASS: 'liquid_glass',
  PIXELATE: 'pixelate',
  LENS_DISTORTION: 'lens_distortion',
  MATCH_MOVE: 'match_move',
  ROTO: 'roto',
  PAINT: 'paint',
  KEYER: 'keyer',
  WARP: 'warp',
  COMFY: 'comfy',
  ONNX_MODEL: 'onnx_model',
  OCIO_COLOR_SPACE: 'ocio_color_space',
  OCIO_NAMED_TRANSFORM: 'ocio_named_transform',
  OCIO_FILE_TRANSFORM: 'ocio_file_transform',
  OCIO_LOOK_TRANSFORM: 'ocio_look_transform',
  NOTE: 'note',
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
  CUSTOM = 'custom',
}

export type DirectoryImportMode = 'copy' | 'reference';
export type DirectoryImportModePreference = DirectoryImportMode | 'ask';

export enum EditorTab {
  Tools = 'tools',
  Flow = 'flow',
  Props = 'props',
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

export type GradeProcessingDomain = 'scene_linear' | 'log';
export type GradeOutOfGamutMode = 'preserve' | 'clamp_negative';

export interface GradeRgbControl {
  r: AnimatableNumber;
  g: AnimatableNumber;
  b: AnimatableNumber;
}

export interface GradeCdl {
  slope: GradeRgbControl;
  offset: GradeRgbControl;
  power: GradeRgbControl;
  saturation: AnimatableNumber;
}

export interface Grade {
  processingDomain: GradeProcessingDomain;
  outOfGamut: GradeOutOfGamutMode;
  exposure: AnimatableNumber;
  contrast: AnimatableNumber;
  contrastPivot: AnimatableNumber;
  saturation: AnimatableNumber;
  lift: GradeRgbControl;
  gamma: GradeRgbControl;
  gain: GradeRgbControl;
  cdl: GradeCdl;
}

export enum BlurMethod {
  GAUSSIAN = 'gaussian',
  BOX = 'box',
  ITERATED_BOX = 'iterated_box',
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

export type SceneViewportMode = 'canvas2d' | 'scene3d';

export type Scene3DItemType =
  | 'output_plane'
  | 'camera'
  | 'light'
  | 'box'
  | 'model'
  | 'splat'
  | 'empty';
export type Scene3DAssetKind = 'mesh' | 'splat';
export type Scene3DMeshAssetFormat = 'glb' | 'gltf' | 'fbx' | 'obj' | 'usdz' | 'stl' | 'ply';
export type Scene3DSplatAssetFormat = 'ply' | 'spz' | 'splat' | 'ksplat' | 'sog' | 'rad';
export type Scene3DAssetFormat = Scene3DMeshAssetFormat | Scene3DSplatAssetFormat;

export interface Scene3DVector3 {
  x: number;
  y: number;
  z: number;
}

export interface Scene3DItemTransform {
  position: Scene3DVector3;
  rotation: Scene3DVector3;
  scale: Scene3DVector3;
}

export interface Scene3DAssetReference {
  assetId: string;
  fileName: string;
  kind: Scene3DAssetKind;
  format: Scene3DAssetFormat;
  mimeType?: string;
  size?: number;
}

export interface Scene3DItem {
  id: string;
  name: string;
  type: Scene3DItemType;
  visible: boolean;
  locked?: boolean;
  transform: Scene3DItemTransform;
  size?: Scene3DVector3;
  color?: string;
  intensity?: number;
  asset?: Scene3DAssetReference;
}

export interface Scene3DCameraSettings {
  position: Scene3DVector3;
  target: Scene3DVector3;
  fov: number;
  near: number;
  far: number;
}

export interface Scene3DWorldSettings {
  pixelScale: number;
  environmentColor: string;
  environmentGroundColor: string;
  environmentIntensity: number;
  gridEnabled: boolean;
  gridSize: number;
  gridDivisions: number;
  showAxes: boolean;
  showOutputPlane: boolean;
}

export interface Scene3DSettings {
  bounds: Scene3DVector3;
  camera: Scene3DCameraSettings;
  world: Scene3DWorldSettings;
  items: Scene3DItem[];
}

export type AiChatFeature = 'assistant' | 'shader' | 'agent' | (string & {});
export type AiChatRole = 'user' | 'assistant';
export type AiChatMessageStatus = 'pending' | 'complete' | 'error';
export type AiChatAttachmentKind = 'image' | 'text' | 'file';
export type AiChatBranchSource = 'original' | 'edit' | 'regenerate';
export type AiProvider = 'ollama' | 'openai';
export type AiAgentSandboxMode = 'project-branch' | 'snapshot';
export type AiAgentAmbiguityFallbackAction = 'use-recommended' | 'pause';
export type AiAgentRunStatus =
  | 'triaging'
  | 'asking'
  | 'planning'
  | 'running'
  | 'waiting-for-user'
  | 'delegating'
  | 'reviewing'
  | 'ready'
  | 'merged'
  | 'applied'
  | 'discarded'
  | 'failed';
export type AiAgentRunStepStatus = 'pending' | 'running' | 'complete' | 'blocked' | 'skipped';
export type AiAgentRunStepKind = 'plan' | 'tool' | 'question' | 'delegation' | 'review' | 'handoff';
export type AiAgentRunWorkingOwnerType = 'agent' | 'user' | 'mixed';
export type AiAgentRunUserAccess = 'read-only' | 'review' | 'editor';
export type AiAgentRunPlanMode = 'none' | 'implicit' | 'explicit';
export type AiAgentRunRecommendedNextAction =
  | 'apply'
  | 'merge'
  | 'cherry-pick'
  | 'discard'
  | 'continue'
  | 'manual-review';

export interface AiAgentQuestionChoice {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AiAgentQuestion {
  id: string;
  prompt: string;
  choices?: AiAgentQuestionChoice[];
  freeformAllowed?: boolean;
  required: boolean;
  blocks: 'none' | 'planning' | 'implementation' | 'merge';
  answeredChoiceId?: string;
  answerText?: string;
  answeredAt?: number;
}

export interface AiAgentReviewFinding {
  id: string;
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  description?: string;
  recommendation?: string;
}

export interface AiAgentDelegation {
  id: string;
  assignee: string;
  task: string;
  status: 'assigned' | 'complete' | 'blocked';
  result?: string;
}

export interface AiAgentModeSettings {
  enabled: boolean;
  sandboxMode: AiAgentSandboxMode;
  planMode: 'auto' | 'always';
  reviewRender: boolean;
  selfReview: boolean;
  maxSubagentSpawns?: number;
  allowNodeCreation: boolean;
  allowInteractiveNodeEditing: boolean;
  reusableToolSurface: 'mcp-or-app-tool';
  ambiguity: {
    askUser: boolean;
    fallbackAction: AiAgentAmbiguityFallbackAction;
    fallbackTimeoutMs?: number;
  };
}

export interface AiAgentRunStep {
  id: string;
  title: string;
  kind?: AiAgentRunStepKind;
  status: AiAgentRunStepStatus;
  agentGenerated?: boolean;
  needsUserInput?: boolean;
  toolCallIds?: string[];
  reviewAssetIds?: string[];
  questions?: AiAgentQuestion[];
  reviewFindings?: AiAgentReviewFinding[];
  delegation?: AiAgentDelegation;
}

export interface AiAgentRun {
  id: string;
  title: string;
  prompt: string;
  projectId?: string;
  sourceChatId?: string;
  branchId?: string;
  settings: AiAgentModeSettings;
  status: AiAgentRunStatus;
  workingOwnerType?: AiAgentRunWorkingOwnerType;
  workingOwnerId?: string;
  userAccess?: AiAgentRunUserAccess;
  planMode?: AiAgentRunPlanMode;
  recommendedNextAction?: AiAgentRunRecommendedNextAction;
  steps: AiAgentRunStep[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

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
    exposure: number;
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

export interface AiChatAgentPlanArtifact {
  type: 'agent-plan';
  taskTitle: string;
  steps: AiAgentRunStep[];
  sandboxMode: AiAgentSandboxMode;
  agentRunId?: string;
  branchId?: string;
  renderPreviewAssetId?: string;
  summary?: string;
  provider?: AiProvider;
  model?: string;
}

export interface AiChatRenderPreviewArtifact {
  type: 'render-preview';
  dataUrl: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  frame: number;
  flowId?: FlowId;
  branchId?: string;
  nodeId?: NodeId;
  nodeName?: string;
  summary?: string;
  capturedAt: number;
}

export type AiChatRenderPreviewImage = Omit<AiChatRenderPreviewArtifact, 'type' | 'capturedAt'>;

export interface AiChatRenderComparisonArtifact {
  type: 'render-comparison';
  before: AiChatRenderPreviewImage;
  after: AiChatRenderPreviewImage;
  parentBranchId?: string;
  branchId?: string;
  summary?: string;
  capturedAt: number;
}

export type AiChatArtifact =
  | AiChatShaderArtifact
  | AiChatGradePreviewArtifact
  | AiChatPromptPreviewArtifact
  | AiChatAgentPlanArtifact
  | AiChatRenderPreviewArtifact
  | AiChatRenderComparisonArtifact;

export interface AiChatMessage {
  id: string;
  role: AiChatRole;
  content: string;
  thinking?: string;
  isThinking?: boolean;
  streamStage?: 'connecting' | 'streaming' | 'tool' | 'complete';
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

export type DataChannelSemantic =
  | 'alpha'
  | 'mask'
  | 'depth'
  | 'normal'
  | 'motion_vector'
  | 'uv'
  | 'position'
  | 'id'
  | 'cryptomatte'
  | 'material_property';

export type RenderOutputDomain =
  | { kind: 'color' }
  | {
      kind: 'data';
      sourceNodeId: NodeId;
      sourcePort: string;
      semantic?: DataChannelSemantic;
    };

export type ColorProcessingDomain =
  | 'scene_linear'
  | 'display_referred'
  | 'log'
  | 'data'
  | 'alpha'
  | 'vector'
  | 'depth';

export interface RenderSceneSize {
  width: number;
  height: number;
}

export interface RenderSceneSizeBehavior<TNode, TContext> {
  getInputSize?: (node: TNode, fallback: RenderSceneSize) => RenderSceneSize | null | undefined;
  getOutputSize?: (node: TNode, context: TContext) => RenderSceneSize | null | undefined;
}

export type GeneratedColorResolver<TNode, TContext> = (
  node: TNode,
  context: TContext,
) => readonly [number, number, number] | null | undefined;

export type InputPortType = 'texture' | 'mask' | 'data';
export type NodeInputs = Record<string, string>;
export type NodeInputSourcePorts = Record<string, string>;
export type SourceAlphaMode = 'file' | 'opaque' | 'transparent';
export type OcioColorSpaceName = string;
export type OcioSceneColorSpace = string;
export const OCIO_PROJECT_WORKING_SPACE = '$project_working' as const;
export const OCIO_TEXTURE_COLOR_SPACE = '$texture_paint' as const;
export const OCIO_COMPOSITING_LOG_SPACE = '$compositing_log' as const;
export type OcioTransformColorSpace =
  | OcioColorSpaceName
  | typeof OCIO_PROJECT_WORKING_SPACE
  | typeof OCIO_TEXTURE_COLOR_SPACE
  | typeof OCIO_COMPOSITING_LOG_SPACE;
export type OcioTransformDirection = 'forward' | 'inverse';
export type OcioFileTransformInterpolation =
  | 'default'
  | 'nearest'
  | 'linear'
  | 'tetrahedral'
  | 'best';

export const PROJECT_COLOR_MANAGEMENT_SCHEMA_VERSION = 1 as const;

export type RequiredOcioRole = 'scene_linear' | 'texture_paint' | 'color_picking' | 'data';

export type BuiltinColorConfigReference = {
  kind: 'builtin';
  id: string;
  uri: string;
};

export type ExternalColorConfigReference = {
  kind: 'external';
  uri: string;
};

export type ColorConfigReference = BuiltinColorConfigReference | ExternalColorConfigReference;

export type MediaColorAssignmentSource =
  | 'user'
  | 'pipeline'
  | 'decoder'
  | 'metadata'
  | 'file_rule'
  | 'path_convention'
  | 'project_default'
  | 'unassigned';

export type AutomaticMediaColorAssignmentSource = Extract<
  MediaColorAssignmentSource,
  'decoder' | 'metadata' | 'file_rule' | 'path_convention' | 'project_default' | 'unassigned'
>;

export interface MediaColorAssignmentSnapshot {
  sourceColorSpace: OcioColorSpaceName | null;
  assignmentSource: AutomaticMediaColorAssignmentSource;
  isData: boolean;
  detail?: string;
  ruleName?: string;
  isDefaultRule?: boolean;
}

export interface MediaColorAssignmentEvidenceCandidate {
  sourceColorSpace: OcioColorSpaceName;
  assignmentSource: Exclude<AutomaticMediaColorAssignmentSource, 'unassigned'>;
  isData: boolean;
  detail?: string;
  ruleName?: string;
  isDefaultRule?: boolean;
}

export interface MediaColorAssignmentEvidence {
  automatic: MediaColorAssignmentSnapshot;
  candidates: MediaColorAssignmentEvidenceCandidate[];
}

export interface MediaColorManagement {
  sourceColorSpace: OcioColorSpaceName | null;
  assignmentSource: MediaColorAssignmentSource;
  isData: boolean;
  evidence?: MediaColorAssignmentEvidence;
}

export type VideoColorPrimaries = 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020' | 'display-p3';

export type VideoTransferCharacteristics = 'bt709' | 'smpte170m' | 'srgb' | 'linear' | 'pq' | 'hlg';

export type VideoMatrixCoefficients =
  | 'rgb'
  | 'bt709'
  | 'bt470bg'
  | 'smpte170m'
  | 'bt2020-ncl'
  | 'bt2020-cl';

export type VideoColorRange = 'full' | 'limited';
export type VideoColorMetadataSource = 'container' | 'decoder' | 'unavailable';

export interface VideoColorMetadata {
  primaries: VideoColorPrimaries | null;
  transfer: VideoTransferCharacteristics | null;
  matrix: VideoMatrixCoefficients | null;
  range: VideoColorRange | null;
  source: VideoColorMetadataSource;
}

export interface DisplayViewSelection {
  display: string;
  view: string;
  look?: string;
}

export type DisplayOutputSelection =
  | { kind: 'project_view' }
  | { kind: 'current_viewer' }
  | { kind: 'display_view'; displayView: DisplayViewSelection }
  | { kind: 'direct_encoding'; colorSpace: OcioColorSpaceName };

export interface ProjectColorManagement {
  schemaVersion: typeof PROJECT_COLOR_MANAGEMENT_SCHEMA_VERSION;
  config: ColorConfigReference;
  workingSpace: {
    role: 'scene_linear';
    override?: OcioSceneColorSpace;
  };
  viewer: DisplayViewSelection;
  roleOverrides?: Partial<Record<RequiredOcioRole, OcioColorSpaceName>>;
  context?: Record<string, string>;
}

export interface BaseNode {
  id: NodeId;
  kind?: NodeKind;
  type: NodeType;
  name: string;
  enabled: boolean;
  inputs?: NodeInputs;
  inputSourcePorts?: NodeInputSourcePorts;
  stacked?: boolean;
  detachedFromPipe?: boolean;
}

export interface SceneNode extends BaseNode {
  kind?: typeof NodeKind.SCENE;
  type: typeof NodeType.SCENE;
  width: number;
  height: number;
  bitDepth: 8 | 16 | 32;
  colorSpace: OcioSceneColorSpace;
  maxFrames: number;
  fps: number;
}

export interface OutputNode extends BaseNode {
  kind?: typeof NodeKind.OUTPUT;
  type: typeof NodeType.OUTPUT;
  technicalChannels?: OutputTechnicalChannel[];
}

export interface OutputTechnicalChannel {
  id: string;
  name: string;
  semantic?: DataChannelSemantic;
}

export interface GroupExternalInput {
  id: string;
  label: string;
  entryNodeId: NodeId;
  targetNodeId: NodeId;
  targetPort: string;
}

export interface GroupNode extends BaseNode {
  kind?: typeof NodeKind.GROUP;
  type: typeof NodeType.GROUP;
  childFlowId: FlowId | null;
  inputNodeId?: NodeId | null;
  outputNodeId?: NodeId | null;
  externalInputs?: GroupExternalInput[];
}

export interface InputNode extends BaseNode {
  kind?: typeof NodeKind.INPUT;
  type: typeof NodeType.INPUT;
  groupNodeId?: NodeId | null;
  externalInputId?: string | null;
}

export interface EffectNode extends BaseNode {
  kind?: typeof NodeKind.EFFECT;
}

/** Behavior used when a temporal source is sampled outside its available range. */
export type SourceRangeBehavior = 'hold' | 'loop' | 'bounce' | 'black';

/** Shared timeline placement and range-extension settings for temporal media. */
export interface TemporalSourceSettings {
  /** Timeline frame on which the source's first frame is available. */
  startFrame?: number;
  /** Sampling behavior before the first available source frame. */
  beforeRangeBehavior?: SourceRangeBehavior;
  /** Sampling behavior after the last available source frame. */
  afterRangeBehavior?: SourceRangeBehavior;
}

export interface MediaSourceNode extends EffectNode, TemporalSourceSettings {
  type: typeof NodeType.MEDIA_SOURCE;
  src: string;
  sourceFileName?: string;
  mediaKind: 'image' | 'video';
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  colorSpace?: OcioColorSpaceName;
  mediaColorManagement?: MediaColorManagement;
  videoColorMetadata?: VideoColorMetadata;
  sourceAlphaMode?: SourceAlphaMode;
  useOutputSizeAsScene?: boolean;
  duration?: number;
  /** Number of decodable video frames at the project frame rate. */
  frameCount?: number;
}

export interface ImageSequenceNode extends EffectNode, TemporalSourceSettings {
  type: typeof NodeType.IMAGE_SEQUENCE;
  frames: string[];
  sourceFileName?: string;
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  colorSpace: OcioColorSpaceName;
  mediaColorManagement?: MediaColorManagement;
  sourceAlphaMode?: SourceAlphaMode;
  useOutputSizeAsScene?: boolean;
  fps: number;
  startFrame: number;
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

export interface Scene3DNode extends EffectNode {
  type: typeof NodeType.SCENE_3D;
  viewportMode: SceneViewportMode;
  scene3d: Scene3DSettings;
}

export interface ExtractChannelsNode extends EffectNode {
  type: typeof NodeType.EXTRACT_CHANNELS;
}

export interface MergeChannelsNode extends EffectNode {
  type: typeof NodeType.MERGE_CHANNELS;
}

export interface GradeNode extends EffectNode {
  type: typeof NodeType.GRADE;
  grade: Grade;
}

export interface BlurNode extends EffectNode {
  type: typeof NodeType.BLUR;
  blur: Blur;
}

export interface OcioColorSpaceTransformNode extends EffectNode {
  type: typeof NodeType.OCIO_COLOR_SPACE;
  sourceColorSpace: OcioTransformColorSpace;
  destinationColorSpace: OcioTransformColorSpace;
}

export interface OcioNamedTransformNode extends EffectNode {
  type: typeof NodeType.OCIO_NAMED_TRANSFORM;
  namedTransform: string;
  direction: OcioTransformDirection;
  processColorSpace: OcioTransformColorSpace;
}

export interface OcioFileTransformNode extends EffectNode {
  type: typeof NodeType.OCIO_FILE_TRANSFORM;
  assetId: string | null;
  fileName: string | null;
  fileSize?: number;
  direction: OcioTransformDirection;
  interpolation: OcioFileTransformInterpolation;
  inputColorSpace: OcioTransformColorSpace;
  outputColorSpace: OcioTransformColorSpace;
  cccId?: string;
}

export interface OcioLookTransformNode extends EffectNode {
  type: typeof NodeType.OCIO_LOOK_TRANSFORM;
  looks: string;
  direction: OcioTransformDirection;
}

export type ReformatResizeMode = 'fill' | 'fit' | 'none' | 'stretch';
export type SpatialResamplingFilter = 'nearest' | 'linear' | 'cubic' | 'lanczos';

export interface ReformatNode extends EffectNode {
  type: typeof NodeType.REFORMAT;
  width: number;
  height: number;
  resizeMode: ReformatResizeMode;
  resampling?: SpatialResamplingFilter;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface SpatialTransform {
  translateX: AnimatableNumber;
  translateY: AnimatableNumber;
  scaleX: AnimatableNumber;
  scaleY: AnimatableNumber;
  rotation: AnimatableNumber;
  pivotX: AnimatableNumber;
  pivotY: AnimatableNumber;
}

export interface TransformNode extends EffectNode {
  type: typeof NodeType.TRANSFORM;
  transform: SpatialTransform;
  resampling?: SpatialResamplingFilter;
}

export interface Crop {
  left: AnimatableNumber;
  right: AnimatableNumber;
  top: AnimatableNumber;
  bottom: AnimatableNumber;
}

export interface CropNode extends EffectNode {
  type: typeof NodeType.CROP;
  crop: Crop;
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
export type RotoTrackingModel =
  | 'translation'
  | 'similarity'
  | 'affine'
  | 'homography'
  | 'independent_scale';
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

export enum RotoAlphaMode {
  MULTIPLY = 'multiply',
  REPLACE = 'replace',
  ADD = 'add',
}

export interface RotoNode extends EffectNode {
  type: typeof NodeType.ROTO;
  paths: RotoPath[];
  layers?: RotoLayer[];
  invert: boolean;
  alphaMode?: RotoAlphaMode;
  motionBlur?: RotoMotionBlurSettings;
}

export type PaintTool = 'brush' | 'erase' | 'clone';
export type PaintViewportTool = PaintTool | 'select' | 'nudge';
export type PaintStrokeChannels = 'rgb' | 'r' | 'g' | 'b' | 'a';
export type PaintBrushChannels = PaintStrokeChannels | 'view';

export interface PaintBrushSettings {
  size: number;
  spacing: number;
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
  spacing: number;
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

export interface KeyerNode extends EffectNode {
  type: typeof NodeType.KEYER;
  uniforms: Record<string, AnyUniform>;
  matteOverlayWhileAdjusting: boolean;
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

export type MatchMoveMode = 'track_2d' | 'planar' | 'camera_3d';
export type MatchMoveSolveModel = 'translation' | 'similarity' | 'affine' | 'homography';
export type MatchMoveTrackStatus = 'tracked' | 'failed' | 'manual';
export type MatchMoveSolveStatus = 'idle' | 'running' | 'solved' | 'partial' | 'failed';
export type MatchMoveCameraSolveStatus = 'not_started' | 'tracks_ready' | 'needs_solver';
export type MatchMoveLensDistortionModel = 'none' | 'brown_conrady';

export interface MatchMoveTrackingSettings {
  sourceId: string;
  startFrame: number;
  endFrame: number;
  maxFeatures: number;
  minFeatureDistance: number;
  featureQuality: number;
  patchSize: number;
  maxTrackError: number;
}

export interface MatchMoveSolveSettings {
  mode: MatchMoveMode;
  model: MatchMoveSolveModel;
  ransacThreshold: number;
  minTrackFrames: number;
}

export interface MatchMoveCameraSettings {
  focalLengthMm: number;
  sensorWidthMm: number;
  principalPoint: Point;
  lensDistortionModel: MatchMoveLensDistortionModel;
  surveyScale: number;
}

export interface MatchMoveTrackSample {
  frame: number;
  x: number;
  y: number;
  error?: number;
  status: MatchMoveTrackStatus;
}

export interface MatchMoveTrack {
  id: string;
  name: string;
  color: string;
  reference: Point;
  samples: MatchMoveTrackSample[];
}

export interface MatchMoveSolveFrame {
  frame: number;
  model: MatchMoveSolveModel;
  matrix: number[][];
  translate: Point;
  scale: Point;
  rotation: number;
  residual: number;
  inliers: number;
  tracked: number;
}

export interface MatchMoveCameraSolveSummary {
  status: MatchMoveCameraSolveStatus;
  message?: string;
  focalLengthPx?: number;
  trackCount: number;
  solvedFrameCount: number;
}

export interface MatchMoveSolveResult {
  status: MatchMoveSolveStatus;
  message?: string;
  solvedAt?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  startFrame: number;
  endFrame: number;
  model: MatchMoveSolveModel;
  averageResidual?: number;
  frames: MatchMoveSolveFrame[];
  camera?: MatchMoveCameraSolveSummary;
}

export interface MatchMoveDisplaySettings {
  showFeatures: boolean;
  showTrails: boolean;
  trailLength: number;
  colorByError: boolean;
}

export interface MatchMoveNode extends EffectNode {
  type: typeof NodeType.MATCH_MOVE;
  tracking: MatchMoveTrackingSettings;
  solve: MatchMoveSolveSettings;
  camera: MatchMoveCameraSettings;
  tracks: MatchMoveTrack[];
  solveResult?: MatchMoveSolveResult;
  display: MatchMoveDisplaySettings;
}

export interface ComfyWorkflow {
  id: string;
  name: string;
  prompt: Record<string, unknown>;
  sourceGraph?: Record<string, unknown>;
  inputCandidates?: ComfyWorkflowInputCandidate[];
  selectedInputIds?: string[];
  controlOptions?: ComfyWorkflowControlOptions[];
  defaultControlKeys?: string[];
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

export type ComfyWorkflowControlValue = string | number | boolean;

export type ComfyWorkflowCandidateScope = 'top_level' | 'internal';

export interface ComfyWorkflowDynamicInputField {
  inputName: string;
  dottedInputName: string;
  defaultValue?: ComfyWorkflowControlValue;
  options?: Array<string | number>;
}

export interface ComfyWorkflowDynamicInputOption {
  parentInputName: string;
  optionKey: string | number;
  fields: ComfyWorkflowDynamicInputField[];
}

export interface ComfyWorkflowInputCandidate {
  id: string;
  nodeId: string;
  nodeType: string;
  inputName: string;
  label: string;
  scope?: ComfyWorkflowCandidateScope;
  promptTargets?: Array<{ nodeId: string; inputName: string }>;
}

export interface ComfyWorkflowSyntheticOutputNode {
  id: string;
  nodeType: string;
  inputs: Record<string, unknown>;
}

export interface ComfyWorkflowOutputCandidate {
  id: string;
  nodeId: string;
  nodeType: string;
  kind: 'existing' | 'synthetic';
  outputIndex: number;
  outputName: string;
  outputType?: string;
  label: string;
  scope?: ComfyWorkflowCandidateScope;
  promptLink?: [string, number];
  previewNodeId: string;
  outputNodeInputs?: Record<string, unknown>;
  outputNodeDynamicInputs?: ComfyWorkflowDynamicInputOption[];
  syntheticOutputNodes?: ComfyWorkflowSyntheticOutputNode[];
  syntheticOutputFormat?: 'preview' | 'exr_float' | 'model_3d';
}

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
  mediaKind?: 'image' | 'image_sequence' | 'video' | 'model_3d';
  scene3dAsset?: Scene3DAssetReference;
  colorSpace?: OcioColorSpaceName;
  mediaColorManagement?: MediaColorManagement;
  videoColorMetadata?: VideoColorMetadata;
  frames?: string[];
  width: number;
  height: number;
  duration?: number;
  fps?: number;
  createdAt: number;
  deletedAt?: number;
  visible?: boolean;
  stackOrder?: number;
  label?: string;
  prompt?: string;
  promptId?: string;
  generationGroupId?: string;
  workflowId?: string;
  workflowName?: string;
  regionId?: string;
  regionLabel?: string;
  regionRect?: { x: number; y: number; width: number; height: number };
  transform?: ImageTransform;
  useOutputSizeAsScene?: boolean;
  differenceMask?: GeneratedOutputDifferenceMask;
}

/** Input/output difference matte applied as non-destructive generated-output alpha. */
export interface GeneratedOutputDifferenceMask {
  enabled: boolean;
  referenceAssetId: string;
  referenceWidth: number;
  referenceHeight: number;
  referenceTransform?: Pick<ImageTransform, 'x' | 'y' | 'scaleX' | 'scaleY'>;
  /** Difference below this normalized value is transparent. */
  thresholdLow: number;
  /** Difference at or above this normalized value is fully opaque. */
  thresholdHigh: number;
  /** Signed scene-pixel edge adjustment. Negative contracts; positive expands. */
  edgeAdjustment: number;
  /** Scene-pixel neighborhood used to reject isolated mask islands. */
  removeSpecks: number;
  /** Scene-pixel neighborhood used to close small holes in mask coverage. */
  fillHoles: number;
  invert?: boolean;
  /** Viewport-only inspection mode. Export always uses the composited result. */
  previewMode?: 'result' | 'overlay' | 'matte';
}

export interface ComfyWorkflowInputImage {
  assetId: string;
  name: string;
  type?: string;
  width?: number;
  height?: number;
  createdAt: number;
}

export type ComfyViewportBindingField =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'prompt'
  | 'image'
  | 'mask';

export interface ComfyWorkflowFieldTarget {
  kind: 'workflowField' | 'workflowInput';
  nodeId?: string;
  inputName?: string;
  classType?: string;
  inputCandidateId?: string;
  label: string;
}

export interface FieldBinding {
  id: string;
  field: ComfyViewportBindingField;
  target?: ComfyWorkflowFieldTarget;
}

export interface ViewportPromptRegion {
  id: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visible?: boolean;
  expanded?: boolean;
  stackOrder?: number;
  prompt: string;
  bindings: FieldBinding[];
  promptSuggestionPages?: string[][];
  promptSuggestionPageIndex?: number;
  promptSuggestionsVisible?: boolean;
  regionInputAlphaMode?: 'opaque' | 'preserve';
}

export interface ViewportPromptRegionDefaults {
  prompt?: string;
  bindings?: FieldBinding[];
  /**
   * How to handle the alpha channel when rendering region input for Comfy.
   * - `'opaque'` (default): alpha is set to fully opaque (ignored).
   * - `'preserve'`: alpha from the app's rendered output is preserved.
   */
  regionInputAlphaMode?: 'opaque' | 'preserve';
}

export interface ComfyNode extends EffectNode {
  type: typeof NodeType.COMFY;
  workflows: ComfyWorkflow[];
  selectedWorkflowId?: string;
  workflowControls?: ComfyWorkflowControl[];
  workflowInputImages?: Record<string, ComfyWorkflowInputImage>;
  viewportPromptRegions?: ViewportPromptRegion[];
  viewportPromptRegionDefaults?: ViewportPromptRegionDefaults;
  rootBindings?: FieldBinding[];
  selectedViewportPromptRegionId?: string;
  generatedOutputs?: GeneratedOutput[];
  activeGeneratedOutputId?: string;
  src: string;
  mediaKind?: 'image' | 'image_sequence' | 'video';
  frames?: string[];
  duration?: number;
  fps?: number;
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  colorSpace: OcioColorSpaceName;
  mediaColorManagement?: MediaColorManagement;
  videoColorMetadata?: VideoColorMetadata;
  useOutputSizeAsScene?: boolean;
  hiddenInputPortIds?: string[];
  autoAlignOutputs?: boolean;
  alignmentOptions?: {
    skipEditedRegions?: boolean;
    iterativeRefinement?: boolean;
    highResRefinement?: boolean;
    edgeAwareSampling?: boolean;
    subPixelRefinement?: boolean;
  };
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
export type OnnxModelTask = 'generic';
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
  name: string;
  repoName: string;
  variant: OnnxModelVariantMetadata;
  cacheKey: string;
  installedAt: number;
  sizeBytes?: number;
  externalData?: OnnxModelExternalData[];
}

export type OnnxChannelMode = 'RGB' | 'R' | 'G' | 'B' | 'A' | 'Luminance';

export type OnnxResultBehavior = 'static' | 'frame_sequence';

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
  /** Per-input normalization override. Keyed by input name. */
  inputNormalizationOverrides?: Record<string, OnnxNormalization>;
  /** Per-output normalization override. Keyed by output name. */
  outputNormalizationOverrides?: Record<string, OnnxNormalization>;
  inputValues?: Record<string, number | string | boolean>;
  outputs?: OnnxNodeOutput[];
  activeOutputId?: string;
  resultBehavior?: OnnxResultBehavior;
  frames?: string[];
  /**
   * Per-frame asset srcs keyed by output name.
   * In sequence mode, stores each output's frame-specific srcs so that
   * selecting a different output shows the correct per-frame data.
   */
  outputFrameSrcs?: Record<string, string[]>;
  startFrame?: number;
  src: string;
  width: number;
  height: number;
  opacity: AnimatableNumber;
  operator: BlendMode;
  transform: ImageTransform;
  colorSpace: OcioColorSpaceName;
  mediaColorManagement?: MediaColorManagement;
  useOutputSizeAsScene?: boolean;
  lastRunAt?: number;
  lastError?: string;
}

export type NoteColor = 'theme' | 'teal' | 'slate' | 'amber' | 'rose' | 'violet';

export interface NoteNode extends EffectNode {
  type: typeof NodeType.NOTE;
  content: string;
  color: NoteColor;
}

export type AnyEffectNode =
  | MediaSourceNode
  | ImageSequenceNode
  | TextNode
  | MergeNode
  | Scene3DNode
  | ExtractChannelsNode
  | MergeChannelsNode
  | GradeNode
  | BlurNode
  | ReformatNode
  | TransformNode
  | CropNode
  | CustomShaderNode
  | BokehBlurNode
  | LiquidGlassNode
  | PixelateNode
  | LensDistortionNode
  | RotoNode
  | PaintNode
  | KeyerNode
  | WarpNode
  | MatchMoveNode
  | ComfyNode
  | OnnxModelNode
  | OcioColorSpaceTransformNode
  | OcioNamedTransformNode
  | OcioFileTransformNode
  | OcioLookTransformNode
  | NoteNode;

export type AnyNode = SceneNode | OutputNode | GroupNode | InputNode | AnyEffectNode;

export interface FlowEdge {
  id: RelationshipId;
  sourceNodeId: NodeId;
  sourcePort: string;
  targetNodeId: NodeId;
  targetPort: string;
}

export interface FlowStack {
  id: RelationshipId;
  rootNodeId: NodeId;
  nodeIds: NodeId[];
}

export interface Flow {
  id: FlowId;
  name: string;
  nodes: AnyNode[];
  edges: FlowEdge[];
  stacks: FlowStack[];
  outputNodeId: NodeId;
}

export interface ViewerSettings {
  channels: 'RGB' | 'R' | 'G' | 'B' | 'A';
  alphaOverlay: boolean;
  gamutWarning: boolean;
  showOverlays: boolean;
  gain: number;
  gamma: number;
  saturation: number;
  lastCustomGain: number;
  lastCustomGamma: number;
  lastCustomSaturation: number;
}

export type OpenExrOutputPresetId = 'acescg_half' | 'aces2065_1_float';

export const VIEWER_SLOTS = [1, 2, 3, 4] as const;
export type ViewerSlot = (typeof VIEWER_SLOTS)[number];
export type ViewerSlotAssignments = Partial<Record<ViewerSlot, NodeId>>;

export interface RenderSettings {
  exportMode?: 'single' | 'sequence';
  filename: string;
  format: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/x-exr';
  quality: number;
  displayOutput: DisplayOutputSelection;
  openExrOutputPreset: OpenExrOutputPresetId;
  includeAlpha: boolean;
  sequenceFilenamePattern?: string;
  sequenceStartFrame?: number;
  sequenceEndFrame?: number;
  sequencePadding?: number;
}

export interface CacheNodeEntry {
  cachedFrames: boolean[];
  cachingFrames: boolean[];
}

export interface CacheStatus {
  memoryUsed: number;
  memoryLimit: number;
  nodeEntries: Record<string, CacheNodeEntry>;
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

export type TrackingAlgorithm = 'standard_lk' | 'hybrid';
export type TemporalTrackingMode = 'off' | 'normal' | 'strong';
export type TemporalTrackingRepair = 'blend' | 'predict';

export interface HybridTrackingConfig {
  maxError: number;
  outlierDistance: number;
  searchRadius: number;
  patchRadius: number;
  minimumNccScore: number;
  coherentFallback: boolean;
}

export interface TemporalTrackingConfig {
  mode: TemporalTrackingMode;
  smoothingWindow: number;
  anomalyThreshold: number;
  repair: TemporalTrackingRepair;
}

export interface TrackingConfig {
  translation: boolean;
  rotation: boolean;
  scale: boolean;
  /** Solve horizontal and vertical scale independently instead of uniform scale. */
  independentScale?: boolean;
  affine: boolean;
  perspective: boolean;
  deform: boolean;
  tracker?: TrackingAlgorithm;
  hybrid?: Partial<HybridTrackingConfig>;
  temporal?: Partial<TemporalTrackingConfig>;
  /** Set to null to disable drift checking (unlimited tolerance). */
  driftTolerance?: number | null;
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

export type NodePositions = Record<string, { x: number; y: number }>;

export type EditorStateSlice = Partial<{
  projectId: string | null;
  flows: Record<FlowId, Flow>;
  rootFlowId: FlowId | null;
  activeFlowId: FlowId | null;
  nodes: AnyNode[];
  selectedNodeId: NodeId | null;
  selectedNodeIds: NodeId[];
  hierarchySelections: Record<string, { layerIds: string[]; itemIds: string[] }>;
  selectedRotoPointRefs: RotoPointRef[];
  selectedKeyframes: SelectedKeyframeRef[];
  activeTab: EditorTab;
  colorManagement: ProjectColorManagement;
  aiChats: AiChatThread[];
  aiAgentRuns: AiAgentRun[];
  activeAiAgentRunId: string | null;
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
}>;

export interface HistoryEntry {
  id: string;
  label: string;
  state: EditorStateSlice;
  createdAt?: number;
  checkpointLabel?: string;
  consolidatedCount?: number;
}

export type PersistedProjectState = Omit<EditorStateSlice, 'projectId' | 'viewerSettings'>;

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
    | 'missing_output_node'
    | 'invalid_edge_reference'
    | 'invalid_stack_reference'
    | 'invalid_stack_shape'
    | 'connection_cycle';
  message: string;
}

const hasFlowEdgeCycle = (nodeIds: Iterable<NodeId>, edges: FlowEdge[]): boolean => {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.sourceNodeId)) {
      adjacency.set(edge.sourceNodeId, []);
    }

    adjacency.get(edge.sourceNodeId)!.push(edge.targetNodeId);
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

  if (!nodesById.has(flow.outputNodeId)) {
    issues.push({
      code: 'missing_output_node',
      message: `Flow outputNodeId "${flow.outputNodeId}" does not reference a node.`,
    });
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

  for (const edge of flow.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) {
      issues.push({
        code: 'invalid_edge_reference',
        message: `Edge "${edge.id}" references missing nodes.`,
      });
    }
  }

  for (const stack of flow.stacks) {
    if (
      !nodesById.has(stack.rootNodeId) ||
      stack.nodeIds.some((nodeId) => !nodesById.has(nodeId))
    ) {
      issues.push({
        code: 'invalid_stack_reference',
        message: `Stack "${stack.id}" references missing nodes.`,
      });
      continue;
    }

    if (
      stack.nodeIds[0] !== stack.rootNodeId ||
      new Set(stack.nodeIds).size !== stack.nodeIds.length
    ) {
      issues.push({
        code: 'invalid_stack_shape',
        message: `Stack "${stack.id}" must start with its root node and contain unique nodes.`,
      });
      continue;
    }

    for (const nodeId of stack.nodeIds) {
      const node = nodesById.get(nodeId)!;
      if (
        node.kind !== NodeKind.EFFECT &&
        node.kind !== NodeKind.GROUP &&
        node.kind !== NodeKind.INPUT
      ) {
        issues.push({
          code: 'invalid_stack_shape',
          message: `Stack "${stack.id}" must contain effect or group nodes only.`,
        });
        break;
      }
    }
  }

  if (hasFlowEdgeCycle(nodeIds, flow.edges)) {
    issues.push({
      code: 'connection_cycle',
      message: 'Flow edges must not contain cycles.',
    });
  }

  return issues;
};
