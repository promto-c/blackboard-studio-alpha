/**
 * Port mapping utilities for preserving node input connections when the
 * underlying model or workflow changes (ONNX model swap, Comfy workflow swap).
 *
 * Both ONNX and Comfy nodes need to:
 * 1. Keep input port connections whose name still matches the new model/workflow
 * 2. Detect when there is exactly one image/media input and preserve its
 *    connection even if the port name changed (single-reserved-port fallback)
 * 3. Let the inputPorts() reactive hook find the preserved port names
 */

const PIPE_PORT_NAME = 'pipe';

// ---------------------------------------------------------------------------
// ONNX helpers
// ---------------------------------------------------------------------------

/**
 * Determine the port name to use for a single image input on an ONNX node.
 *
 * Priority:
 * 1. If the fallback port name already has a connection → use it
 * 2. If there is exactly one existing port that is NOT in the declared set
 *    (a "reserved" port from a previous model) → reuse that port name
 * 3. Otherwise → use the fallback port name
 */
export const getOnnxInputPortName = (
  node: { inputs?: Record<string, string> },
  declaredPortNames: ReadonlySet<string>,
  fallbackPortName: string,
): string => {
  if (node.inputs?.[fallbackPortName]) return fallbackPortName;

  const reservedPortNames = Object.keys(node.inputs ?? {}).filter(
    (portName) => portName !== PIPE_PORT_NAME && !declaredPortNames.has(portName),
  );
  return reservedPortNames.length === 1 ? reservedPortNames[0] : fallbackPortName;
};

/**
 * Remap ONNX node inputs when the model changes.
 *
 * Preserves connections when:
 * - The port name still exists in the new model
 * - Old ports that don't match by name are mapped to new ports positionally
 *   (first unmatched old port → first unused new port, etc.), so switching
 *   between 2+ input models preserves the wire position even when port names
 *   differ entirely
 */
export const remapInputsOnModelChange = (
  currentInputs: Record<string, string> | undefined,
  newPortNames: string[],
): Record<string, string> | undefined => {
  if (!currentInputs) return undefined;

  const cleanedInputs: Record<string, string> = {};
  const oldUnmatchedPorts: Array<[string, string]> = [];

  // First pass: keep connections whose port name exists in the new model.
  // When newPortNames is empty (metadata not yet loaded), preserve everything
  // as-is so connections aren't dropped during a transient state.
  for (const [port, sourceId] of Object.entries(currentInputs)) {
    if (port === PIPE_PORT_NAME) {
      cleanedInputs[port] = sourceId;
      continue;
    }
    if (newPortNames.length === 0 || newPortNames.includes(port)) {
      cleanedInputs[port] = sourceId;
    } else {
      oldUnmatchedPorts.push([port, sourceId]);
    }
  }

  // Second pass (positional matching): match unmatched old ports to new port
  // names that haven't been claimed yet, in insertion order.
  if (oldUnmatchedPorts.length > 0 && newPortNames.length > 0) {
    const usedPortNames = new Set(Object.keys(cleanedInputs));
    const unmatchedNewPorts = newPortNames.filter((p) => !usedPortNames.has(p));

    for (let i = 0; i < Math.min(oldUnmatchedPorts.length, unmatchedNewPorts.length); i++) {
      const [, sourceId] = oldUnmatchedPorts[i];
      cleanedInputs[unmatchedNewPorts[i]] = sourceId;
    }
  }

  return Object.keys(cleanedInputs).length > 0 ? cleanedInputs : undefined;
};

// ---------------------------------------------------------------------------
// Comfy helpers
// ---------------------------------------------------------------------------

/**
 * Build a deterministic port name for a Comfy workflow input candidate.
 */
const getComfyWorkflowInputPortName = (workflowId: string, candidate: { id: string }): string =>
  `comfy-input:${workflowId}:${candidate.id}`;

/**
 * Determine the port name for a Comfy workflow input, reusing existing
 * connections when possible.
 *
 * Priority:
 * 1. If the canonical port name already exists → use it
 * 2. If an existing port ends with the same candidate ID → reuse that port
 * 3. If allowSingleReservedPort and there's exactly one comfy-input port → reuse it
 * 4. Otherwise → use the canonical port name
 */
export const getComfyInputPortName = (
  workflowId: string,
  candidate: { id: string },
  existingPorts: Iterable<string> | Record<string, unknown> | undefined,
  options: { allowSingleReservedPort?: boolean } = {},
): string => {
  const portName = getComfyWorkflowInputPortName(workflowId, candidate);
  if (!existingPorts) return portName;

  const existingPortNames =
    Symbol.iterator in Object(existingPorts)
      ? [...(existingPorts as Iterable<string>)]
      : Object.keys(existingPorts as Record<string, unknown>);
  if (existingPortNames.includes(portName)) return portName;

  const matchingExistingPort = existingPortNames.find(
    (existingPortName) =>
      existingPortName.startsWith('comfy-input:') && existingPortName.endsWith(`:${candidate.id}`),
  );
  if (matchingExistingPort) return matchingExistingPort;

  if (options.allowSingleReservedPort) {
    const reservedComfyPorts = existingPortNames.filter((existingPortName) =>
      existingPortName.startsWith('comfy-input:'),
    );
    if (reservedComfyPorts.length === 1) return reservedComfyPorts[0];
  }

  return portName;
};

/**
 * Remap Comfy node inputs when the workflow changes.
 *
 * `getComfyInputPortName` handles two cases reactively:
 * 1. Candidate ID matches (via suffix matching)
 * 2. Single reserved port (via allowSingleReservedPort)
 *
 * This function handles the remaining case: when switching between workflows
 * with 2+ input candidates whose IDs don't overlap. It maps old inputs to new
 * candidates positionally (first old port → first new candidate, etc.).
 */
export const remapInputsOnWorkflowChange = (
  currentInputs: Record<string, string> | undefined,
  newWorkflowId: string,
  newCandidates: Array<{ id: string }>,
): Record<string, string> | undefined => {
  if (!currentInputs || newCandidates.length === 0) return undefined;

  const cleanedInputs: Record<string, string> = {};

  // Preserve pipe connection unchanged
  if (currentInputs[PIPE_PORT_NAME]) {
    cleanedInputs[PIPE_PORT_NAME] = currentInputs[PIPE_PORT_NAME];
  }

  const newCandidateIds = new Set(newCandidates.map((c) => c.id));
  const oldUnmatchedComfyInputs: Array<[string, string]> = [];

  // Separate comfy-input ports: those whose candidate ID is still present in
  // the new workflow (will be found by getComfyInputPortName via suffix matching)
  // from those that need positional remapping.
  for (const [port, sourceId] of Object.entries(currentInputs)) {
    if (port === PIPE_PORT_NAME) continue;
    if (!port.startsWith('comfy-input:')) continue;

    const candidateId = port.split(':').pop() ?? '';
    if (newCandidateIds.has(candidateId)) {
      // Keep it as-is — getComfyInputPortName will find it by ID suffix
      cleanedInputs[port] = sourceId;
    } else {
      oldUnmatchedComfyInputs.push([port, sourceId]);
    }
  }

  // Positional matching: assign unmatched old ports to unmatched new candidates
  if (oldUnmatchedComfyInputs.length > 0) {
    const usedPortNames = new Set(Object.keys(cleanedInputs));
    const unmatchedNewPorts = newCandidates
      .map((c) => getComfyWorkflowInputPortName(newWorkflowId, c))
      .filter((p) => !usedPortNames.has(p));

    for (let i = 0; i < Math.min(oldUnmatchedComfyInputs.length, unmatchedNewPorts.length); i++) {
      const [, sourceId] = oldUnmatchedComfyInputs[i];
      cleanedInputs[unmatchedNewPorts[i]] = sourceId;
    }
  }

  return Object.keys(cleanedInputs).length > 0 ? cleanedInputs : undefined;
};
