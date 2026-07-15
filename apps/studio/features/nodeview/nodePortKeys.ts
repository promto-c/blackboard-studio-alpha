export const getInputPortKey = (nodeId: string, portName: string): string =>
  `${nodeId}:input:${portName}`;

export const getOutputPortKey = (nodeId: string, portName = 'output'): string =>
  portName === 'output' ? `${nodeId}:output` : `${nodeId}:output:${portName}`;
