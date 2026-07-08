import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createStudioRenderer, readRenderTargetRgbaFloat } from '@blackboard/renderer';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { colors } from '@/utils/colors';
import { usePreferences } from '@/state/preferencesContext';
import type {
  DataChannelSemantic,
  DisplayOutputSelection,
  OpenExrOutputPresetId,
  OutputTechnicalChannel,
  RenderSettings,
  SceneNode,
} from '@blackboard/types';
import { CollapsibleSection, StyledDropdown, ToggleSwitch } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import {
  DisplayViewSelector,
  ExecuteButton,
  InspectorLogFooter,
  SegmentedControl,
  SettingRow,
  Slider,
} from '@/components';
import { OcioColorSpaceDropdown } from '@/components/OcioColorSpaceDropdown';
import { renderWithSharedPipeline, type RenderPipelineResult } from '@/renderer/pipeline';
import { hasRenderableNodes } from '@/nodes/helpers';
import { isBackgroundJobActive } from '@/state/editor/services/backgroundJobs';
import { registerBackgroundJobCancelHandler } from '@/state/editor/services/backgroundJobExecutor';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import { useSceneNode } from '@/hooks/useEditorNodes';
import {
  getDirectoryPickerSupport,
  type WindowWithDirectoryPicker,
} from '@/utils/directoryPickerSupport';
import { encodePngRgba, type RgbaByteImage } from '@/utils/pngRgba';
import { encodeRenderTargetOpenExr } from '@/utils/exrExport';
import { expandGroupNodesForRender } from '@/utils/groupRenderProjection';
import { getOutputRenderNodes, getViewerRenderNodes } from '@/utils/viewerSlots';
import { nodeRegistry } from '@/nodes/registry';
import {
  DISPLAY_OUTPUT_PRESET_OPTIONS,
  OPEN_EXR_OUTPUT_PRESETS,
  createDisplayOutputSelection,
  formatUnassignedMediaColorIssueMessage,
  getTechnicalOutputChannelName,
  getOutputNodeTechnicalChannels,
  getConnectedOutputTechnicalChannels,
  getUnassignedMediaColorIssues,
  getTechnicalOutputFormatIssue,
  resolveDisplayOutput,
  resolveCurrentViewerDisplayView,
  resolveOpenExrOutputPreset,
  resolveRenderOutputDomain,
} from '@/color-management';
import { useOcio } from '@/state/ocioContext';

type ExportMode = NonNullable<RenderSettings['exportMode']>;

const TECHNICAL_SEMANTIC_OPTIONS: Array<{
  value: DataChannelSemantic;
  label: string;
}> = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'mask', label: 'Mask' },
  { value: 'depth', label: 'Depth' },
  { value: 'normal', label: 'Normal' },
  { value: 'motion_vector', label: 'Motion Vector' },
  { value: 'uv', label: 'UV' },
  { value: 'position', label: 'Position' },
  { value: 'id', label: 'ID' },
  { value: 'cryptomatte', label: 'Cryptomatte' },
  { value: 'material_property', label: 'Material Property' },
];

let outputRenderQueue: Promise<void> = Promise.resolve();
const cancelledOutputRenderJobIds = new Set<string>();

let sharedRenderer: THREE.WebGLRenderer | null = null;

function getSharedRenderer(): THREE.WebGLRenderer {
  if (!sharedRenderer) {
    sharedRenderer = createStudioRenderer({
      preserveDrawingBuffer: true,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
  }
  return sharedRenderer;
}

const enqueueOutputRender = async (task: () => Promise<void>): Promise<void> => {
  let release: (() => void) | null = null;
  const currentRender = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previousRender = outputRenderQueue;
  outputRenderQueue = previousRender.catch(() => undefined).then(() => currentRender);

  await previousRender.catch(() => undefined);

  try {
    await task();
  } finally {
    release?.();
  }
};

function OutputRenderButton({
  disabled,
  disabledReason,
  exportMode,
  onRender,
}: {
  disabled: boolean;
  disabledReason?: string | null;
  exportMode: ExportMode;
  onRender: () => void;
}) {
  return (
    <ExecuteButton
      onClick={onRender}
      disabled={disabled}
      title={disabledReason ?? (exportMode === 'sequence' ? 'Render sequence' : 'Render image')}
    >
      Render
    </ExecuteButton>
  );
}

const DEFAULT_SEQUENCE_PADDING = 4;

const getRenderExtension = (format: RenderSettings['format']): string =>
  format === 'image/jpeg' ? 'jpg' : format === 'image/x-exr' ? 'exr' : format.split('/')[1];

const sanitizeFilenamePart = (value: string, fallback: string): string => {
  const sanitized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_');
  return sanitized || fallback;
};

const stripKnownImageExtension = (value: string): string =>
  value.replace(/\.(?:jpe?g|png|webp|exr)$/i, '');

const clampFrame = (value: number, maxFrames: number): number =>
  Math.max(0, Math.min(Math.max(0, maxFrames), Math.round(value)));

const getSequenceFrameRange = (
  renderSettings: RenderSettings,
  maxFrames: number,
): { startFrame: number; endFrame: number; frameCount: number } => {
  const startFrame = clampFrame(renderSettings.sequenceStartFrame ?? 0, maxFrames);
  const endFrame = clampFrame(renderSettings.sequenceEndFrame ?? maxFrames, maxFrames);
  const first = Math.min(startFrame, endFrame);
  const last = Math.max(startFrame, endFrame);

  return {
    startFrame: first,
    endFrame: last,
    frameCount: last - first + 1,
  };
};

const getSequencePadding = (renderSettings: RenderSettings): number =>
  Math.max(1, Math.min(8, Math.round(renderSettings.sequencePadding ?? DEFAULT_SEQUENCE_PADDING)));

const formatIntegerToken = (value: number, formatSpec: string, padding: number): string => {
  const spec = formatSpec.replace(/\{padding\}/g, String(padding)).trim();
  if (!spec) return String(value);

  const match = spec.match(/^0?(\d*)d$/);
  if (!match) return String(value);

  const width = match[1] ? Number.parseInt(match[1], 10) : 0;
  return width > 0 ? String(value).padStart(width, '0') : String(value);
};

const findTemplateTokenEnd = (template: string, startIndex: number): number => {
  let nestedDepth = 0;
  for (let index = startIndex + 1; index < template.length; index += 1) {
    const char = template[index];
    if (char === '{') {
      nestedDepth += 1;
    } else if (char === '}') {
      if (nestedDepth === 0) return index;
      nestedDepth -= 1;
    }
  }
  return -1;
};

const renderNameTemplate = (
  template: string,
  renderSettings: RenderSettings,
  frame: number,
  sequenceIndex: number,
): string => {
  const padding = getSequencePadding(renderSettings);
  const fallbackName = sanitizeFilenamePart(
    stripKnownImageExtension(renderSettings.filename),
    'export',
  );
  let output = '';

  for (let index = 0; index < template.length; index += 1) {
    const char = template[index];
    if (char !== '{') {
      output += char;
      continue;
    }

    const tokenEnd = findTemplateTokenEnd(template, index);
    if (tokenEnd === -1) {
      output += char;
      continue;
    }

    const token = template.slice(index + 1, tokenEnd);
    const separatorIndex = token.indexOf(':');
    const key = separatorIndex === -1 ? token : token.slice(0, separatorIndex);
    const formatSpec = separatorIndex === -1 ? '' : token.slice(separatorIndex + 1);

    if (key === 'frame' || key === 'frame_raw') {
      output +=
        key === 'frame_raw' ? String(frame) : formatIntegerToken(frame, formatSpec, padding);
    } else if (key === 'index' || key === 'index_raw') {
      output +=
        key === 'index_raw'
          ? String(sequenceIndex)
          : formatIntegerToken(sequenceIndex, formatSpec, padding);
    } else if (key === 'padding') {
      output += String(padding);
    } else if (key === 'name') {
      output += fallbackName;
    } else if (key === 'ext') {
      output += getRenderExtension(renderSettings.format);
    } else {
      output += template.slice(index, tokenEnd + 1);
    }

    index = tokenEnd;
  }

  return output;
};

const hasSequenceToken = (value: string): boolean =>
  /\{(?:frame|frame_raw|index|index_raw)(?:[:}])/.test(value);

const getFilenameTemplate = (
  renderSettings: RenderSettings,
  appendSequenceFrame: boolean,
): string => {
  const baseTemplate = stripKnownImageExtension(renderSettings.filename.trim()) || 'export';
  if (!appendSequenceFrame || hasSequenceToken(baseTemplate)) return baseTemplate;
  return `${baseTemplate}.{frame:{padding}d}`;
};

const formatOutputFilename = (
  renderSettings: RenderSettings,
  frame: number,
  sequenceIndex: number,
  options: { appendSequenceFrame: boolean },
): string => {
  const template = getFilenameTemplate(renderSettings, options.appendSequenceFrame);
  const name = renderNameTemplate(template, renderSettings, frame, sequenceIndex);
  const basename = stripKnownImageExtension(sanitizeFilenamePart(name, 'export'));
  return `${basename}.${getRenderExtension(renderSettings.format)}`;
};

const compactSequencePreview = (first: string, last: string): string => {
  if (first === last) return first;

  const firstNumber = first.match(/^(.*?)(\d+)(\.[^.]*)?$/);
  const lastNumber = last.match(/^(.*?)(\d+)(\.[^.]*)?$/);
  if (
    firstNumber &&
    lastNumber &&
    firstNumber[1] === lastNumber[1] &&
    (firstNumber[3] ?? '') === (lastNumber[3] ?? '')
  ) {
    return `${firstNumber[1]}${firstNumber[2]} ... ${lastNumber[2]}${firstNumber[3] ?? ''}`;
  }

  let prefixLength = 0;
  while (
    prefixLength < first.length &&
    prefixLength < last.length &&
    first[prefixLength] === last[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < first.length - prefixLength &&
    suffixLength < last.length - prefixLength &&
    first[first.length - suffixLength - 1] === last[last.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  if (prefixLength < 4 && suffixLength < 4) return `${first} ... ${last}`;

  const prefix = first.slice(0, prefixLength);
  const firstMiddle = first.slice(prefixLength, first.length - suffixLength);
  const lastMiddle = last.slice(prefixLength, last.length - suffixLength);
  const suffix = suffixLength > 0 ? first.slice(first.length - suffixLength) : '';
  return `${prefix}${firstMiddle} ... ${lastMiddle}${suffix}`;
};

const encodeCanvasBlob = (
  canvas: HTMLCanvasElement,
  type: RenderSettings['format'],
  quality?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Failed to create blob from canvas.'));
      },
      type,
      quality,
    );
  });

const encodeCanvas = (canvas: HTMLCanvasElement, renderSettings: RenderSettings): Promise<Blob> =>
  encodeCanvasBlob(
    canvas,
    renderSettings.format,
    renderSettings.format === 'image/png' ? undefined : renderSettings.quality / 100,
  );

const ensureDirectoryWritePermission = async (
  directoryHandle: FileSystemDirectoryHandle,
): Promise<void> => {
  const permissionedHandle = directoryHandle as FileSystemDirectoryHandle & {
    queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  const descriptor = { mode: 'readwrite' as const };

  if ((await permissionedHandle.queryPermission?.(descriptor)) === 'granted') {
    return;
  }

  if ((await permissionedHandle.requestPermission?.(descriptor)) === 'granted') {
    return;
  }

  throw new Error('Write permission was not granted for the selected folder.');
};

const writeBlobToDirectory = async (
  directoryHandle: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
): Promise<void> => {
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
};

const waitForUiTick = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

const toByteChannel = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
};

const writeStraightPixel = (
  output: Uint8Array,
  offset: number,
  r: number,
  g: number,
  b: number,
  a: number,
) => {
  const alpha = Math.max(0, Math.min(1, Number.isFinite(a) ? a : 0));
  output[offset] = toByteChannel(r);
  output[offset + 1] = toByteChannel(g);
  output[offset + 2] = toByteChannel(b);
  output[offset + 3] = toByteChannel(alpha);
};

const readRenderTargetToRgbaBytes = (
  result: RenderPipelineResult,
  target: NonNullable<RenderPipelineResult['finalOutputTarget']>,
): RgbaByteImage => {
  const { width, height } = target;
  const source = readRenderTargetRgbaFloat(result.renderer, target);
  const output = new Uint8Array(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    writeStraightPixel(
      output,
      offset,
      source[offset],
      source[offset + 1],
      source[offset + 2],
      source[offset + 3],
    );
  }

  return { data: output, width, height };
};

const encodeFinalOutputTargetPng = async (
  result: RenderPipelineResult,
  target: NonNullable<RenderPipelineResult['finalOutputTarget']>,
): Promise<Blob> => {
  const image = readRenderTargetToRgbaBytes(result, target);
  return encodePngRgba(image);
};

function RenderSettingsPanel() {
  const renderSettings = useEditorSelector((s) => s.renderSettings);
  const nodes = useEditorSelector((s) => s.nodes);
  const flows = useEditorSelector((s) => s.flows);
  const activeFlow = useEditorSelector((s) => {
    const flowId = s.activeFlowId ?? s.rootFlowId;
    return flowId ? s.flows[flowId] : null;
  });
  const sceneNode = useSceneNode();
  const projectColorManagement = useEditorSelector((s) => s.colorManagement);
  const projectDisplayView = projectColorManagement.viewer;
  const viewerColorManagement = useEditorSelector((s) => s.viewerColorManagement);
  const currentViewerDisplayView = resolveCurrentViewerDisplayView(
    projectDisplayView,
    viewerColorManagement,
  );
  const projectId = useEditorSelector((s) => s.projectId);
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const maxFrames = useEditorSelector((s) => s.maxFrames);
  const backgroundJobs = useEditorSelector((s) => s.backgroundJobs);
  const renderNodes = useMemo(
    () => expandGroupNodesForRender(getOutputRenderNodes(nodes, activeFlow), flows),
    [activeFlow, flows, nodes],
  );
  const connectedOutputTechnicalChannels = useMemo(
    () => getConnectedOutputTechnicalChannels(activeFlow),
    [activeFlow],
  );
  const technicalChannelSourceNodes = useMemo(() => {
    const channelNodes = connectedOutputTechnicalChannels.flatMap((channel) =>
      getViewerRenderNodes(nodes, channel.nodeId, activeFlow),
    );
    const uniqueNodes = [...new Map(channelNodes.map((node) => [node.id, node] as const)).values()];
    return expandGroupNodesForRender(uniqueNodes, flows);
  }, [activeFlow, connectedOutputTechnicalChannels, flows, nodes]);
  const renderOutputDomain = useMemo(
    () => resolveRenderOutputDomain({ nodes, flow: activeFlow, nodeRegistry }),
    [activeFlow, nodes],
  );
  const {
    setRenderSettings,
    startBackgroundJob,
    updateBackgroundJob,
    finishBackgroundJob,
    requestBackgroundJobCancel,
    setOutputTechnicalChannels,
  } = useEditorActions();
  const ocio = useOcio();
  const backgroundJobsRef = useRef(backgroundJobs);
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [directoryName, setDirectoryName] = useState('');
  const {
    primaryColor,
    alphaOverlayColorSource,
    alphaOverlayCustomColor,
    alphaOverlayOpacity,
    alphaOverlayBgDarken,
  } = usePreferences();

  const alphaOverlayStyle = useMemo(() => {
    const palette = colors[primaryColor] || colors.teal;
    const accentRgbString = palette[400] || palette[500] || colors.teal[400];
    const [r = 45, g = 212, b = 191] = accentRgbString.split(' ').map(Number);
    const accentColor: [number, number, number] = [r / 255, g / 255, b / 255];

    return {
      color: alphaOverlayColorSource === 'custom' ? alphaOverlayCustomColor : accentColor,
      opacity: alphaOverlayOpacity / 100,
      bgDarken: alphaOverlayBgDarken / 100,
    };
  }, [
    primaryColor,
    alphaOverlayColorSource,
    alphaOverlayCustomColor,
    alphaOverlayOpacity,
    alphaOverlayBgDarken,
  ]);

  const directoryPickerSupport = useMemo(() => getDirectoryPickerSupport(), []);
  const exportMode = renderSettings.exportMode ?? 'single';
  const outputTechnicalChannels = useMemo(
    () => getOutputNodeTechnicalChannels(activeFlow),
    [activeFlow],
  );

  useEffect(() => {
    backgroundJobsRef.current = backgroundJobs;
  }, [backgroundJobs]);

  const sequenceRange = useMemo(
    () => getSequenceFrameRange(renderSettings, maxFrames),
    [maxFrames, renderSettings],
  );
  const sequencePreview = useMemo(() => {
    const first = formatOutputFilename(renderSettings, sequenceRange.startFrame, 0, {
      appendSequenceFrame: true,
    });
    const last = formatOutputFilename(
      renderSettings,
      sequenceRange.endFrame,
      sequenceRange.frameCount - 1,
      { appendSequenceFrame: true },
    );
    return {
      first,
      last,
      compact: compactSequencePreview(first, last),
    };
  }, [renderSettings, sequenceRange]);

  const handleSettingChange = <K extends keyof RenderSettings>(
    key: K,
    value: RenderSettings[K],
  ) => {
    setRenderSettings({ [key]: value } as Partial<RenderSettings>);
  };

  const handleFilenameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRenderSettings({ filename: e.target.value, sequenceFilenamePattern: undefined });
  };

  const updateOutputTechnicalChannel = (
    channelId: string,
    updates: Partial<OutputTechnicalChannel>,
    withHistory = true,
  ) => {
    setOutputTechnicalChannels(
      outputTechnicalChannels.map((channel) =>
        channel.id === channelId ? { ...channel, ...updates } : channel,
      ),
      withHistory,
    );
  };

  const addOutputTechnicalChannel = () => {
    const existingIds = new Set(outputTechnicalChannels.map((channel) => channel.id));
    let index = outputTechnicalChannels.length + 1;
    while (existingIds.has(`channel_${index}`)) index += 1;
    setOutputTechnicalChannels([
      ...outputTechnicalChannels,
      {
        id: `channel_${index}`,
        name: index === 1 ? 'Z' : `channel${index}`,
        semantic: index === 1 ? 'depth' : 'material_property',
      },
    ]);
  };

  const removeOutputTechnicalChannel = (channelId: string) => {
    setOutputTechnicalChannels(
      outputTechnicalChannels.filter((channel) => channel.id !== channelId),
    );
  };

  const handleSequenceNumberChange = (
    key: 'sequenceStartFrame' | 'sequenceEndFrame' | 'sequencePadding',
    value: string,
  ) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    if (key === 'sequencePadding') {
      handleSettingChange(key, Math.max(1, Math.min(8, parsed)));
      return;
    }
    handleSettingChange(key, clampFrame(parsed, maxFrames));
  };

  const chooseDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!directoryPickerSupport.canUseDirectoryPicker) {
      alert(directoryPickerSupport.reason || 'Folder picker is unavailable.');
      return null;
    }

    try {
      const handle = await (window as WindowWithDirectoryPicker).showDirectoryPicker?.({
        id: 'blackboard-render-sequence',
        mode: 'readwrite',
      });
      if (!handle) return null;
      await ensureDirectoryWritePermission(handle);
      setDirectoryHandle(handle);
      setDirectoryName(handle.name);
      return handle;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null;
      }
      console.error('Failed to choose render folder:', error);
      alert(`Could not bind folder: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const formatOptions: { value: RenderSettings['format']; label: string }[] = [
    { value: 'image/jpeg', label: 'JPEG' },
    { value: 'image/png', label: 'PNG' },
    { value: 'image/webp', label: 'WebP' },
    { value: 'image/x-exr', label: 'OpenEXR' },
  ];

  const outputPresetOptions = useMemo(() => [...DISPLAY_OUTPUT_PRESET_OPTIONS], []);
  const selectedDisplayView =
    renderSettings.displayOutput.kind === 'display_view'
      ? renderSettings.displayOutput.displayView
      : projectDisplayView;
  const resolvedDisplayOutput = useMemo(
    () =>
      resolveDisplayOutput(renderSettings.displayOutput, {
        projectDisplayView,
        currentViewerDisplayView,
        currentViewerSettings: viewerSettings,
      }),
    [currentViewerDisplayView, projectDisplayView, renderSettings.displayOutput, viewerSettings],
  );
  const hasRenderableOutput = useMemo(() => hasRenderableNodes(nodes), [nodes]);
  const unassignedMediaColorIssues = useMemo(
    () => getUnassignedMediaColorIssues(renderNodes),
    [renderNodes],
  );
  const unassignedMediaColorMessage = useMemo(
    () => formatUnassignedMediaColorIssueMessage(unassignedMediaColorIssues),
    [unassignedMediaColorIssues],
  );
  const technicalOutputFormatMessage = getTechnicalOutputFormatIssue(
    renderOutputDomain,
    renderSettings.format,
  );
  const activeOutputRenderJob = useMemo(
    () =>
      backgroundJobs
        .filter(
          (job) =>
            job.type === 'render' &&
            job.source?.nodeId === OUTPUT_NODE_ID &&
            (!job.source.projectId || job.source.projectId === projectId) &&
            isBackgroundJobActive(job),
        )
        .sort((a, b) => a.startedAt - b.startedAt)[0] ?? null,
    [backgroundJobs, projectId],
  );

  const renderFrameBlob = async (sceneNode: SceneNode, frame: number): Promise<Blob> => {
    const isOpenExr = renderSettings.format === 'image/x-exr';
    const technicalChannelName = getTechnicalOutputChannelName(renderOutputDomain);
    const openExrPreset =
      isOpenExr && !technicalChannelName
        ? resolveOpenExrOutputPreset(renderSettings.openExrOutputPreset, ocio.colorSpaces)
        : null;
    const result = await renderWithSharedPipeline({
      nodes: renderNodes,
      sceneNode,
      projectColorManagement,
      frame,
      width: sceneNode.width,
      height: sceneNode.height,
      finalColorSpace: isOpenExr ? 'color_space' : resolvedDisplayOutput.finalColorSpace,
      viewerSettings: isOpenExr ? undefined : resolvedDisplayOutput.viewerSettings,
      displayView: isOpenExr ? undefined : resolvedDisplayOutput.displayView,
      outputColorSpace: isOpenExr
        ? openExrPreset?.colorSpace
        : resolvedDisplayOutput.outputColorSpace,
      outputDomain: renderOutputDomain,
      captureOutputs: isOpenExr
        ? connectedOutputTechnicalChannels.map((channel) => ({
            id: channel.id,
            nodeId: channel.nodeId,
            sourcePort: channel.sourcePort,
          }))
        : undefined,
      captureSourceNodes: isOpenExr ? technicalChannelSourceNodes : undefined,
      alphaOverlayStyle: isOpenExr || renderSettings.includeAlpha ? undefined : alphaOverlayStyle,
      textureCacheMode: 'none',
      preserveAlpha: renderSettings.includeAlpha,
      captureFinalOutput:
        isOpenExr || (renderSettings.includeAlpha && renderSettings.format === 'image/png'),
      presentToCanvas: !isOpenExr,
      renderer: getSharedRenderer(),
    });

    try {
      if (isOpenExr) {
        if (!result.finalOutputTarget) {
          throw new Error('OpenEXR export did not produce a floating-point output target.');
        }
        return encodeRenderTargetOpenExr(result.renderer, result.finalOutputTarget, {
          precision: openExrPreset?.precision ?? 'float',
          includeAlpha: technicalChannelName ? false : renderSettings.includeAlpha,
          ...(openExrPreset ? { attributes: openExrPreset.attributes } : {}),
          ...(technicalChannelName ? { technicalChannelName } : {}),
          namedChannelTargets: connectedOutputTechnicalChannels.map((channel) => {
            const target = result.capturedOutputTargets.get(channel.id);
            if (!target) {
              throw new Error(`Technical output channel "${channel.name}" was not captured.`);
            }
            return { name: channel.name, target };
          }),
        });
      }

      const shouldPreservePngAlpha =
        renderSettings.includeAlpha && renderSettings.format === 'image/png';
      const blob =
        shouldPreservePngAlpha && result.finalOutputTarget
          ? await encodeFinalOutputTargetPng(result, result.finalOutputTarget)
          : await encodeCanvas(result.canvas, renderSettings);
      return blob;
    } finally {
      result.dispose();
    }
  };

  const isRenderJobCancelRequested = (jobId: string): boolean =>
    cancelledOutputRenderJobIds.has(jobId) ||
    backgroundJobsRef.current.some(
      (job) => job.id === jobId && (job.status === 'cancelling' || job.status === 'cancelled'),
    );

  const cancelQueuedRenderJob = (jobId: string) => {
    finishBackgroundJob(jobId, {
      status: 'cancelled',
      detail: 'Cancelled before render started',
      progress: 0,
    });
  };

  const handleExportImage = async (sceneNode: SceneNode, jobId: string) => {
    try {
      updateBackgroundJob(jobId, {
        title: `Render ${renderSettings.filename}`,
        subtitle: `${sceneNode.width} x ${sceneNode.height}`,
        detail: `Rendering frame ${currentFrame}`,
        status: 'running',
        progress: 25,
        indeterminate: true,
        cancellable: false,
      });

      const blob = await renderFrameBlob(sceneNode, currentFrame);

      updateBackgroundJob(jobId, {
        detail: 'Downloading image',
        progress: 90,
        indeterminate: true,
      });

      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      const filename = formatOutputFilename(renderSettings, currentFrame, 0, {
        appendSequenceFrame: false,
      });
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      finishBackgroundJob(jobId, {
        status: 'complete',
        detail: filename,
        progress: 100,
      });
    } catch (error) {
      console.error('Render failed:', error);
      finishBackgroundJob(jobId, {
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
        progress: 100,
      });
      alert(`Render failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleExportSequence = async (sceneNode: SceneNode, jobId: string) => {
    updateBackgroundJob(jobId, {
      detail: 'Choosing output folder',
      status: 'running',
      progress: 0,
      indeterminate: false,
    });

    const targetDirectory = directoryHandle ?? (await chooseDirectory());
    if (!targetDirectory) {
      finishBackgroundJob(jobId, {
        status: 'cancelled',
        detail: 'Folder selection cancelled',
        progress: 0,
      });
      return;
    }

    if (isRenderJobCancelRequested(jobId)) {
      cancelQueuedRenderJob(jobId);
      return;
    }

    let unregisterCancel: (() => void) | null = null;
    let cancelRequested = false;

    try {
      await ensureDirectoryWritePermission(targetDirectory);

      updateBackgroundJob(jobId, {
        title: `Render ${renderSettings.filename} sequence`,
        subtitle: `${sequenceRange.frameCount} frames to ${targetDirectory.name}`,
        detail: `Preparing frames ${sequenceRange.startFrame}-${sequenceRange.endFrame}`,
        status: 'running',
        progress: 0,
        cancellable: true,
      });

      unregisterCancel = registerBackgroundJobCancelHandler(jobId, () => {
        cancelRequested = true;
      });

      for (let frame = sequenceRange.startFrame; frame <= sequenceRange.endFrame; frame += 1) {
        const sequenceIndex = frame - sequenceRange.startFrame;
        const progress = Math.round((sequenceIndex / sequenceRange.frameCount) * 100);
        const filename = formatOutputFilename(renderSettings, frame, sequenceIndex, {
          appendSequenceFrame: true,
        });

        if (cancelRequested) {
          finishBackgroundJob(jobId, {
            status: 'cancelled',
            detail: `Stopped before frame ${frame}`,
            progress,
          });
          return;
        }

        updateBackgroundJob(jobId, {
          detail: `Rendering ${filename}`,
          progress,
          indeterminate: false,
        });

        const blob = await renderFrameBlob(sceneNode, frame);

        if (cancelRequested) {
          finishBackgroundJob(jobId, {
            status: 'cancelled',
            detail: `Stopped after frame ${frame}`,
            progress,
          });
          return;
        }

        updateBackgroundJob(jobId, {
          detail: `Writing ${filename}`,
          progress: Math.round(((sequenceIndex + 0.5) / sequenceRange.frameCount) * 100),
          indeterminate: false,
        });
        await writeBlobToDirectory(targetDirectory, filename, blob);
        await waitForUiTick();
      }

      finishBackgroundJob(jobId, {
        status: 'complete',
        detail: `${sequenceRange.frameCount} frames written to ${targetDirectory.name}`,
        progress: 100,
      });
    } catch (error) {
      console.error('Sequence export failed:', error);
      finishBackgroundJob(jobId, {
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
        progress: 100,
      });
      alert(`Sequence export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      unregisterCancel?.();
    }
  };

  const handleExport = async () => {
    if (!sceneNode) {
      alert('Error: No scene found to determine export dimensions.');
      return;
    }
    if (unassignedMediaColorMessage) {
      alert(unassignedMediaColorMessage);
      return;
    }
    if (technicalOutputFormatMessage) {
      alert(technicalOutputFormatMessage);
      return;
    }

    const jobId = startBackgroundJob({
      type: 'render',
      title:
        exportMode === 'sequence'
          ? `Render ${renderSettings.filename} sequence`
          : `Render ${renderSettings.filename}`,
      subtitle:
        exportMode === 'sequence'
          ? `${sequenceRange.frameCount} frames`
          : `${sceneNode.width} x ${sceneNode.height}`,
      detail: 'Queued render',
      status: 'queued',
      progress: 0,
      indeterminate: false,
      cancellable: true,
      source: { ...(projectId ? { projectId } : {}), nodeId: OUTPUT_NODE_ID },
    });
    const unregisterQueuedCancelHandler = registerBackgroundJobCancelHandler(jobId, () => {
      cancelledOutputRenderJobIds.add(jobId);
      cancelQueuedRenderJob(jobId);
    });

    void enqueueOutputRender(async () => {
      try {
        if (isRenderJobCancelRequested(jobId)) {
          cancelQueuedRenderJob(jobId);
          return;
        }

        unregisterQueuedCancelHandler();

        if (exportMode === 'sequence') {
          await handleExportSequence(sceneNode, jobId);
        } else {
          await handleExportImage(sceneNode, jobId);
        }
      } finally {
        unregisterQueuedCancelHandler();
        cancelledOutputRenderJobIds.delete(jobId);
      }
    });
  };

  const isRenderActionDisabled =
    !hasRenderableOutput ||
    Boolean(unassignedMediaColorMessage) ||
    Boolean(technicalOutputFormatMessage) ||
    (exportMode === 'sequence' && !directoryPickerSupport.canUseDirectoryPicker);

  useNodeExecutionHandler(OUTPUT_NODE_ID, () => {
    if (isRenderActionDisabled) return;
    void handleExport();
  });

  const renderActions = (
    <OutputRenderButton
      disabled={isRenderActionDisabled}
      disabledReason={unassignedMediaColorMessage ?? technicalOutputFormatMessage}
      exportMode={exportMode}
      onRender={() => void handleExport()}
    />
  );

  const outputPreview =
    exportMode === 'sequence'
      ? {
          label: `${sequenceRange.frameCount} frames`,
          value: directoryName
            ? `${directoryName}/${sequencePreview.compact}`
            : sequencePreview.compact,
        }
      : {
          label: '1 image',
          value: formatOutputFilename(renderSettings, currentFrame, 0, {
            appendSequenceFrame: false,
          }),
        };

  const handleCancelRender = () => {
    if (!activeOutputRenderJob?.cancellable) return;
    requestBackgroundJobCancel(activeOutputRenderJob.id);
  };

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="min-w-0 flex-1">
        <CollapsibleSection title="Render Settings" defaultOpen>
          <div className="space-y-3">
            <SegmentedControl
              value={exportMode}
              options={[
                { value: 'single', label: 'Image' },
                { value: 'sequence', label: 'Sequence' },
              ]}
              onChange={(value) => handleSettingChange('exportMode', value as ExportMode)}
            />

            <SettingRow label="Filename">
              <input
                type="text"
                name="filename"
                value={renderSettings.filename}
                onChange={handleFilenameChange}
                className="bb-control-input block w-44 rounded-md border-0 bg-gray-700/50 px-2.5 py-1.5 font-mono text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-700 focus:ring-offset-0 focus:ring-offset-gray-900"
              />
            </SettingRow>

            {exportMode === 'sequence' && (
              <>
                <SettingRow label="Folder">
                  <button
                    type="button"
                    onClick={() => void chooseDirectory()}
                    disabled={!directoryPickerSupport.canUseDirectoryPicker}
                    className="bb-control-button inline-flex w-44 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-gray-700/50 px-2.5 py-1.5 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                    title={directoryName || directoryPickerSupport.reason || 'Bind output folder'}
                  >
                    <Icons.FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{directoryName || 'Bind Folder'}</span>
                  </button>
                </SettingRow>

                <SettingRow label="Frame Range">
                  <div className="flex w-44 items-center gap-1.5">
                    <input
                      type="number"
                      value={renderSettings.sequenceStartFrame ?? 0}
                      onChange={(event) =>
                        handleSequenceNumberChange('sequenceStartFrame', event.target.value)
                      }
                      min={0}
                      max={maxFrames}
                      className="bb-control-input block min-w-0 flex-1 rounded-md border-0 bg-gray-700/50 px-2 py-1.5 font-mono text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-700 focus:ring-offset-0 focus:ring-offset-gray-900"
                    />
                    <span className="shrink-0 text-gray-500">-</span>
                    <input
                      type="number"
                      value={renderSettings.sequenceEndFrame ?? maxFrames}
                      onChange={(event) =>
                        handleSequenceNumberChange('sequenceEndFrame', event.target.value)
                      }
                      min={0}
                      max={maxFrames}
                      className="bb-control-input block min-w-0 flex-1 rounded-md border-0 bg-gray-700/50 px-2 py-1.5 font-mono text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-700 focus:ring-offset-0 focus:ring-offset-gray-900"
                    />
                  </div>
                </SettingRow>

                <SettingRow label="Padding">
                  <input
                    type="number"
                    value={renderSettings.sequencePadding ?? DEFAULT_SEQUENCE_PADDING}
                    onChange={(event) =>
                      handleSequenceNumberChange('sequencePadding', event.target.value)
                    }
                    min={1}
                    max={8}
                    className="bb-control-input block w-44 rounded-md border-0 bg-gray-700/50 px-2.5 py-1.5 font-mono text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-700 focus:ring-offset-0 focus:ring-offset-gray-900"
                  />
                </SettingRow>
              </>
            )}

            <SettingRow label="Format">
              <StyledDropdown
                value={renderSettings.format}
                options={formatOptions}
                onChange={(value) =>
                  handleSettingChange('format', value as RenderSettings['format'])
                }
                widthClass="w-44"
              />
            </SettingRow>

            {renderSettings.format !== 'image/x-exr' && (
              <SettingRow label="Output Transform">
                <StyledDropdown
                  value={renderSettings.displayOutput.kind}
                  options={outputPresetOptions}
                  onChange={(value) => {
                    const kind = String(value) as DisplayOutputSelection['kind'];
                    handleSettingChange(
                      'displayOutput',
                      createDisplayOutputSelection(kind, {
                        projectDisplayView,
                        directColorSpace: ocio.textureColorSpace,
                      }),
                    );
                  }}
                  widthClass="w-44"
                  popoverWidthClass="w-80"
                />
              </SettingRow>
            )}

            {renderSettings.format === 'image/x-exr' && renderOutputDomain.kind === 'color' && (
              <SettingRow label="EXR Preset">
                <StyledDropdown
                  value={renderSettings.openExrOutputPreset}
                  options={OPEN_EXR_OUTPUT_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: preset.label,
                  }))}
                  onChange={(value) =>
                    handleSettingChange(
                      'openExrOutputPreset',
                      String(value) as OpenExrOutputPresetId,
                    )
                  }
                  widthClass="w-44"
                />
              </SettingRow>
            )}

            {renderSettings.format === 'image/x-exr' && renderOutputDomain.kind === 'data' && (
              <SettingRow label="EXR Channel">
                <span className="w-44 truncate text-right font-mono text-xs text-gray-300">
                  {getTechnicalOutputChannelName(renderOutputDomain)}
                </span>
              </SettingRow>
            )}

            {renderSettings.format === 'image/x-exr' && (
              <div className="space-y-2 border-t border-white/10 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-400">Technical Channels</span>
                  <button
                    type="button"
                    onClick={addOutputTechnicalChannel}
                    title="Add technical output channel"
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 transition hover:bg-white/10 hover:text-gray-100"
                  >
                    <Icons.Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {outputTechnicalChannels.map((channel) => (
                  <div
                    key={channel.id}
                    className="grid grid-cols-[minmax(0,1fr)_7rem_1.75rem] items-center gap-1.5"
                  >
                    <input
                      value={channel.name}
                      onChange={(event) =>
                        updateOutputTechnicalChannel(
                          channel.id,
                          {
                            name: event.currentTarget.value,
                          },
                          false,
                        )
                      }
                      aria-label="EXR channel name"
                      className="bb-control-input min-w-0 rounded bg-gray-700/50 px-2 py-2 font-mono text-xs text-gray-200 outline-none focus:ring-1 focus:ring-primary-700"
                    />
                    <StyledDropdown
                      value={channel.semantic ?? 'material_property'}
                      options={TECHNICAL_SEMANTIC_OPTIONS}
                      onChange={(value) =>
                        updateOutputTechnicalChannel(channel.id, {
                          semantic: String(value) as DataChannelSemantic,
                        })
                      }
                      widthClass="w-28"
                      popoverWidthClass="w-48"
                    />
                    <button
                      type="button"
                      onClick={() => removeOutputTechnicalChannel(channel.id)}
                      title={`Remove ${channel.name || 'technical channel'}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 transition hover:bg-red-500/10 hover:text-red-200"
                    >
                      <Icons.Trash className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {renderSettings.format !== 'image/x-exr' &&
              renderSettings.displayOutput.kind === 'display_view' && (
                <div className="border-t border-white/10 pt-3">
                  <div className="mb-2 text-xs font-medium text-gray-400">Export View</div>
                  <DisplayViewSelector
                    value={selectedDisplayView}
                    onChange={(displayView) =>
                      handleSettingChange('displayOutput', {
                        kind: 'display_view',
                        displayView,
                      })
                    }
                    controlWidthClass="w-full"
                    popoverWidthClass="w-80"
                  />
                </div>
              )}

            {renderSettings.format !== 'image/x-exr' &&
              renderSettings.displayOutput.kind === 'direct_encoding' && (
                <SettingRow label="Encoding">
                  <div className="w-44">
                    <OcioColorSpaceDropdown
                      value={renderSettings.displayOutput.colorSpace}
                      onChange={(colorSpace) =>
                        handleSettingChange('displayOutput', {
                          kind: 'direct_encoding',
                          colorSpace,
                        })
                      }
                      includeData={false}
                      popoverWidthClass="w-80"
                    />
                  </div>
                </SettingRow>
              )}

            {(renderSettings.format === 'image/jpeg' || renderSettings.format === 'image/webp') && (
              <Slider
                label="Quality"
                value={renderSettings.quality}
                min={1}
                max={100}
                step={1}
                onChange={(value) => handleSettingChange('quality', value)}
                onReset={() => handleSettingChange('quality', 90)}
              />
            )}

            {renderOutputDomain.kind === 'color' &&
              (renderSettings.format === 'image/png' ||
                renderSettings.format === 'image/webp' ||
                renderSettings.format === 'image/x-exr') && (
                <div className="py-1">
                  <ToggleSwitch
                    checked={renderSettings.includeAlpha}
                    onCheckedChange={(checked) => handleSettingChange('includeAlpha', checked)}
                    label="Alpha Channel"
                    description={
                      renderSettings.includeAlpha ? 'Transparent background' : 'Solid background'
                    }
                    size="sm"
                  />
                </div>
              )}
          </div>
        </CollapsibleSection>
      </div>

      <div className="sticky bottom-0 z-20 mt-auto bg-gray-950/90 backdrop-blur-xl border-t border-white/10 supports-[backdrop-filter]:bg-gray-900/50">
        <CollapsibleSection
          title="Execute"
          defaultOpen
          action={renderActions}
          collapsedAction={renderActions}
        >
          <div className="rounded-lg border border-white/10 bg-gray-950/40 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                Output
              </span>
              <span className="text-[10px] text-gray-600">{outputPreview.label}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-500">
                {exportMode === 'sequence' ? 'Path preview' : 'File preview'}
              </span>
              <span className="min-w-0 truncate font-mono text-[11px] text-gray-300">
                {outputPreview.value}
              </span>
            </div>
            {exportMode === 'sequence' && !directoryPickerSupport.canUseDirectoryPicker && (
              <p className="mt-1 text-red-300">{directoryPickerSupport.reason}</p>
            )}
            {unassignedMediaColorMessage && (
              <p className="mt-2 rounded-md border border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[11px] leading-5 text-red-100">
                {unassignedMediaColorMessage}
              </p>
            )}
            {technicalOutputFormatMessage && (
              <p className="mt-2 rounded border border-amber-400/20 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-5 text-amber-100">
                {technicalOutputFormatMessage}
              </p>
            )}
            {!hasRenderableOutput && (
              <p className="mt-2 text-center text-xs text-gray-500">
                Add an image, sequence, video, or text node to the project to enable render.
              </p>
            )}
          </div>
        </CollapsibleSection>

        <InspectorLogFooter
          label={
            activeOutputRenderJob?.status === 'queued'
              ? 'Queued'
              : activeOutputRenderJob
                ? 'Rendering'
                : 'Log'
          }
          message={activeOutputRenderJob?.detail}
          progressIndeterminate={activeOutputRenderJob?.indeterminate}
          progressLabel={activeOutputRenderJob?.detail}
          progressPercent={activeOutputRenderJob?.progress}
          variant={activeOutputRenderJob?.status === 'error' ? 'error' : 'info'}
          actions={
            activeOutputRenderJob?.cancellable ? (
              <button
                type="button"
                onClick={handleCancelRender}
                className="rounded-md border border-primary-100/20 px-2 py-1 text-[11px] font-medium text-primary-100/75 transition hover:border-red-300/50 hover:bg-red-500/10 hover:text-red-100"
              >
                Cancel
              </button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

function OutputAdjustments() {
  return <RenderSettingsPanel />;
}

export default OutputAdjustments;
