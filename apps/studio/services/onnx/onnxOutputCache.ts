export interface OnnxOutputCacheEntry {
  data: Float32Array;
  width: number;
  height: number;
  channels: number;
  dims: number[];
}

const onnxOutputTensorCache = new Map<string, OnnxOutputCacheEntry>();

export function setOnnxOutputCache(nodeId: string, entry: OnnxOutputCacheEntry): void {
  onnxOutputTensorCache.set(nodeId, entry);
}

export function getOnnxOutputCache(nodeId: string): OnnxOutputCacheEntry | undefined {
  return onnxOutputTensorCache.get(nodeId);
}

export function clearOnnxOutputCache(nodeId?: string): void {
  if (nodeId) onnxOutputTensorCache.delete(nodeId);
  else onnxOutputTensorCache.clear();
}
