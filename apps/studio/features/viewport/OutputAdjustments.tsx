import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences, colors } from '@/state/preferencesContext';
import { NodeType, RenderSettings, SceneNode } from '@blackboard/types';
import {
  CollapsibleSection,
  Icons,
  InspectorLogFooter,
  SegmentedControl,
  StyledDropdown,
  Slider,
  ToggleSwitch,
} from '@/components';
import { renderWithSharedPipeline, type RenderPipelineResult } from '@/renderer/pipeline';
import { hasRenderableNodes } from '@/effects/effectHelpers';
import {
  isBackgroundJobActive,
  registerBackgroundJobCancelHandler,
} from '@/state/editor/services/backgroundJobs';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import { getDirectoryPickerSupport } from '@/utils/directoryPickerSupport';
import { encodePngRgba, type RgbaByteImage } from '@/utils/pngRgba';

const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="grid grid-cols-[auto,minmax(0,1fr)] items-center gap-2 text-xs">
    <label className="text-[11px] text-gray-400 whitespace-nowrap">{label}</label>
    <div className="justify-self-end">{children}</div>
  </div>
);

type ExportMode = NonNullable<RenderSettings['exportMode']>;

let outputRenderQueue: Promise<void> = Promise.resolve();
const cancelledOutputRenderJobIds = new Set<string>();

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

const OutputRenderButton: React.FC<{
  disabled: boolean;
  exportMode: ExportMode;
  onRender: () => void;
}> = ({ disabled, exportMode, onRender }) => (
  <button
    type="button"
    onClick={onRender}
    disabled={disabled}
    title={exportMode === 'sequence' ? 'Render sequence' : 'Render image'}
    className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-900/70 disabled:text-gray-500"
  >
    <Icons.Play className="h-3.5 w-3.5" />
    Render
  </button>
);

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
};

const DEFAULT_SEQUENCE_PADDING = 4;
const LEGACY_DEFAULT_SEQUENCE_PATTERN = '{name}_####';

const getRenderExtension = (format: RenderSettings['format']): string =>
  format === 'image/jpeg' ? 'jpg' : format.split('/')[1];

const sanitizeFilenamePart = (value: string, fallback: string): string => {
  const sanitized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_');
  return sanitized || fallback;
};

const stripKnownImageExtension = (value: string): string =>
  value.replace(/\.(?:jpe?g|png|webp)$/i, '');

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

const migrateLegacySequencePattern = (pattern: string, filename: string): string => {
  const trimmedPattern = pattern.trim();
  const baseName = stripKnownImageExtension(filename.trim()) || 'export';
  if (!trimmedPattern || trimmedPattern === LEGACY_DEFAULT_SEQUENCE_PATTERN) return baseName;

  return trimmedPattern
    .replace(/\{name\}/g, baseName)
    .replace(/\{frame_raw\}/g, '{frame}')
    .replace(/\{index_raw\}/g, '{index}')
    .replace(/\{frame\}/g, '{frame:{padding}d}')
    .replace(/\{index\}/g, '{index:{padding}d}')
    .replace(/#+/g, (hashes) => `{frame:0${hashes.length}d}`);
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
  const pixelCount = width * height;
  const output = new Uint8Array(pixelCount * 4);
  const textureType = target.texture.type;

  if (textureType === THREE.FloatType) {
    const buffer = new Float32Array(pixelCount * 4);
    result.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
      const targetY = height - sourceY - 1;
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = (sourceY * width + x) * 4;
        const targetOffset = (targetY * width + x) * 4;
        writeStraightPixel(
          output,
          targetOffset,
          buffer[sourceOffset],
          buffer[sourceOffset + 1],
          buffer[sourceOffset + 2],
          buffer[sourceOffset + 3],
        );
      }
    }
  } else if (textureType === THREE.HalfFloatType) {
    const buffer = new Uint16Array(pixelCount * 4);
    result.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
      const targetY = height - sourceY - 1;
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = (sourceY * width + x) * 4;
        const targetOffset = (targetY * width + x) * 4;
        writeStraightPixel(
          output,
          targetOffset,
          THREE.DataUtils.fromHalfFloat(buffer[sourceOffset]),
          THREE.DataUtils.fromHalfFloat(buffer[sourceOffset + 1]),
          THREE.DataUtils.fromHalfFloat(buffer[sourceOffset + 2]),
          THREE.DataUtils.fromHalfFloat(buffer[sourceOffset + 3]),
        );
      }
    }
  } else {
    const buffer = new Uint8Array(pixelCount * 4);
    result.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
      const targetY = height - sourceY - 1;
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = (sourceY * width + x) * 4;
        const targetOffset = (targetY * width + x) * 4;
        writeStraightPixel(
          output,
          targetOffset,
          buffer[sourceOffset] / 255,
          buffer[sourceOffset + 1] / 255,
          buffer[sourceOffset + 2] / 255,
          buffer[sourceOffset + 3] / 255,
        );
      }
    }
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

const RenderSettingsPanel: React.FC = () => {
  const renderSettings = useEditorSelector((s) => s.renderSettings);
  const nodes = useEditorSelector((s) => s.nodes);
  const projectId = useEditorSelector((s) => s.projectId);
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const maxFrames = useEditorSelector((s) => s.maxFrames);
  const backgroundJobs = useEditorSelector((s) => s.backgroundJobs);
  const {
    setRenderSettings,
    startBackgroundJob,
    updateBackgroundJob,
    finishBackgroundJob,
    requestBackgroundJobCancel,
  } = useEditorActions();
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

  useEffect(() => {
    backgroundJobsRef.current = backgroundJobs;
  }, [backgroundJobs]);

  useEffect(() => {
    if (renderSettings.sequenceFilenamePattern === undefined) return;

    setRenderSettings({
      filename: migrateLegacySequencePattern(
        renderSettings.sequenceFilenamePattern,
        renderSettings.filename,
      ),
      sequenceFilenamePattern: undefined,
    });
  }, [renderSettings.filename, renderSettings.sequenceFilenamePattern, setRenderSettings]);

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
  ];

  const outputColorSpaceOptions: { value: RenderSettings['outputColorSpace']; label: string }[] = [
    { value: 'scene_linear', label: 'Scene Linear' },
    { value: 'srgb', label: 'sRGB (Standard)' },
    { value: 'match_viewport', label: 'Match Viewport' },
  ];
  const hasRenderableOutput = useMemo(() => hasRenderableNodes(nodes), [nodes]);
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
    const result = await renderWithSharedPipeline({
      nodes: nodes,
      sceneNode,
      frame,
      width: sceneNode.width,
      height: sceneNode.height,
      finalColorSpace: renderSettings.outputColorSpace,
      viewerSettings,
      alphaOverlayStyle: renderSettings.includeAlpha ? undefined : alphaOverlayStyle,
      textureCacheMode: 'none',
      preserveAlpha: renderSettings.includeAlpha,
      captureFinalOutput: renderSettings.includeAlpha && renderSettings.format === 'image/png',
    });

    try {
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
    const sceneNode = nodes.find((node) => node.type === NodeType.SCENE) as SceneNode | undefined;
    if (!sceneNode) {
      alert('Error: No scene found to determine export dimensions.');
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
    (exportMode === 'sequence' && !directoryPickerSupport.canUseDirectoryPicker);

  useNodeExecutionHandler(OUTPUT_NODE_ID, () => {
    if (isRenderActionDisabled) return;
    void handleExport();
  });

  const renderActions = (
    <OutputRenderButton
      disabled={isRenderActionDisabled}
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
                className="w-44 bg-gray-700/50 text-gray-200 text-xs rounded-md focus:outline-none focus:ring-1 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block px-2.5 py-1.5 font-mono border-0"
              />
            </SettingRow>

            {exportMode === 'sequence' && (
              <>
                <SettingRow label="Folder">
                  <button
                    type="button"
                    onClick={() => void chooseDirectory()}
                    disabled={!directoryPickerSupport.canUseDirectoryPicker}
                    className="inline-flex w-44 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-gray-700/50 px-2.5 py-1.5 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                      className="min-w-0 flex-1 bg-gray-700/50 text-gray-200 text-xs rounded-md focus:outline-none focus:ring-1 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block px-2 py-1.5 font-mono border-0"
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
                      className="min-w-0 flex-1 bg-gray-700/50 text-gray-200 text-xs rounded-md focus:outline-none focus:ring-1 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block px-2 py-1.5 font-mono border-0"
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
                    className="w-44 bg-gray-700/50 text-gray-200 text-xs rounded-md focus:outline-none focus:ring-1 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block px-2.5 py-1.5 font-mono border-0"
                  />
                </SettingRow>
              </>
            )}

            <SettingRow label="Format">
              <StyledDropdown
                value={renderSettings.format}
                options={formatOptions}
                onChange={(value) => handleSettingChange('format', value)}
                widthClass="w-44"
              />
            </SettingRow>

            <SettingRow label="Output Color Space">
              <StyledDropdown
                value={renderSettings.outputColorSpace}
                options={outputColorSpaceOptions}
                onChange={(value) => handleSettingChange('outputColorSpace', value)}
                widthClass="w-44"
              />
            </SettingRow>

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

            {(renderSettings.format === 'image/png' || renderSettings.format === 'image/webp') && (
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
};

const OutputAdjustments: React.FC = () => {
  return <RenderSettingsPanel />;
};

export default OutputAdjustments;
