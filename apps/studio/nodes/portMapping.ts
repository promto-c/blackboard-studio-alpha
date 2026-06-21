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
 * Positional matching: assign unmatched old port connections to new port names
 * that haven't been claimed yet, in insertion order.
 *
 * Modifies `cleanedInputs` in place by adding entries for each matched pair.
 * Old ports beyond the count of new port names (or vice versa) are dropped.
 */
function assignUnmatchedPortsPositionally(
  cleanedInputs: Record<string, string>,
  oldUnmatchedPorts: Array<[string, string]>,
  unmatchedNewPorts: string[],
): void {
  const count = Math.min(oldUnmatchedPorts.length, unmatchedNewPorts.length);
  for (let i = 0; i < count; i++) {
    cleanedInputs[unmatchedNewPorts[i]] = oldUnmatchedPorts[i][1];
  }
}

/**
 * Generic remap: separate existing input ports into matched/unmatched, then
 * positionally remap unmatched ports to new port names.
 *
 * @param currentInputs - Current port→sourceNodeId map (or undefined).
 * @param isMatch - Returns true when an existing port name matches a new candidate.
 *                  Matched ports are kept as-is.
 * @param getNewPortNames - Returns the list of new port names that haven't been
 *                          claimed yet (usedNames are already in cleanedInputs).
 *                          Each unmatched old port is paired with the next unused
 *                          new port name positionally.
 */
function remapInputsGeneric(
  currentInputs: Record<string, string> | undefined,
  isMatch: (port: string) => boolean,
  getNewPortNames: (usedNames: Set<string>) => string[],
): Record<string, string> | undefined {
  if (!currentInputs) return undefined;

  const cleanedInputs: Record<string, string> = {};
  const oldUnmatchedPorts: Array<[string, string]> = [];

  for (const [port, sourceId] of Object.entries(currentInputs)) {
    if (port === PIPE_PORT_NAME) {
      cleanedInputs[port] = sourceId;
      continue;
    }
    if (isMatch(port)) {
      cleanedInputs[port] = sourceId;
    } else {
      oldUnmatchedPorts.push([port, sourceId]);
    }
  }

  if (oldUnmatchedPorts.length > 0) {
    const usedPortNames = new Set(Object.keys(cleanedInputs));
    const unmatchedNewPorts = getNewPortNames(usedPortNames);
    if (unmatchedNewPorts.length > 0) {
      assignUnmatchedPortsPositionally(cleanedInputs, oldUnmatchedPorts, unmatchedNewPorts);
    }
  }

  return Object.keys(cleanedInputs).length > 0 ? cleanedInputs : undefined;
}

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
  // When metadata not yet loaded, preserve everything — connections aren't
  // dropped during a transient state.
  if (newPortNames.length === 0) return currentInputs;

  return remapInputsGeneric(
    currentInputs,
    (port) => newPortNames.includes(port),
    (usedNames) => newPortNames.filter((p) => !usedNames.has(p)),
  );
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
  existingPortNames: readonly string[] | undefined,
  options: { allowSingleReservedPort?: boolean } = {},
): string => {
  const portName = getComfyWorkflowInputPortName(workflowId, candidate);
  if (!existingPortNames || existingPortNames.length === 0) return portName;

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
  if (!currentInputs) return undefined;
  // Preserve existing connections when there are no input candidates yet.
  // Prevents connections from being dropped when the workflow is cleared
  // or switched to one without inputs.
  if (newCandidates.length === 0) return currentInputs;

  const newCandidateIds = new Set(newCandidates.map((c) => c.id));
  return remapInputsGeneric(
    currentInputs,
    // A port matches when it's a comfy-input: port whose candidate ID suffix
    // still exists in the new workflow. Non-comfy ports (e.g. auto-connected
    // 'image') and stale comfy-input ports go to unmatched for remapping.
    (port) => port.startsWith('comfy-input:') && newCandidateIds.has(port.split(':').pop() ?? ''),
    // Build new port names from candidates, skipping those already claimed.
    (usedNames) =>
      newCandidates
        .map((c) => getComfyWorkflowInputPortName(newWorkflowId, c))
        .filter((p) => !usedNames.has(p)),
  );
};
