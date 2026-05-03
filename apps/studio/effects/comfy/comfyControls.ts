import {
  ComfyWorkflow,
  ComfyWorkflowControl,
  ComfyWorkflowControlRunMode,
  ComfyWorkflowControlValue,
} from '@blackboard/types';

type JsonObject = Record<string, unknown>;

export interface ComfyWorkflowControlCandidate {
  key: string;
  nodeId: string;
  classType: string;
  inputName: string;
  label: string;
  description: string;
  value: ComfyWorkflowControlValue;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<string | number>;
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isControlValue = (value: unknown): value is ComfyWorkflowControlValue =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const toTitleCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const isSeedLikeComfyInput = (inputName: string): boolean =>
  inputName.toLowerCase().includes('seed');

const normalizeComfyFieldText = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();

const tokenizeComfyFieldText = (value: string): string[] => {
  const normalized = normalizeComfyFieldText(value);
  return normalized ? normalized.split(/\s+/) : [];
};

const PROMPT_EXACT_INPUT_NAMES = new Set([
  'prompt',
  'positive',
  'negative',
  'caption',
  'instruction',
  'instructions',
]);

const PROMPT_SIGNAL_TOKENS = new Set([
  'prompt',
  'positive',
  'negative',
  'caption',
  'instruction',
  'instructions',
]);

const GENERIC_TEXT_EXCLUDE_TOKENS = new Set([
  'api',
  'checkpoint',
  'ckpt',
  'dir',
  'directory',
  'file',
  'filename',
  'folder',
  'id',
  'key',
  'label',
  'link',
  'lora',
  'model',
  'name',
  'path',
  'preset',
  'profile',
  'sampler',
  'scheduler',
  'slug',
  'title',
  'token',
  'uri',
  'url',
  'uuid',
  'vae',
]);

const PROMPT_CONTEXT_PATTERNS = [
  /\bclip\b/,
  /\bconditioning\b/,
  /\bencode\b/,
  /\binstruct/,
  /\bprompt\b/,
  /\btext\s*encode\b/,
];

export const isPromptLikeComfyTextInput = ({
  inputName,
  label,
  classType,
  description,
}: {
  inputName: string;
  label?: string;
  classType?: string;
  description?: string;
}): boolean => {
  const normalizedInputName = normalizeComfyFieldText(inputName);
  const inputTokens = tokenizeComfyFieldText(inputName);
  const metadataTokens = new Set(
    [label, classType, description].flatMap((value) => tokenizeComfyFieldText(value ?? '')),
  );
  const metadataText = normalizeComfyFieldText([label, classType, description].join(' '));

  let score = 0;

  if (PROMPT_EXACT_INPUT_NAMES.has(normalizedInputName)) {
    score += 3;
  }

  if (inputTokens.includes('text')) {
    score += 1;
  }

  inputTokens.forEach((token) => {
    if (PROMPT_SIGNAL_TOKENS.has(token)) score += 2;
    if (GENERIC_TEXT_EXCLUDE_TOKENS.has(token)) score -= 3;
  });

  metadataTokens.forEach((token) => {
    if (GENERIC_TEXT_EXCLUDE_TOKENS.has(token)) score -= 1;
  });

  if (PROMPT_CONTEXT_PATTERNS.some((pattern) => pattern.test(metadataText))) {
    score += 2;
  }

  return score >= 3;
};

const getNumericRange = (
  value: number,
  inputName: string,
): Pick<ComfyWorkflowControlCandidate, 'min' | 'max' | 'step'> => {
  if (isSeedLikeComfyInput(inputName)) {
    return { min: 0, max: 999_999_999_999, step: 1 };
  }

  if (Number.isInteger(value)) {
    return {
      min: Math.min(0, value < 0 ? value * 2 : 0),
      max: Math.max(10, value * 2),
      step: 1,
    };
  }

  if (value >= 0 && value <= 1) {
    return { min: 0, max: 1, step: 0.01 };
  }

  const magnitude = Math.max(1, Math.ceil(Math.abs(value)));
  return {
    min: value < 0 ? -magnitude * 2 : 0,
    max: magnitude * 2,
    step: 0.1,
  };
};

export const getComfyControlKey = (nodeId: string, inputName: string): string =>
  `${nodeId}:${inputName}`;

export const getComfyControlDescription = ({
  classType,
  nodeId,
  inputName,
}: Pick<ComfyWorkflowControl, 'classType' | 'nodeId' | 'inputName'>): string =>
  `${classType ?? 'Comfy node'} · #${nodeId} · ${inputName}`;

export const getComfyWorkflowControlCandidates = (
  workflow: ComfyWorkflow | null,
): ComfyWorkflowControlCandidate[] => {
  if (!workflow) return [];
  const optionsByControlKey = new Map(
    (workflow.controlOptions ?? []).map((entry) => [
      getComfyControlKey(entry.nodeId, entry.inputName),
      entry.options,
    ]),
  );

  return Object.entries(workflow.prompt)
    .flatMap(([nodeId, promptNode]) => {
      if (!isJsonObject(promptNode) || typeof promptNode.class_type !== 'string') return [];
      const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};

      return Object.entries(inputs)
        .filter((entry): entry is [string, ComfyWorkflowControlValue] => {
          const [, value] = entry;
          return isControlValue(value);
        })
        .map(([inputName, value]) => {
          const range = typeof value === 'number' ? getNumericRange(value, inputName) : {};

          return {
            key: getComfyControlKey(nodeId, inputName),
            nodeId,
            classType: promptNode.class_type as string,
            inputName,
            label: toTitleCase(inputName),
            description: getComfyControlDescription({
              classType: promptNode.class_type as string,
              nodeId,
              inputName,
            }),
            value,
            options: optionsByControlKey.get(getComfyControlKey(nodeId, inputName)),
            ...range,
          };
        });
    })
    .sort((a, b) => {
      const classCompare = a.classType.localeCompare(b.classType);
      if (classCompare !== 0) return classCompare;
      return a.inputName.localeCompare(b.inputName);
    });
};

export const createComfyWorkflowControl = (
  workflowId: string,
  candidate: ComfyWorkflowControlCandidate,
): ComfyWorkflowControl => {
  const isInteger = typeof candidate.value === 'number' && Number.isInteger(candidate.value);
  const isAutoRandomSeed = isInteger && isSeedLikeComfyInput(candidate.inputName);

  return {
    id: `comfy_control_${workflowId}_${candidate.nodeId}_${candidate.inputName}`.replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    ),
    workflowId,
    nodeId: candidate.nodeId,
    classType: candidate.classType,
    inputName: candidate.inputName,
    label: candidate.label,
    description: candidate.description,
    value: candidate.value,
    defaultValue: candidate.value,
    min: candidate.min,
    max: candidate.max,
    step: candidate.step,
    options: candidate.options,
    runMode: isAutoRandomSeed ? 'randomize' : undefined,
    randomMin: isInteger ? candidate.min : undefined,
    randomMax: isInteger ? candidate.max : undefined,
    incrementStep: isInteger ? (candidate.step ?? 1) : undefined,
  };
};

export const supportsComfyWorkflowControlRunMode = (control: ComfyWorkflowControl): boolean =>
  typeof control.defaultValue === 'number' &&
  Number.isFinite(control.defaultValue) &&
  Number.isInteger(control.defaultValue) &&
  typeof control.value === 'number' &&
  Number.isFinite(control.value);

export const getComfyWorkflowControlRunMode = (
  control: ComfyWorkflowControl,
): ComfyWorkflowControlRunMode => {
  if (!supportsComfyWorkflowControlRunMode(control)) return 'fixed';
  if (control.runMode) return control.runMode;
  return isSeedLikeComfyInput(control.inputName) ? 'randomize' : 'fixed';
};

const toInteger = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? Math.trunc(value) : fallback;

const getControlRange = (control: ComfyWorkflowControl): { min: number; max: number } => {
  const value = typeof control.value === 'number' ? control.value : 0;
  const min =
    typeof control.min === 'number' && Number.isFinite(control.min)
      ? control.min
      : Math.min(0, value);
  const max =
    typeof control.max === 'number' && Number.isFinite(control.max)
      ? control.max
      : Math.max(10, value);
  return min <= max ? { min, max } : { min: max, max: min };
};

const randomInteger = (min: number, max: number): number => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  if (lower >= upper) return lower;
  return lower + Math.floor(Math.random() * (upper - lower + 1));
};

export const prepareComfyWorkflowControlsForRun = (
  controls: ComfyWorkflowControl[] | undefined,
  workflowId: string,
): {
  promptControls: ComfyWorkflowControl[];
  nextControls: ComfyWorkflowControl[];
  changed: boolean;
} => {
  let changed = false;

  const nextControls = (controls ?? []).map((control) => {
    if (control.workflowId !== workflowId || !supportsComfyWorkflowControlRunMode(control)) {
      return control;
    }

    const mode = getComfyWorkflowControlRunMode(control);
    if (mode === 'fixed') return control;

    const currentValue = toInteger(control.value as number);

    if (mode === 'increment') {
      const step = toInteger(control.incrementStep ?? control.step ?? 1) || 1;
      changed = true;
      return {
        ...control,
        value: currentValue + step,
      };
    }

    const fullRange = getControlRange(control);
    const range = {
      min:
        typeof control.randomMin === 'number' && Number.isFinite(control.randomMin)
          ? control.randomMin
          : fullRange.min,
      max:
        typeof control.randomMax === 'number' && Number.isFinite(control.randomMax)
          ? control.randomMax
          : fullRange.max,
    };
    const value = randomInteger(range.min, range.max);
    changed = changed || value !== control.value;
    return {
      ...control,
      value,
    };
  });

  const promptControls = (controls ?? []).map((control) => {
    if (control.workflowId !== workflowId || !supportsComfyWorkflowControlRunMode(control)) {
      return control;
    }

    const mode = getComfyWorkflowControlRunMode(control);
    if (mode === 'increment') {
      return {
        ...control,
        value: toInteger(control.value as number),
      };
    }

    const nextControl = nextControls.find((candidate) => candidate.id === control.id);
    return nextControl ?? control;
  });

  return { promptControls, nextControls, changed };
};

const clonePrompt = (prompt: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(prompt)) as Record<string, unknown>;

export const applyComfyWorkflowControls = (
  prompt: Record<string, unknown>,
  controls: ComfyWorkflowControl[] | undefined,
  workflowId: string,
): Record<string, unknown> => {
  const nextPrompt = clonePrompt(prompt);

  for (const control of controls ?? []) {
    if (control.workflowId !== workflowId) continue;

    const promptNode = nextPrompt[control.nodeId];
    if (!isJsonObject(promptNode)) continue;

    const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
    promptNode.inputs = inputs;
    inputs[control.inputName] = control.value;
  }

  return nextPrompt;
};
