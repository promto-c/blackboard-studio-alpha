import type {
  ComfyWorkflowControlValue,
  ComfyWorkflowDynamicInputOption,
  ComfyWorkflowOutputCandidate,
} from '@blackboard/types';

export interface ComfyOutputCandidateNode {
  id: string;
  nodeType: string;
  inputs: Record<string, unknown>;
  dynamicInputs: ComfyWorkflowOutputCandidate['outputNodeDynamicInputs'];
}

export const getComfyOutputCandidateTerminalNode = (candidate: ComfyWorkflowOutputCandidate) =>
  candidate.syntheticOutputNodes?.at(-1);

export const getComfyOutputCandidateNodeType = (candidate: ComfyWorkflowOutputCandidate): string =>
  getComfyOutputCandidateTerminalNode(candidate)?.nodeType ?? candidate.nodeType;

export const getComfyOutputCandidateNodes = (
  candidate: ComfyWorkflowOutputCandidate,
): ComfyOutputCandidateNode[] => {
  if (candidate.syntheticOutputNodes?.length) {
    return candidate.syntheticOutputNodes.map((node) => ({
      ...node,
      dynamicInputs:
        node.id === candidate.previewNodeId ? candidate.outputNodeDynamicInputs : undefined,
    }));
  }
  return [
    {
      id: candidate.previewNodeId,
      nodeType: candidate.nodeType,
      inputs: candidate.outputNodeInputs ?? {},
      dynamicInputs: candidate.outputNodeDynamicInputs,
    },
  ];
};

export const getComfyOutputCandidateInputs = (
  candidate: ComfyWorkflowOutputCandidate,
  nodeId = candidate.previewNodeId,
): Record<string, unknown> =>
  getComfyOutputCandidateNodes(candidate).find((node) => node.id === nodeId)?.inputs ?? {};

const isMatchingComfyDynamicOption = (
  optionKey: string | number,
  selectedValue: unknown,
): boolean => optionKey === selectedValue || String(optionKey) === String(selectedValue);

const isComfyWorkflowControlValue = (value: unknown): value is ComfyWorkflowControlValue =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const getComfyDynamicInputFieldValue = (
  field: ComfyWorkflowDynamicInputOption['fields'][number],
): ComfyWorkflowControlValue | undefined => {
  if (field.defaultValue !== undefined) return field.defaultValue;
  return field.options?.[0];
};

const normalizeComfyDynamicFieldValue = (
  inputs: Record<string, unknown>,
  field: ComfyWorkflowDynamicInputOption['fields'][number],
): void => {
  const existingInputName = field.inputName in inputs ? field.inputName : field.dottedInputName;
  const currentValue = inputs[existingInputName];
  const hasAllowedValue =
    isComfyWorkflowControlValue(currentValue) &&
    (!field.options ||
      field.options.some((option) => isMatchingComfyDynamicOption(option, currentValue)));

  if (hasAllowedValue) {
    if (existingInputName !== field.dottedInputName) {
      delete inputs[existingInputName];
      inputs[field.dottedInputName] = currentValue;
    }
    return;
  }

  delete inputs[field.inputName];
  const fallbackValue = getComfyDynamicInputFieldValue(field);
  if (fallbackValue !== undefined) {
    inputs[field.dottedInputName] = fallbackValue;
  }
};

export const normalizeComfyOutputDynamicInputs = (
  inputs: Record<string, unknown>,
  dynamicInputs: ComfyWorkflowDynamicInputOption[] | undefined,
): Record<string, unknown> => {
  if (!dynamicInputs?.length) return inputs;

  const normalizedInputs = { ...inputs };
  const parentInputNames = new Set(dynamicInputs.map((option) => option.parentInputName));

  for (const parentInputName of parentInputNames) {
    const selectedOption = dynamicInputs.find(
      (option) =>
        option.parentInputName === parentInputName &&
        isMatchingComfyDynamicOption(option.optionKey, normalizedInputs[parentInputName]),
    );

    for (const option of dynamicInputs.filter(
      (entry) => entry.parentInputName === parentInputName,
    )) {
      if (option === selectedOption) continue;
      for (const field of option.fields) {
        delete normalizedInputs[field.inputName];
        delete normalizedInputs[field.dottedInputName];
      }
    }

    for (const field of selectedOption?.fields ?? []) {
      normalizeComfyDynamicFieldValue(normalizedInputs, field);
    }
  }

  return normalizedInputs;
};

export const getNextComfyOutputCandidateInputs = (
  candidate: ComfyWorkflowOutputCandidate,
  nodeId: string,
  inputName: string,
  value: ComfyWorkflowControlValue,
): Record<string, unknown> => {
  const inputs = { ...getComfyOutputCandidateInputs(candidate, nodeId), [inputName]: value };
  const dynamicInputs =
    nodeId === candidate.previewNodeId ? candidate.outputNodeDynamicInputs : undefined;

  if (!dynamicInputs?.some((option) => option.parentInputName === inputName)) {
    return normalizeComfyOutputDynamicInputs(inputs, dynamicInputs);
  }

  for (const option of dynamicInputs.filter((entry) => entry.parentInputName === inputName)) {
    for (const field of option.fields) {
      delete inputs[field.inputName];
      delete inputs[field.dottedInputName];
    }
  }

  const selectedOption = dynamicInputs.find(
    (option) =>
      option.parentInputName === inputName &&
      isMatchingComfyDynamicOption(option.optionKey, inputs[inputName]),
  );

  for (const field of selectedOption?.fields ?? []) {
    const fallbackValue = getComfyDynamicInputFieldValue(field);
    if (fallbackValue !== undefined) {
      inputs[field.dottedInputName] = fallbackValue;
    }
  }

  return normalizeComfyOutputDynamicInputs(inputs, dynamicInputs);
};

export const updateComfyOutputCandidateInputs = (
  candidate: ComfyWorkflowOutputCandidate,
  nodeId: string,
  inputs: Record<string, unknown>,
): ComfyWorkflowOutputCandidate => {
  if (candidate.kind !== 'synthetic') return { ...candidate, outputNodeInputs: inputs };
  if (!candidate.syntheticOutputNodes?.some((node) => node.id === nodeId)) return candidate;
  return {
    ...candidate,
    syntheticOutputNodes: candidate.syntheticOutputNodes?.map((node) =>
      node.id === nodeId ? { ...node, inputs } : node,
    ),
  };
};

export const normalizeComfyOutputCandidate = (
  candidate: ComfyWorkflowOutputCandidate,
): ComfyWorkflowOutputCandidate => {
  if (!candidate.outputNodeDynamicInputs?.length) return candidate;

  if (candidate.kind !== 'synthetic') {
    return {
      ...candidate,
      outputNodeInputs: normalizeComfyOutputDynamicInputs(
        candidate.outputNodeInputs ?? {},
        candidate.outputNodeDynamicInputs,
      ),
    };
  }

  if (!candidate.syntheticOutputNodes?.length) return candidate;
  return {
    ...candidate,
    syntheticOutputNodes: candidate.syntheticOutputNodes.map((node) =>
      node.id === candidate.previewNodeId
        ? {
            ...node,
            inputs: normalizeComfyOutputDynamicInputs(
              node.inputs,
              candidate.outputNodeDynamicInputs,
            ),
          }
        : node,
    ),
  };
};

export const getComfyOutputCandidateControlValues = (
  candidate: ComfyWorkflowOutputCandidate,
): Array<{ nodeId: string; inputName: string; value: ComfyWorkflowControlValue }> =>
  getComfyOutputCandidateNodes(candidate).flatMap((node) =>
    Object.entries(node.inputs).flatMap(([inputName, value]) =>
      isComfyWorkflowControlValue(value) ? [{ nodeId: node.id, inputName, value }] : [],
    ),
  );
