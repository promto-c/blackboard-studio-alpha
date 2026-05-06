import type {
  ComfyWorkflow,
  ComfyWorkflowControl,
  ComfyWorkflowControlValue,
} from '@blackboard/types';

export interface MissingWorkflowControlOption {
  control: ComfyWorkflowControl;
  value: string;
  installTargets: string[];
  guidance: string;
  downloadUrl?: string;
}

export type MissingModelSizeStatus = number | 'loading' | null;

const getModelFileName = (value: string): string =>
  value.split(/[\\/]/).filter(Boolean).pop() ?? value;

export const getModelSearchName = (value: string): string => {
  const fileName = getModelFileName(value.trim());
  const searchName = fileName.replace(/\.[^.]+$/, '').trim();
  return searchName || fileName || value.trim();
};

const buildMissingModelSearchUrl = (modelName: string): string =>
  `https://huggingface.co/models?search=${encodeURIComponent(getModelSearchName(modelName))}`;

export const getMissingModelDownloadUrl = (missingOption: MissingWorkflowControlOption): string =>
  missingOption.downloadUrl ?? buildMissingModelSearchUrl(missingOption.value);

export const getMissingModelSizeKey = (missingOption: MissingWorkflowControlOption): string =>
  missingOption.downloadUrl ?? missingOption.value;

const formatModelSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  const gigabytes = megabytes / 1024;
  return `${gigabytes.toFixed(gigabytes >= 10 ? 1 : 2)} GB`;
};

export const getMissingModelSizeLabel = (
  sizeStatus: MissingModelSizeStatus | undefined,
): string | null => {
  if (sizeStatus === undefined || sizeStatus === 'loading') return 'Size...';
  if (sizeStatus === null) return 'Size unknown';
  return formatModelSize(sizeStatus);
};

export const fetchMissingModelDownloadSize = async (
  url: string,
  signal: AbortSignal,
): Promise<number | null> => {
  try {
    const response = await fetch(url, { method: 'HEAD', signal });
    if (!response.ok) return null;
    const contentLength = response.headers.get('content-length');
    if (!contentLength) return null;
    const size = Number(contentLength);
    return Number.isFinite(size) && size >= 0 ? size : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
};

const extractHttpUrl = (value: string): string | null =>
  value.match(/https?:\/\/[^\s"'<>]+/i)?.[0].replace(/[),.;]+$/, '') ?? null;

const normalizeSearchValue = (value: string): string => {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
};

const stringReferencesModel = (value: string, modelName: string): boolean => {
  const normalizedValue = normalizeSearchValue(value);
  const normalizedModelName = normalizeSearchValue(modelName);
  const normalizedFileName = normalizeSearchValue(getModelFileName(modelName));

  return (
    normalizedValue.includes(normalizedModelName) ||
    (normalizedFileName.length > 0 && normalizedValue.includes(normalizedFileName))
  );
};

const isWorkflowDownloadKey = (key: string): boolean => {
  const normalizedKey = key.toLowerCase();
  return (
    normalizedKey.includes('download') ||
    normalizedKey === 'url' ||
    normalizedKey.endsWith('_url') ||
    normalizedKey.endsWith('url') ||
    normalizedKey.includes('href')
  );
};

const collectWorkflowDownloadUrls = (value: unknown, modelName: string): string[] => {
  if (typeof value === 'string') {
    const url = extractHttpUrl(value);
    return url && stringReferencesModel(url, modelName) ? [url] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectWorkflowDownloadUrls(entry, modelName));
  }

  if (typeof value !== 'object' || value === null) return [];

  const entries = Object.entries(value as Record<string, unknown>);
  const objectReferencesModel = entries.some(
    ([, entryValue]) =>
      typeof entryValue === 'string' && stringReferencesModel(entryValue, modelName),
  );
  const localUrls = entries.flatMap(([key, entryValue]) => {
    if (typeof entryValue !== 'string') return [];

    const url = extractHttpUrl(entryValue);
    if (!url) return [];
    if (stringReferencesModel(url, modelName)) return [url];
    return objectReferencesModel && isWorkflowDownloadKey(key) ? [url] : [];
  });

  return [
    ...localUrls,
    ...entries.flatMap(([, entryValue]) => collectWorkflowDownloadUrls(entryValue, modelName)),
  ];
};

const getWorkflowModelDownloadUrl = (
  workflow: ComfyWorkflow,
  control: ComfyWorkflowControl,
): string | undefined => {
  const modelName = String(control.value);
  const urls = [workflow.sourceGraph, workflow.prompt].flatMap((value) =>
    collectWorkflowDownloadUrls(value, modelName),
  );

  return [...new Set(urls)][0];
};

export const getMissingModelInstallPaths = ({
  value,
  installTargets,
}: Pick<MissingWorkflowControlOption, 'value' | 'installTargets'>): string[] => {
  const fileName = value.trim().replace(/^\/+/, '');
  if (!fileName) return installTargets;
  if (installTargets.length === 0) return [fileName];

  return installTargets.map((target) => `${target.replace(/\/+$/, '')}/${fileName}`);
};

export const getMissingModelInstallDirBadge = (
  missingOption: MissingWorkflowControlOption,
): string => {
  const installPath = getMissingModelInstallPaths(missingOption)[0];
  if (!installPath) return '';
  return installPath.split('/').filter(Boolean).slice(0, -1).pop() ?? '';
};

export const normalizeComparableControlValue = (value: ComfyWorkflowControlValue): string =>
  String(value).trim().toLowerCase();

const isWorkflowControlOptionAvailable = (
  control: ComfyWorkflowControl,
  value: ComfyWorkflowControlValue,
): boolean => {
  if (!control.options || control.options.length === 0) return true;

  const normalizedValue = normalizeComparableControlValue(value);
  return control.options.some(
    (option) => normalizeComparableControlValue(option) === normalizedValue,
  );
};

export const isWorkflowControlSelectedOptionMissing = (control: ComfyWorkflowControl): boolean => {
  if (!control.options || control.options.length === 0) return false;
  if (typeof control.value !== 'string' && typeof control.value !== 'number') return false;

  return !isWorkflowControlOptionAvailable(control, control.value);
};

const getComfyModelInstallTargets = (control: ComfyWorkflowControl): string[] => {
  const searchText = [
    control.label,
    control.inputName,
    control.classType,
    control.description ?? '',
    String(control.value),
  ]
    .join(' ')
    .toLowerCase();

  if (searchText.includes('lora')) return ['ComfyUI/models/loras'];
  if (searchText.includes('vae')) return ['ComfyUI/models/vae'];
  if (searchText.includes('controlnet') || searchText.includes('control_net')) {
    return ['ComfyUI/models/controlnet'];
  }
  if (searchText.includes('clip vision') || searchText.includes('clip_vision')) {
    return ['ComfyUI/models/clip_vision'];
  }
  if (searchText.includes('clip')) return ['ComfyUI/models/clip'];
  if (searchText.includes('upscale')) return ['ComfyUI/models/upscale_models'];
  if (searchText.includes('embedding') || searchText.includes('textual inversion')) {
    return ['ComfyUI/models/embeddings'];
  }
  if (searchText.includes('unet') || searchText.includes('diffusion model')) {
    return ['ComfyUI/models/unet', 'ComfyUI/models/checkpoints'];
  }
  if (
    searchText.includes('checkpoint') ||
    searchText.includes('ckpt') ||
    searchText.includes('model_name') ||
    searchText.includes('model name') ||
    searchText.includes('model')
  ) {
    return ['ComfyUI/models/checkpoints'];
  }

  return [];
};

const getMissingWorkflowControlGuidance = (control: ComfyWorkflowControl): string => {
  const installTargets = getComfyModelInstallTargets(control);
  if (installTargets.length > 0) {
    return `Download or restore the missing file, place it in ${installTargets.join(
      ' or ',
    )}, then refresh/restart ComfyUI and reload the workflow.`;
  }

  return 'Choose an available value, or install the missing custom node/model that provides this option, then refresh/restart ComfyUI and reload the workflow.';
};

const getMissingWorkflowControlOption = (
  control: ComfyWorkflowControl,
  workflow: ComfyWorkflow,
): MissingWorkflowControlOption | null => {
  if (!isWorkflowControlSelectedOptionMissing(control)) return null;

  const installTargets = getComfyModelInstallTargets(control);
  if (installTargets.length === 0) return null;

  return {
    control,
    value: String(control.value),
    installTargets,
    guidance: getMissingWorkflowControlGuidance(control),
    downloadUrl: getWorkflowModelDownloadUrl(workflow, control),
  };
};

export const getMissingWorkflowControlOptions = (
  controls: ComfyWorkflowControl[],
  workflow: ComfyWorkflow,
): MissingWorkflowControlOption[] =>
  controls
    .filter((control) => control.workflowId === workflow.id)
    .map((control) => getMissingWorkflowControlOption(control, workflow))
    .filter(
      (missingOption): missingOption is MissingWorkflowControlOption => missingOption !== null,
    );

export const getMissingWorkflowControlStatus = (
  workflowName: string,
  missingOptions: MissingWorkflowControlOption[],
): string => {
  if (missingOptions.length === 0) return `Imported ${workflowName}.`;

  const firstMissing = missingOptions[0];
  const extraCount = missingOptions.length - 1;
  const suffix =
    extraCount > 0 ? ` and ${extraCount} more missing field${extraCount === 1 ? '' : 's'}` : '';
  return `Imported ${workflowName}, but ${firstMissing.control.label} uses unavailable value "${firstMissing.value}"${suffix}. Install the missing model/file or choose an available value before running.`;
};
