import type {
  ComfyWorkflowDynamicInputOption,
  ComfyWorkflowControlOptions,
  ComfyWorkflowInputCandidate,
  ComfyWorkflowOutputCandidate,
  ComfyWorkflowSyntheticOutputNode,
} from '@blackboard/types';
import { isJsonObject } from '@/utils/guards';
import { normalizeComfyType } from '@/utils/comfyUtils';

export const DEFAULT_COMFY_ENDPOINT = 'http://127.0.0.1:8188';

export interface ComfyOutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
  nodeId?: string;
  kind?: 'image' | 'video' | '3d';
}

export interface ComfyPromptQueueResult {
  promptId: string;
  number?: number;
}

export interface ComfyProgressEvent {
  type: 'started' | 'executing' | 'progress' | 'complete' | 'error';
  promptId?: string;
  nodeId?: string | null;
  value?: number;
  max?: number;
  message?: string;
}

export type ComfyPromptStatus =
  | { status: 'queued' | 'running' }
  | { status: 'success'; outputs: ComfyOutputFile[] }
  | { status: 'error'; message: string }
  | { status: 'missing' };

export interface ComfyWorkflowFile {
  path: string;
  size?: number;
  modified?: number;
}

export interface ComfyImageWorkflowMetadata {
  prompt?: unknown;
  workflow?: unknown;
  parameters?: string;
  source: 'png' | 'webp' | 'exif' | 'unknown';
}

type JsonObject = Record<string, unknown>;
type ComfyObjectInfo = Record<string, JsonObject>;
type GraphNodeId = string | number;

interface ComfyGraphInput {
  name: string;
  label?: string;
  localized_name?: string;
  type?: string;
  link?: number | string | null;
  widget?: { name?: string };
}

interface ComfyGraphOutput {
  name?: string;
  type?: string;
  links?: Array<number | string> | null;
}

interface ComfyGraphNode {
  id: GraphNodeId;
  type: string;
  mode?: number;
  order?: number;
  inputs?: ComfyGraphInput[];
  outputs?: ComfyGraphOutput[];
  widgets_values?: unknown[] | Record<string, unknown>;
}

interface ComfyGraphLink {
  id: number | string;
  originId: GraphNodeId;
  originSlot: number;
  targetId: GraphNodeId;
  targetSlot: number;
}

interface ComfyGraphContext {
  graph: JsonObject;
  linksById: Map<string, ComfyGraphLink>;
  nodesById: Map<string, ComfyGraphNode>;
  objectInfo: ComfyObjectInfo;
  prompt: JsonObject;
  subgraphsById: Map<string, JsonObject>;
  expandedSubgraphs: Set<string>;
  unsupportedNodeTypes: Set<string>;
  prefix: string;
  parent?: ComfyGraphContext;
  wrapperNode?: ComfyGraphNode;
}

type PromptLink = [string, number];

const previewImageNodeType = 'PreviewImage';
const knownComfyOutputNodeTypes = new Set([previewImageNodeType, 'SaveImage']);
const syntheticPreviewNodePrefix = 'blackboard_preview';
const syntheticExrNodePrefix = 'blackboard_exr';
const synthetic3DNodePrefix = 'blackboard_3d';
const preferredExrOutputNodeTypes = ['SaveImageAdvanced', 'SaveEXR'];
const seedControlWidgetValues = new Set(['fixed', 'increment', 'decrement', 'randomize']);
const primitiveWidgetInputTypes = new Set(['INT', 'FLOAT', 'BOOLEAN', 'STRING', 'COMBO']);
const passthroughGraphNodeTypes = new Set(['Reroute']);
const ignorableGraphSinkNodeTypes = new Set(['PreviewAny']);
const imageOutputTypes = new Set(['IMAGE', 'IMAGES', 'IMAGE_LIST']);
const model3DOutputTypes = new Set(['MESH', 'SPLAT']);

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export const normalizeComfyEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim() || DEFAULT_COMFY_ENDPOINT;
  return trimmed.replace(/\/+$/, '');
};

const parseComfyEndpointUrl = (endpoint: string): URL => {
  const normalizedEndpoint = normalizeComfyEndpoint(endpoint);
  let url: URL;
  try {
    url = new URL(normalizedEndpoint);
  } catch {
    throw new Error(
      `ComfyUI endpoint must be a full http:// or https:// URL, for example ${DEFAULT_COMFY_ENDPOINT}.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `ComfyUI endpoint must use http:// or https://, for example ${DEFAULT_COMFY_ENDPOINT}.`,
    );
  }

  if (!url.hostname) {
    throw new Error(`ComfyUI endpoint must include a host, for example ${DEFAULT_COMFY_ENDPOINT}.`);
  }

  return url;
};

const buildComfyUrl = (endpoint: string, path: string, params?: URLSearchParams): string => {
  const endpointUrl = parseComfyEndpointUrl(endpoint);
  const normalizedEndpoint = endpointUrl.toString().replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const query = params?.toString();
  return `${normalizedEndpoint}${normalizedPath}${query ? `?${query}` : ''}`;
};

export const buildComfyWebSocketUrl = (endpoint: string, clientId: string): string => {
  const url = new URL(buildComfyUrl(endpoint, '/ws', new URLSearchParams({ clientId })));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const getErrorMessageFromBody = (body: unknown, fallback: string): string => {
  if (typeof body === 'string' && body.trim()) return body;
  if (typeof body === 'object' && body !== null) {
    const bodyObject = body as { error?: unknown; message?: unknown };
    const message = bodyObject.error ?? bodyObject.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const getErrorMessage = async (response: Response, fallback: string): Promise<string> =>
  getErrorMessageFromBody(await readJson(response), fallback);

const getBrowserConnectionErrorMessage = (endpoint: string): string =>
  [
    `Browser could not reach ComfyUI at ${normalizeComfyEndpoint(endpoint)}.`,
    'Check that the server is running and the endpoint is correct. If the browser console mentions CORS or Access-Control-Allow-Origin, restart ComfyUI with CORS enabled for the Studio origin.',
  ].join(' ');

const isLikelyComfyObjectInfo = (value: unknown): value is JsonObject =>
  isJsonObject(value) &&
  Object.values(value).some((entry) => {
    return isJsonObject(entry) && isJsonObject(entry.input);
  });

const isLikelyComfySystemStats = (value: unknown): value is JsonObject =>
  isJsonObject(value) && (isJsonObject(value.system) || Array.isArray(value.devices));

const fetchComfy = async (
  endpoint: string,
  path: string,
  init?: RequestInit,
  params?: URLSearchParams,
): Promise<Response> => {
  const url = buildComfyUrl(endpoint, path, params);
  try {
    return await fetch(url, { ...init, cache: 'no-cache' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(getBrowserConnectionErrorMessage(endpoint));
  }
};

const fetchComfyView = async (
  endpoint: string,
  params: URLSearchParams,
  init?: RequestInit,
): Promise<Response> => {
  const url = buildComfyUrl(endpoint, '/view', params);
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(getBrowserConnectionErrorMessage(endpoint));
  }
};

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const utf8Decoder = new TextDecoder('utf-8');
const latin1Decoder = new TextDecoder('latin1');

const readUint32 = (view: DataView, offset: number, littleEndian = false): number =>
  view.getUint32(offset, littleEndian);

const readAscii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

const isPngBytes = (bytes: Uint8Array): boolean =>
  pngSignature.every((byte, index) => bytes[index] === byte);

const isWebpBytes = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP';

const isJpegBytes = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === 0xd8;

const findNullByte = (bytes: Uint8Array, start: number, end = bytes.length): number => {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] === 0) return index;
  }
  return -1;
};

const inflateBytes = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  if (typeof DecompressionStream === 'undefined') return null;

  try {
    // Ensure we pass an ArrayBufferView backed by a real ArrayBuffer (not SharedArrayBuffer)
    const chunk = bytes.slice();
    const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
};

const parseJsonText = (value: string | undefined): unknown => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
};

const parsePngTextChunks = async (bytes: Uint8Array): Promise<Map<string, string>> => {
  const chunks = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = pngSignature.length;

  while (offset + 12 <= bytes.length) {
    const length = readUint32(view, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    if (dataEnd + 4 > bytes.length) break;
    const data = bytes.slice(dataOffset, dataEnd);

    if (type === 'tEXt') {
      const separator = findNullByte(data, 0);
      if (separator > 0) {
        const key = latin1Decoder.decode(data.slice(0, separator));
        const text = latin1Decoder.decode(data.slice(separator + 1));
        chunks.set(key, text);
      }
    } else if (type === 'zTXt') {
      const separator = findNullByte(data, 0);
      if (separator > 0 && data[separator + 1] === 0) {
        const inflated = await inflateBytes(data.slice(separator + 2));
        if (inflated) {
          chunks.set(
            latin1Decoder.decode(data.slice(0, separator)),
            latin1Decoder.decode(inflated),
          );
        }
      }
    } else if (type === 'iTXt') {
      const separator = findNullByte(data, 0);
      if (separator > 0 && separator + 2 < data.length) {
        const key = utf8Decoder.decode(data.slice(0, separator));
        const compressed = data[separator + 1] === 1;
        let textOffset = separator + 3;
        const languageEnd = findNullByte(data, textOffset);
        if (languageEnd !== -1) {
          textOffset = languageEnd + 1;
          const translatedEnd = findNullByte(data, textOffset);
          if (translatedEnd !== -1) {
            textOffset = translatedEnd + 1;
            const textBytes = data.slice(textOffset);
            const decodedBytes = compressed ? await inflateBytes(textBytes) : textBytes;
            if (decodedBytes) chunks.set(key, utf8Decoder.decode(decodedBytes));
          }
        }
      }
    }

    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }

  return chunks;
};

const getTiffValueByteLength = (type: number, count: number): number => {
  const bytesPerValue =
    type === 1 || type === 2 || type === 7
      ? 1
      : type === 3
        ? 2
        : type === 4 || type === 9
          ? 4
          : type === 5 || type === 10
            ? 8
            : 0;
  return bytesPerValue * count;
};

const readTiffStringValue = ({
  bytes,
  view,
  tiffOffset,
  entryOffset,
  littleEndian,
}: {
  bytes: Uint8Array;
  view: DataView;
  tiffOffset: number;
  entryOffset: number;
  littleEndian: boolean;
}): string | null => {
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  if (count === 0 || (type !== 2 && type !== 7 && type !== 1)) return null;

  const byteLength = getTiffValueByteLength(type, count);
  const valueOffset =
    byteLength <= 4 ? entryOffset + 8 : tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
  if (valueOffset < 0 || valueOffset + byteLength > bytes.length) return null;

  let valueBytes = bytes.slice(valueOffset, valueOffset + byteLength);
  if (type === 7 && valueBytes.length >= 8) {
    const userCommentPrefix = readAscii(valueBytes, 0, 8).replace(/\0/g, '').trim();
    if (userCommentPrefix === 'ASCII' || userCommentPrefix === 'UNICODE') {
      valueBytes = valueBytes.slice(8);
    }
  }
  const nullIndex = findNullByte(valueBytes, 0);
  if (nullIndex >= 0) valueBytes = valueBytes.slice(0, nullIndex);

  let text = utf8Decoder.decode(valueBytes).trim();
  if (text.startsWith('UNICODE')) text = text.slice('UNICODE'.length).replace(/\0/g, '').trim();
  if (text.startsWith('ASCII')) text = text.slice('ASCII'.length).replace(/\0/g, '').trim();
  return text || null;
};

const parseExifTextFields = (bytes: Uint8Array): Map<string, string> => {
  const fields = new Map<string, string>();
  const exifOffset =
    readAscii(bytes, 0, 6) === 'Exif\0\0'
      ? 6
      : readAscii(bytes, 0, 4) === 'Exif'
        ? findNullByte(bytes, 0, Math.min(bytes.length, 16)) + 1
        : 0;
  const tiffOffset = exifOffset > 0 ? exifOffset : 0;
  if (tiffOffset + 8 > bytes.length) return fields;

  const byteOrder = readAscii(bytes, tiffOffset, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return fields;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 42) return fields;

  const parseIfd = (ifdRelativeOffset: number, labelPrefix = ''): void => {
    const ifdOffset = tiffOffset + ifdRelativeOffset;
    if (ifdOffset + 2 > bytes.length) return;
    const entryCount = view.getUint16(ifdOffset, littleEndian);
    const entriesOffset = ifdOffset + 2;
    if (entriesOffset + entryCount * 12 > bytes.length) return;

    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = entriesOffset + index * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      if (tag === 0x8769) {
        parseIfd(view.getUint32(entryOffset + 8, littleEndian), 'Exif');
        continue;
      }

      const value = readTiffStringValue({
        bytes,
        view,
        tiffOffset,
        entryOffset,
        littleEndian,
      });
      if (!value) continue;

      if (tag === 0x010e) fields.set(`${labelPrefix}ImageDescription`, value);
      if (tag === 0x010f) fields.set(`${labelPrefix}Make`, value);
      if (tag === 0x9286) fields.set(`${labelPrefix}UserComment`, value);
    }
  };

  parseIfd(view.getUint32(tiffOffset + 4, littleEndian));
  return fields;
};

const parseWebpMetadataChunks = (bytes: Uint8Array): Map<string, string> => {
  const fields = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const type = readAscii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    if (dataEnd > bytes.length) break;

    const data = bytes.slice(dataOffset, dataEnd);
    if (type === 'EXIF') {
      parseExifTextFields(data).forEach((value, key) => fields.set(key, value));
    } else if (type === 'XMP ') {
      fields.set('xmp', utf8Decoder.decode(data));
    }

    offset = dataEnd + (length % 2);
  }

  return fields;
};

const parseJpegMetadataChunks = (bytes: Uint8Array): Map<string, string> => {
  const fields = new Map<string, string>();
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > bytes.length) break;

    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const dataOffset = offset + 2;
    const dataEnd = offset + length;
    if (length < 2 || dataEnd > bytes.length) break;

    if (marker === 0xe1) {
      parseExifTextFields(bytes.slice(dataOffset, dataEnd)).forEach((value, key) =>
        fields.set(key, value),
      );
    }

    offset = dataEnd;
  }

  return fields;
};

const assignComfyMetadataField = (
  metadata: ComfyImageWorkflowMetadata,
  key: string,
  value: string,
): void => {
  const normalizedKey = key.toLowerCase();
  const parsed = parseJsonText(value);

  if (normalizedKey === 'workflow' || normalizedKey.endsWith('imagedescription')) {
    metadata.workflow = parsed ?? metadata.workflow;
    return;
  }

  if (normalizedKey === 'prompt' || normalizedKey.endsWith('make')) {
    metadata.prompt = parsed ?? metadata.prompt;
    return;
  }

  if (normalizedKey === 'parameters' || normalizedKey.endsWith('usercomment')) {
    metadata.parameters = value;
  }
};

export const extractComfyImageWorkflowMetadata = async (
  image: Blob,
): Promise<ComfyImageWorkflowMetadata> => {
  const bytes = new Uint8Array(await image.arrayBuffer());
  const metadata: ComfyImageWorkflowMetadata = { source: 'unknown' };
  const textFields = isPngBytes(bytes)
    ? await parsePngTextChunks(bytes)
    : isWebpBytes(bytes)
      ? parseWebpMetadataChunks(bytes)
      : isJpegBytes(bytes)
        ? parseJpegMetadataChunks(bytes)
        : parseExifTextFields(bytes);

  metadata.source = isPngBytes(bytes) ? 'png' : isWebpBytes(bytes) ? 'webp' : 'exif';
  textFields.forEach((value, key) => assignComfyMetadataField(metadata, key, value));
  return metadata;
};

export const extractComfyWorkflowFromImage = async (
  image: Blob,
  options?: { preferPrompt?: boolean },
): Promise<unknown> => {
  const metadata = await extractComfyImageWorkflowMetadata(image);
  const workflow = options?.preferPrompt
    ? (metadata.prompt ?? metadata.workflow)
    : (metadata.workflow ?? metadata.prompt);
  if (workflow !== undefined) return workflow;
  throw new Error('Could not find ComfyUI workflow metadata in this image.');
};

const toGraphNodeId = (value: unknown): GraphNodeId | null =>
  typeof value === 'string' || typeof value === 'number' ? value : null;

const toNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const getGraphNodes = (graph: JsonObject): ComfyGraphNode[] =>
  Array.isArray(graph.nodes)
    ? graph.nodes.filter((node): node is ComfyGraphNode => {
        return (
          isJsonObject(node) && toGraphNodeId(node.id) !== null && typeof node.type === 'string'
        );
      })
    : [];

const getGraphLinks = (graph: JsonObject): ComfyGraphLink[] => {
  const extra = isJsonObject(graph.extra) ? graph.extra : null;
  const links = Array.isArray(graph.links)
    ? graph.links
    : extra && Array.isArray(extra.links)
      ? extra.links
      : [];

  return links
    .map((link): ComfyGraphLink | null => {
      if (Array.isArray(link)) {
        const [id, originId, originSlot, targetId, targetSlot] = link;
        const parsedOriginId = toGraphNodeId(originId);
        const parsedTargetId = toGraphNodeId(targetId);
        const parsedOriginSlot = toNumber(originSlot);
        const parsedTargetSlot = toNumber(targetSlot);
        if (
          parsedOriginId === null ||
          parsedTargetId === null ||
          parsedOriginSlot === null ||
          parsedTargetSlot === null ||
          (typeof id !== 'number' && typeof id !== 'string')
        ) {
          return null;
        }
        return {
          id,
          originId: parsedOriginId,
          originSlot: parsedOriginSlot,
          targetId: parsedTargetId,
          targetSlot: parsedTargetSlot,
        };
      }

      if (!isJsonObject(link)) return null;
      const originId = toGraphNodeId(link.origin_id);
      const targetId = toGraphNodeId(link.target_id);
      const originSlot = toNumber(link.origin_slot);
      const targetSlot = toNumber(link.target_slot);
      if (
        originId === null ||
        targetId === null ||
        originSlot === null ||
        targetSlot === null ||
        (typeof link.id !== 'number' && typeof link.id !== 'string')
      ) {
        return null;
      }
      return {
        id: link.id,
        originId,
        originSlot,
        targetId,
        targetSlot,
      };
    })
    .filter((link): link is ComfyGraphLink => link !== null);
};

export const isComfyGraphWorkflow = (value: unknown): value is JsonObject => {
  if (!isJsonObject(value) || !Array.isArray(value.nodes)) return false;
  const extra = isJsonObject(value.extra) ? value.extra : null;
  return Array.isArray(value.links) || (extra !== null && Array.isArray(extra.links));
};

const getSubgraphsById = (workflow: JsonObject): Map<string, JsonObject> => {
  const definitions = isJsonObject(workflow.definitions) ? workflow.definitions : null;
  const subgraphs =
    definitions && Array.isArray(definitions.subgraphs) ? definitions.subgraphs : [];
  return new Map(
    subgraphs
      .filter((subgraph): subgraph is JsonObject => {
        return isJsonObject(subgraph) && typeof subgraph.id === 'string';
      })
      .map((subgraph) => [String(subgraph.id), subgraph]),
  );
};

const getObjectInfoInputSections = (info: JsonObject): JsonObject => {
  const input = isJsonObject(info.input) ? info.input : {};
  return input;
};

const getOrderedInputNames = (info: JsonObject): string[] => {
  const input = getObjectInfoInputSections(info);
  const inputOrder = isJsonObject(info.input_order) ? info.input_order : null;
  const names: string[] = [];

  for (const section of ['required', 'optional']) {
    const sectionInputs = input[section];
    const orderedNames = inputOrder?.[section];
    if (Array.isArray(orderedNames)) {
      names.push(...orderedNames.filter((name): name is string => typeof name === 'string'));
    }

    if (isJsonObject(sectionInputs)) {
      for (const inputName of Object.keys(sectionInputs)) {
        if (!names.includes(inputName)) names.push(inputName);
      }
    }
  }

  return names;
};

const getInputNamesForSection = (info: JsonObject, section: 'required' | 'optional'): string[] => {
  const input = getObjectInfoInputSections(info);
  const inputOrder = isJsonObject(info.input_order) ? info.input_order : null;
  const orderedNames = inputOrder?.[section];
  const names = Array.isArray(orderedNames)
    ? orderedNames.filter((name): name is string => typeof name === 'string')
    : [];
  const seen = new Set(names);
  const sectionInputs = input[section];
  if (isJsonObject(sectionInputs)) {
    for (const inputName of Object.keys(sectionInputs)) {
      if (!seen.has(inputName)) {
        names.push(inputName);
        seen.add(inputName);
      }
    }
  }

  return names;
};

const getRequiredInputNames = (info: JsonObject): string[] =>
  getInputNamesForSection(info, 'required');

const getObjectInfoInputDefinition = (info: JsonObject, name: string): unknown => {
  const input = getObjectInfoInputSections(info);
  for (const section of ['required', 'optional']) {
    const sectionInputs = input[section];
    if (isJsonObject(sectionInputs) && name in sectionInputs) {
      return sectionInputs[name];
    }
  }
  return undefined;
};

const getInputDefinitionType = (definition: unknown): string | null => {
  if (!Array.isArray(definition) || definition.length === 0) return null;
  return typeof definition[0] === 'string' ? definition[0] : null;
};

const getInputDefinitionConfig = (definition: unknown): JsonObject => {
  if (!Array.isArray(definition)) return {};
  return isJsonObject(definition[1]) ? definition[1] : {};
};

const getInputDefinitionOptions = (definition: unknown): unknown[] => {
  const config = getInputDefinitionConfig(definition);
  return Array.isArray(config.options) ? config.options : [];
};

const isDynamicComboInputDefinition = (definition: unknown): boolean =>
  getInputDefinitionType(definition) === 'COMFY_DYNAMICCOMBO_V3';

const getDynamicComboOption = (definition: unknown, value: unknown): JsonObject | null => {
  for (const option of getInputDefinitionOptions(definition)) {
    if (!isJsonObject(option)) continue;
    if (option.key === value) return option;
  }
  return null;
};

const getDynamicComboOptionInputNames = (option: JsonObject): string[] => {
  const optionInputs = isJsonObject(option.inputs) ? option.inputs : {};
  const names: string[] = [];

  for (const section of ['required', 'optional']) {
    const sectionInputs = optionInputs[section];
    if (isJsonObject(sectionInputs)) {
      names.push(...Object.keys(sectionInputs));
    }
  }

  return names;
};

const getDynamicComboOptionInputDefinitions = (option: JsonObject): Map<string, unknown> => {
  const optionInputs = isJsonObject(option.inputs) ? option.inputs : {};
  const definitions = new Map<string, unknown>();

  for (const section of ['required', 'optional']) {
    const sectionInputs = optionInputs[section];
    if (!isJsonObject(sectionInputs)) continue;

    for (const [name, definition] of Object.entries(sectionInputs)) {
      definitions.set(name, definition);
    }
  }

  return definitions;
};

const getPromptInputNameForGraphInput = (_info: JsonObject, graphInputName: string): string =>
  graphInputName;

const isWidgetInputDefinition = (definition: unknown): boolean => {
  if (!Array.isArray(definition) || definition.length === 0) return false;

  const inputType = definition[0];
  const config = getInputDefinitionConfig(definition);

  if (Array.isArray(inputType)) return true;
  if (typeof inputType !== 'string') return false;
  if (primitiveWidgetInputTypes.has(inputType)) return true;

  return Array.isArray(config.options);
};

const getGraphWidgetInputNames = (node: ComfyGraphNode): string[] =>
  (node.inputs ?? [])
    .filter((input) => input.widget !== undefined)
    .map((input) => input.widget?.name ?? input.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

const getWidgetInputNames = (_node: ComfyGraphNode, info: JsonObject): string[] =>
  getOrderedInputNames(info).filter((name) => {
    const definition = getObjectInfoInputDefinition(info, name);
    return isWidgetInputDefinition(definition);
  });

const isComfyOutputNodeType = (objectInfo: ComfyObjectInfo, nodeType: string): boolean => {
  const info = objectInfo[nodeType];
  return (
    knownComfyOutputNodeTypes.has(nodeType) || (isJsonObject(info) && info.output_node === true)
  );
};

const toPromptLink = (value: unknown): PromptLink | undefined => {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [nodeId, slot] = value;
  return typeof nodeId === 'string' && typeof slot === 'number' ? [nodeId, slot] : undefined;
};

const getObjectInfoOutputTypes = (info: JsonObject | undefined): string[] => {
  const output = info?.output;
  return Array.isArray(output) ? output.map((type) => (typeof type === 'string' ? type : '')) : [];
};

const getGraphOutputType = (
  context: ComfyGraphContext,
  node: ComfyGraphNode,
  output: ComfyGraphOutput,
  slot: number,
): string => {
  if (typeof output.type === 'string') return output.type;
  return getObjectInfoOutputTypes(context.objectInfo[node.type])[slot] ?? '';
};

const countOutputLinks = (
  context: ComfyGraphContext,
  node: ComfyGraphNode,
  output: ComfyGraphOutput,
  slot: number,
): number => {
  if (Array.isArray(output.links)) return output.links.length;
  return [...context.linksById.values()].filter(
    (link) => String(link.originId) === String(node.id) && link.originSlot === slot,
  ).length;
};

const getNodeOrder = (node: ComfyGraphNode): number =>
  typeof node.order === 'number' ? node.order : 0;

const getSyntheticPreviewNodeId = (
  context: ComfyGraphContext,
  node: ComfyGraphNode,
  slot: number,
) =>
  getUniquePromptNodeId(
    context.prompt,
    `${context.prefix}${syntheticPreviewNodePrefix}_${String(node.id).replace(/[^a-z0-9_-]+/gi, '_')}_${slot}`,
  );

const getSyntheticExrNodeId = (context: ComfyGraphContext, node: ComfyGraphNode, slot: number) =>
  getUniquePromptNodeId(
    context.prompt,
    `${context.prefix}${syntheticExrNodePrefix}_${String(node.id).replace(/[^a-z0-9_-]+/gi, '_')}_${slot}`,
  );

const getSynthetic3DNodeId = (
  context: ComfyGraphContext,
  node: ComfyGraphNode,
  slot: number,
  stage: 'serialize' | 'save',
) =>
  getUniquePromptNodeId(
    context.prompt,
    `${context.prefix}${synthetic3DNodePrefix}_${String(node.id).replace(/[^a-z0-9_-]+/gi, '_')}_${slot}_${stage}`,
  );

const isExrOptionValue = (value: unknown): boolean => String(value).toLowerCase().includes('exr');

const isMediaOutputInputType = (type: string | null): boolean =>
  type !== null && (imageOutputTypes.has(type) || type === 'IMAGE');

const getExrOutputImageInputName = (info: JsonObject): string | null => {
  const inputNames = getOrderedInputNames(info);
  return (
    inputNames.find((inputName) => {
      const type = getInputDefinitionType(getObjectInfoInputDefinition(info, inputName));
      return isMediaOutputInputType(type);
    }) ??
    inputNames.find((inputName) => ['images', 'image'].includes(inputName.toLowerCase())) ??
    null
  );
};

const getExrOutputFormatInput = (
  info: JsonObject,
): { inputName: string; value: string | number } | null => {
  for (const inputName of getOrderedInputNames(info)) {
    const options = getInputDefinitionEnumOptions(getObjectInfoInputDefinition(info, inputName));
    const exrOption = options.find(isExrOptionValue);
    if (exrOption !== undefined) return { inputName, value: exrOption };
  }
  return null;
};

const applyExrOutputFormatNestedInputs = (
  inputs: JsonObject,
  info: JsonObject,
  formatInput: { inputName: string; value: string | number },
): void => {
  const definition = getObjectInfoInputDefinition(info, formatInput.inputName);
  const option = getDynamicComboOption(definition, formatInput.value);
  if (!option) return;

  for (const [nestedName, nestedDefinition] of getDynamicComboOptionInputDefinitions(option)) {
    const value = getDefaultPromptValueForInputDefinition(nestedDefinition);
    if (value === undefined) continue;

    const dottedName = `${formatInput.inputName}.${nestedName}`;
    if (!(nestedName in inputs) && !(dottedName in inputs)) {
      inputs[dottedName] = value;
    }
  }
};

const getDefaultPromptValueForInputDefinition = (definition: unknown): unknown => {
  const config = getInputDefinitionConfig(definition);
  if ('default' in config) return config.default;

  const options = getInputDefinitionEnumOptions(definition);
  if (options.length > 0) return options[0];

  const type = getInputDefinitionType(definition);
  if (type === 'BOOLEAN') return false;
  if (type === 'INT') return 0;
  if (type === 'FLOAT') return 0;
  if (type === 'STRING') return '';
  return undefined;
};

const isPrimitivePromptInputDefinition = (definition: unknown): boolean => {
  const type = getInputDefinitionType(definition);
  if (getInputDefinitionEnumOptions(definition).length > 0) return true;
  return type !== null && primitiveWidgetInputTypes.has(type);
};

const collectDynamicInputOptions = (info: JsonObject): ComfyWorkflowDynamicInputOption[] => {
  const dynamicOptions: ComfyWorkflowDynamicInputOption[] = [];

  for (const parentInputName of getOrderedInputNames(info)) {
    const parentDefinition = getObjectInfoInputDefinition(info, parentInputName);
    if (!isDynamicComboInputDefinition(parentDefinition)) continue;

    for (const option of getInputDefinitionOptions(parentDefinition)) {
      if (!isJsonObject(option)) continue;
      if (typeof option.key !== 'string' && typeof option.key !== 'number') continue;

      const fields = Array.from(getDynamicComboOptionInputDefinitions(option))
        .map(([inputName, definition]) => {
          const defaultValue = getDefaultPromptValueForInputDefinition(definition);
          const options = getInputDefinitionEnumOptions(definition);
          if (
            defaultValue !== undefined &&
            typeof defaultValue !== 'string' &&
            typeof defaultValue !== 'number' &&
            typeof defaultValue !== 'boolean'
          ) {
            return null;
          }

          return {
            inputName,
            dottedInputName: `${parentInputName}.${inputName}`,
            ...(defaultValue !== undefined ? { defaultValue } : {}),
            ...(options.length > 0 ? { options } : {}),
          };
        })
        .filter(
          (field): field is ComfyWorkflowDynamicInputOption['fields'][number] => field !== null,
        );

      dynamicOptions.push({
        parentInputName,
        optionKey: option.key,
        fields,
      });
    }
  }

  return dynamicOptions;
};

const getExrOutputFilenamePrefixInputName = (info: JsonObject): string | null => {
  const inputNames = getOrderedInputNames(info);
  return (
    inputNames.find((inputName) => inputName === 'filename_prefix') ??
    inputNames.find((inputName) => /filename|prefix/i.test(inputName)) ??
    null
  );
};

const getSyntheticOutputFilenamePrefix = (
  context: ComfyGraphContext,
  node: ComfyGraphNode,
  slot: number,
): string => {
  const sourceId = `${context.prefix}${String(node.id)}_${slot}`.replace(/[^a-z0-9_-]+/gi, '_');
  return `blackboard/${sourceId || 'comfy'}_exr`;
};

const createExrOutputNodeInputs = ({
  info,
  promptLink,
  filenamePrefix,
}: {
  info: JsonObject;
  promptLink: PromptLink;
  filenamePrefix: string;
}): JsonObject | null => {
  const imageInputName = getExrOutputImageInputName(info);
  if (!imageInputName) return null;

  const inputs: JsonObject = {};
  const requiredInputNames = getRequiredInputNames(info);

  for (const inputName of requiredInputNames) {
    if (inputName === imageInputName) {
      inputs[inputName] = promptLink;
      continue;
    }

    const definition = getObjectInfoInputDefinition(info, inputName);
    if (!isPrimitivePromptInputDefinition(definition)) continue;
    const value = getDefaultPromptValueForInputDefinition(definition);
    if (value !== undefined) inputs[inputName] = value;
  }

  const formatInput = getExrOutputFormatInput(info);
  if (formatInput) {
    inputs[formatInput.inputName] = formatInput.value;
    applyExrOutputFormatNestedInputs(inputs, info, formatInput);
  }

  const filenamePrefixInputName = getExrOutputFilenamePrefixInputName(info);
  if (filenamePrefixInputName) {
    inputs[filenamePrefixInputName] = filenamePrefix;
  }

  inputs[imageInputName] = promptLink;
  return inputs;
};

const getExrOutputNodeType = (objectInfo: ComfyObjectInfo): string | null => {
  for (const nodeType of preferredExrOutputNodeTypes) {
    const info = objectInfo[nodeType];
    if (!isJsonObject(info) || !getExrOutputImageInputName(info)) continue;
    if (normalizeComfyType(nodeType).includes('saveexr') || getExrOutputFormatInput(info)) {
      return nodeType;
    }
  }

  for (const [nodeType, info] of Object.entries(objectInfo)) {
    if (!isJsonObject(info) || !isComfyOutputNodeType(objectInfo, nodeType)) continue;
    if (!getExrOutputImageInputName(info)) continue;
    if (normalizeComfyType(nodeType).includes('saveexr') || getExrOutputFormatInput(info)) {
      return nodeType;
    }
  }

  return null;
};

const createSyntheticOutputNodeSpec = (
  context: ComfyGraphContext,
  node: ComfyGraphNode,
  slot: number,
  promptLink: PromptLink,
): Pick<
  ComfyWorkflowOutputCandidate,
  'previewNodeId' | 'syntheticOutputNodes' | 'syntheticOutputFormat' | 'outputNodeDynamicInputs'
> => {
  const exrNodeType = getExrOutputNodeType(context.objectInfo);
  const exrInfo = exrNodeType ? context.objectInfo[exrNodeType] : undefined;
  if (exrNodeType && isJsonObject(exrInfo)) {
    const dynamicInputs = collectDynamicInputOptions(exrInfo);
    const inputs = createExrOutputNodeInputs({
      info: exrInfo,
      promptLink,
      filenamePrefix: getSyntheticOutputFilenamePrefix(context, node, slot),
    });

    if (inputs) {
      const previewNodeId = getSyntheticExrNodeId(context, node, slot);
      return {
        previewNodeId,
        syntheticOutputNodes: [
          {
            id: previewNodeId,
            nodeType: exrNodeType,
            inputs,
          },
        ],
        syntheticOutputFormat: 'exr_float',
        ...(dynamicInputs.length > 0 ? { outputNodeDynamicInputs: dynamicInputs } : {}),
      };
    }
  }

  const previewNodeId = getSyntheticPreviewNodeId(context, node, slot);
  return {
    previewNodeId,
    syntheticOutputNodes: [
      {
        id: previewNodeId,
        nodeType: previewImageNodeType,
        inputs: { images: promptLink },
      },
    ],
    syntheticOutputFormat: 'preview',
  };
};

const isModel3DOutputType = (type: string): boolean =>
  type
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => model3DOutputTypes.has(entry) || entry.startsWith('FILE_3D'));

const findComfyNodeType = (objectInfo: ComfyObjectInfo, preferredType: string): string | null => {
  if (objectInfo[preferredType]) return preferredType;
  const normalizedPreferredType = normalizeComfyType(preferredType);
  return (
    Object.keys(objectInfo).find(
      (nodeType) => normalizeComfyType(nodeType) === normalizedPreferredType,
    ) ?? null
  );
};

const getModel3DInputName = (info: JsonObject, preferredNames: string[]): string | null => {
  const inputNames = getOrderedInputNames(info);
  return (
    inputNames.find((inputName) => {
      const type = getInputDefinitionType(getObjectInfoInputDefinition(info, inputName));
      return Boolean(type && isModel3DOutputType(type));
    }) ??
    inputNames.find((inputName) => preferredNames.includes(inputName.toLowerCase())) ??
    null
  );
};

const createSyntheticNodeInputs = ({
  info,
  linkedInputName,
  promptLink,
}: {
  info: JsonObject;
  linkedInputName: string;
  promptLink: PromptLink;
}): JsonObject => {
  const inputs: JsonObject = {};
  for (const inputName of getRequiredInputNames(info)) {
    if (inputName === linkedInputName) continue;
    const value = getDefaultPromptValueForInputDefinition(
      getObjectInfoInputDefinition(info, inputName),
    );
    if (value !== undefined) inputs[inputName] = value;
  }
  inputs[linkedInputName] = promptLink;
  return inputs;
};

const getSynthetic3DFilenamePrefix = (
  context: ComfyGraphContext,
  node: ComfyGraphNode,
  slot: number,
): string => {
  const sourceId = `${context.prefix}${String(node.id)}_${slot}`.replace(/[^a-z0-9_-]+/gi, '_');
  return `blackboard/3d/${sourceId || 'comfy'}`;
};

const createSyntheticModel3DOutputNodeSpec = (
  context: ComfyGraphContext,
  node: ComfyGraphNode,
  slot: number,
  outputType: string,
  promptLink: PromptLink,
): Pick<
  ComfyWorkflowOutputCandidate,
  'previewNodeId' | 'syntheticOutputNodes' | 'syntheticOutputFormat'
> | null => {
  const saveNodeType = findComfyNodeType(context.objectInfo, 'SaveGLB');
  const saveInfo = saveNodeType ? context.objectInfo[saveNodeType] : undefined;
  if (
    !saveNodeType ||
    !isJsonObject(saveInfo) ||
    !isComfyOutputNodeType(context.objectInfo, saveNodeType)
  ) {
    return null;
  }

  const saveInputName = getModel3DInputName(saveInfo, ['mesh', 'model_3d', 'splat']);
  if (!saveInputName) return null;

  const syntheticOutputNodes: ComfyWorkflowSyntheticOutputNode[] = [];
  let savePromptLink = promptLink;

  if (outputType === 'SPLAT') {
    const serializeNodeType = findComfyNodeType(context.objectInfo, 'SplatToFile3D');
    const serializeInfo = serializeNodeType ? context.objectInfo[serializeNodeType] : undefined;
    if (!serializeNodeType || !isJsonObject(serializeInfo)) return null;

    const serializeInputName = getModel3DInputName(serializeInfo, ['splat']);
    if (!serializeInputName) return null;

    const serializeNodeId = getSynthetic3DNodeId(context, node, slot, 'serialize');
    const serializeInputs = createSyntheticNodeInputs({
      info: serializeInfo,
      linkedInputName: serializeInputName,
      promptLink,
    });
    const formatOptions = getInputEnumOptions(serializeInfo, 'format');
    if (formatOptions.includes('spz')) serializeInputs.format = 'spz';
    syntheticOutputNodes.push({
      id: serializeNodeId,
      nodeType: serializeNodeType,
      inputs: serializeInputs,
    });
    savePromptLink = [serializeNodeId, 0];
  }

  const saveNodeId = getSynthetic3DNodeId(context, node, slot, 'save');
  const saveInputs = createSyntheticNodeInputs({
    info: saveInfo,
    linkedInputName: saveInputName,
    promptLink: savePromptLink,
  });
  const filenamePrefixInput = getExrOutputFilenamePrefixInputName(saveInfo);
  if (filenamePrefixInput) {
    saveInputs[filenamePrefixInput] = getSynthetic3DFilenamePrefix(context, node, slot);
  }
  syntheticOutputNodes.push({ id: saveNodeId, nodeType: saveNodeType, inputs: saveInputs });

  return {
    previewNodeId: saveNodeId,
    syntheticOutputNodes,
    syntheticOutputFormat: 'model_3d',
  };
};

const getSyntheticOutputTerminalNode = (
  candidate: ComfyWorkflowOutputCandidate,
): ComfyWorkflowSyntheticOutputNode | undefined => candidate.syntheticOutputNodes?.at(-1);

const getOutputCandidateLabel = (node: ComfyGraphNode, output: ComfyGraphOutput, slot: number) => {
  const outputName = typeof output.name === 'string' && output.name.trim() ? output.name : 'output';
  return `${node.type} #${String(node.id)} ${outputName}${slot > 0 ? ` ${slot + 1}` : ''}`;
};

const isImageUploadGraphNode = (node: ComfyGraphNode, objectInfo: ComfyObjectInfo): boolean => {
  if (node.type.toLowerCase().includes('loadimage')) return true;

  const info = objectInfo[node.type];
  if (!isJsonObject(info)) return false;

  return getOrderedInputNames(info).some((inputName) => {
    const definition = getObjectInfoInputDefinition(info, inputName);
    return getInputDefinitionType(definition) === 'IMAGEUPLOAD';
  });
};

const collectSyntheticOutputCandidates = (
  context: ComfyGraphContext,
  { unconnectedOnly = false }: { unconnectedOnly?: boolean } = {},
): ComfyWorkflowOutputCandidate[] => {
  const candidates = getGraphNodes(context.graph)
    .flatMap((node) => {
      if (isImageUploadGraphNode(node, context.objectInfo)) return [];

      const graphOutputs = node.outputs ?? [];
      const objectInfoOutputTypes = getObjectInfoOutputTypes(context.objectInfo[node.type]);
      const outputCount = Math.max(graphOutputs.length, objectInfoOutputTypes.length);
      return Array.from({ length: outputCount }, (_, slot) => {
        const output = graphOutputs[slot] ?? {};
        const outputType = getGraphOutputType(context, node, output, slot);
        if (!imageOutputTypes.has(outputType) && !isModel3DOutputType(outputType)) return null;
        const link = resolveGraphSource(context, node.id, slot);
        if (!link) return null;
        const syntheticOutputNode = imageOutputTypes.has(outputType)
          ? createSyntheticOutputNodeSpec(context, node, slot, link)
          : createSyntheticModel3DOutputNodeSpec(context, node, slot, outputType, link);
        if (!syntheticOutputNode) return null;
        const candidate: ComfyWorkflowOutputCandidate & {
          linkCount: number;
          order: number;
        } = {
          id: `${context.prefix}${String(node.id)}:${slot}`,
          nodeId: `${context.prefix}${String(node.id)}`,
          nodeType: node.type,
          kind: 'synthetic',
          outputIndex: slot,
          outputName:
            typeof output.name === 'string' && output.name.trim() ? output.name : outputType,
          outputType,
          label: getOutputCandidateLabel(node, output, slot),
          promptLink: link,
          ...syntheticOutputNode,
          linkCount: countOutputLinks(context, node, output, slot),
          order: getNodeOrder(node),
        };
        return candidate;
      });
    })
    .filter(
      (
        candidate,
      ): candidate is ComfyWorkflowOutputCandidate & {
        linkCount: number;
        order: number;
      } => candidate !== null,
    )
    .sort((a, b) => {
      const unlinkedDelta = Number(a.linkCount > 0) - Number(b.linkCount > 0);
      if (unlinkedDelta !== 0) return unlinkedDelta;
      if (a.order !== b.order) return b.order - a.order;
      return a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true });
    });

  return candidates
    .filter((candidate) => !unconnectedOnly || candidate.linkCount === 0)
    .map(({ linkCount: _linkCount, order: _order, ...candidate }) => candidate);
};

const collectExistingPromptOutputNodeCandidates = (
  prompt: JsonObject,
  objectInfo: ComfyObjectInfo,
  allowedNodeIds?: ReadonlySet<string>,
  scope?: ComfyWorkflowOutputCandidate['scope'],
): ComfyWorkflowOutputCandidate[] =>
  Object.entries(prompt)
    .map(([nodeId, promptNode]): ComfyWorkflowOutputCandidate | null => {
      if (allowedNodeIds && !allowedNodeIds.has(nodeId)) return null;
      if (!isJsonObject(promptNode) || typeof promptNode.class_type !== 'string') return null;
      if (!isComfyOutputNodeType(objectInfo, promptNode.class_type)) return null;
      const info = objectInfo[promptNode.class_type];
      const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
      const imageInput = toPromptLink(inputs.images) ?? toPromptLink(inputs.image);
      const videoInput = toPromptLink(inputs.video);
      const model3DInput = Object.entries(inputs).find(([inputName, value]) => {
        if (!toPromptLink(value)) return false;
        const inputType = getObjectInfoInputType(info, inputName);
        return (
          model3DOutputTypes.has(inputType ?? '') ||
          inputType?.startsWith('FILE_3D') === true ||
          ['mesh', 'model_3d', 'splat'].includes(inputName.toLowerCase())
        );
      });
      const model3DPromptLink = model3DInput ? toPromptLink(model3DInput[1]) : null;
      // ComfyUI 0.25 marks diagnostic sinks such as PreviewAny as output nodes too.
      // Studio output candidates are persisted artifacts, so keep diagnostic-only sinks out.
      if (!imageInput && !videoInput && !model3DPromptLink) return null;
      const outputName = imageInput ? 'images' : videoInput ? 'video' : '3d';
      const dynamicInputs = isJsonObject(info) ? collectDynamicInputOptions(info) : [];
      return {
        id: nodeId,
        nodeId,
        nodeType: promptNode.class_type,
        kind: 'existing',
        outputIndex: 0,
        outputName,
        outputType: videoInput
          ? 'VIDEO'
          : imageInput
            ? 'IMAGE'
            : model3DInput
              ? (getObjectInfoInputType(info, model3DInput[0]) ?? 'FILE_3D')
              : undefined,
        label: `${promptNode.class_type} #${nodeId}`,
        ...(scope ? { scope } : {}),
        promptLink: imageInput ?? videoInput ?? model3DPromptLink ?? undefined,
        previewNodeId: nodeId,
        outputNodeInputs: inputs,
        ...(dynamicInputs.length > 0 ? { outputNodeDynamicInputs: dynamicInputs } : {}),
      };
    })
    .filter((candidate): candidate is ComfyWorkflowOutputCandidate => candidate !== null)
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true }));

const collectExistingOutputNodeCandidates = (
  context: ComfyGraphContext,
): ComfyWorkflowOutputCandidate[] => {
  const topLevelOutputNodeIds = new Set(
    getGraphNodes(context.graph)
      .filter((node) => isComfyOutputNodeType(context.objectInfo, node.type))
      .map((node) => `${context.prefix}${String(node.id)}`),
  );
  return collectExistingPromptOutputNodeCandidates(
    context.prompt,
    context.objectInfo,
    topLevelOutputNodeIds,
  );
};

const getUniquePromptNodeId = (prompt: JsonObject, baseId: string): string => {
  let candidate = baseId;
  let suffix = 1;
  while (candidate in prompt) {
    suffix += 1;
    candidate = `${baseId}_${suffix}`;
  }
  return candidate;
};

const appendSyntheticOutputNodes = (
  context: ComfyGraphContext,
  candidate: ComfyWorkflowOutputCandidate,
): void => {
  for (const node of candidate.syntheticOutputNodes ?? []) {
    context.prompt[node.id] = {
      class_type: node.nodeType,
      inputs: node.inputs,
    };
  }
};

const isSeedWidgetName = (name: string): boolean => name.toLowerCase().includes('seed');

const isSeedControlWidgetValue = (value: unknown): boolean =>
  typeof value === 'string' && seedControlWidgetValues.has(value);

const alignWidgetValuesToInputNames = (widgetNames: string[], values: unknown[]): unknown[] => {
  if (values.length <= widgetNames.length) return values;

  const alignedValues: unknown[] = [];
  let valueIndex = 0;

  for (const widgetName of widgetNames) {
    if (valueIndex >= values.length) break;

    alignedValues.push(values[valueIndex]);
    valueIndex += 1;

    const remainingValues = values.length - valueIndex;
    const remainingWidgets = widgetNames.length - alignedValues.length;
    if (
      remainingValues > remainingWidgets &&
      isSeedWidgetName(widgetName) &&
      isSeedControlWidgetValue(values[valueIndex])
    ) {
      valueIndex += 1;
    }
  }

  return alignedValues;
};

const getApiNodeId = (context: ComfyGraphContext, nodeId: GraphNodeId): string =>
  `${context.prefix}${String(nodeId)}`;

const hasGraphOutputConsumers = (context: ComfyGraphContext, node: ComfyGraphNode): boolean =>
  [...context.linksById.values()].some((link) => String(link.originId) === String(node.id));

const createGraphContext = ({
  graph,
  objectInfo,
  prompt,
  subgraphsById,
  expandedSubgraphs,
  unsupportedNodeTypes,
  prefix = '',
  parent,
  wrapperNode,
}: {
  graph: JsonObject;
  objectInfo: ComfyObjectInfo;
  prompt: JsonObject;
  subgraphsById: Map<string, JsonObject>;
  expandedSubgraphs: Set<string>;
  unsupportedNodeTypes: Set<string>;
  prefix?: string;
  parent?: ComfyGraphContext;
  wrapperNode?: ComfyGraphNode;
}): ComfyGraphContext => {
  const linksById = new Map(getGraphLinks(graph).map((link) => [String(link.id), link]));
  const nodesById = new Map(getGraphNodes(graph).map((node) => [String(node.id), node]));
  return {
    graph,
    linksById,
    nodesById,
    objectInfo,
    prompt,
    subgraphsById,
    expandedSubgraphs,
    unsupportedNodeTypes,
    prefix,
    parent,
    wrapperNode,
  };
};

const resolveGraphSource = (
  context: ComfyGraphContext,
  originId: GraphNodeId,
  originSlot: number,
): PromptLink | null => {
  if (String(originId) === '-10') {
    // ComfyUI frontend 1.45 can omit widget-only inputs from a subgraph wrapper while
    // retaining them in the definition. Resolve by name so compressed slots cannot shift links.
    const graphInputs = Array.isArray(context.graph.inputs) ? context.graph.inputs : [];
    const graphInput = graphInputs[originSlot];
    const graphInputName = isJsonObject(graphInput) ? graphInput.name : undefined;
    const wrapperInput =
      typeof graphInputName === 'string'
        ? context.wrapperNode?.inputs?.find((input) => input.name === graphInputName)
        : context.wrapperNode?.inputs?.[originSlot];
    if (wrapperInput?.link !== undefined && wrapperInput.link !== null && context.parent) {
      return resolveGraphLink(context.parent, wrapperInput.link);
    }
    return null;
  }

  const node = context.nodesById.get(String(originId));
  if (!node) return null;
  const subgraph = context.subgraphsById.get(node.type);
  if (subgraph) return resolveSubgraphOutput(context, node, subgraph, originSlot);
  if (passthroughGraphNodeTypes.has(node.type)) {
    const inputLink = node.inputs?.find(
      (input) => input.link !== undefined && input.link !== null,
    )?.link;
    return inputLink !== undefined && inputLink !== null
      ? resolveGraphLink(context, inputLink)
      : null;
  }
  if (!context.objectInfo[node.type]) return null;
  return [getApiNodeId(context, node.id), originSlot];
};

const resolveGraphLink = (
  context: ComfyGraphContext,
  linkId: number | string,
): PromptLink | null => {
  const link = context.linksById.get(String(linkId));
  if (!link) return null;
  return resolveGraphSource(context, link.originId, link.originSlot);
};

const resolveSubgraphOutput = (
  parentContext: ComfyGraphContext,
  wrapperNode: ComfyGraphNode,
  subgraph: JsonObject,
  outputSlot: number,
): PromptLink | null => {
  const subContext = expandSubgraph(parentContext, wrapperNode, subgraph);
  const outputs = Array.isArray(subgraph.outputs) ? subgraph.outputs : [];
  const output = outputs[outputSlot];
  const linkIds = isJsonObject(output) && Array.isArray(output.linkIds) ? output.linkIds : [];
  const outputLinkId = linkIds[0];
  if (typeof outputLinkId === 'number' || typeof outputLinkId === 'string') {
    return resolveGraphLink(subContext, outputLinkId);
  }

  const outputLink = getGraphLinks(subgraph).find(
    (link) => String(link.targetId) === '-20' && link.targetSlot === outputSlot,
  );
  return outputLink
    ? resolveGraphSource(subContext, outputLink.originId, outputLink.originSlot)
    : null;
};

const applyDynamicComboWidgetValues = ({
  inputs,
  definition,
  parentName,
  selectedValue,
  widgetValues,
  valueIndex,
  linkedInputNames,
}: {
  inputs: JsonObject;
  definition: unknown;
  parentName: string;
  selectedValue: unknown;
  widgetValues: unknown[];
  valueIndex: number;
  linkedInputNames: Set<string>;
}): number => {
  const option = getDynamicComboOption(definition, selectedValue);
  if (!option) return valueIndex;

  for (const nestedName of getDynamicComboOptionInputNames(option)) {
    if (valueIndex >= widgetValues.length) break;

    const nestedValue = widgetValues[valueIndex];
    valueIndex += 1;

    const dottedName = `${parentName}.${nestedName}`;
    if (!linkedInputNames.has(nestedName) && !linkedInputNames.has(dottedName)) {
      inputs[dottedName] = nestedValue;
    }
  }

  return valueIndex;
};

const isWidgetValueCompatible = (definition: unknown, value: unknown): boolean => {
  const inputType = getInputDefinitionType(definition);
  const options = getInputEnumOptions({ input: { required: { value: definition } } }, 'value');
  if (options.length > 0) return options.some((option) => option === value);

  if (inputType === 'INT') return typeof value === 'number' && Number.isInteger(value);
  if (inputType === 'FLOAT') return typeof value === 'number';
  if (inputType === 'BOOLEAN') return typeof value === 'boolean';
  if (inputType === 'STRING') return typeof value === 'string';
  return true;
};

const getFirstCompatibleWidgetValueIndex = (
  widgetNames: string[],
  info: JsonObject,
  widgetValues: unknown[],
): number => {
  let valueIndex = 0;
  while (widgetValues.length - valueIndex > widgetNames.length) {
    const firstWidgetName = widgetNames[0];
    if (!firstWidgetName) break;

    const definition = getObjectInfoInputDefinition(info, firstWidgetName);
    if (isWidgetValueCompatible(definition, widgetValues[valueIndex])) break;
    valueIndex += 1;
  }
  return valueIndex;
};

const applyObjectInfoWidgetValues = (
  inputs: JsonObject,
  node: ComfyGraphNode,
  info: JsonObject,
  linkedInputNames: Set<string>,
  widgetValues: unknown[],
): boolean => {
  const widgetNames = getWidgetInputNames(node, info);
  if (widgetNames.length === 0) return false;

  let valueIndex = getFirstCompatibleWidgetValueIndex(widgetNames, info, widgetValues);

  for (let widgetIndex = 0; widgetIndex < widgetNames.length; widgetIndex += 1) {
    if (valueIndex >= widgetValues.length) break;

    const widgetName = widgetNames[widgetIndex];
    const definition = getObjectInfoInputDefinition(info, widgetName);
    const value = widgetValues[valueIndex];
    valueIndex += 1;

    if (!linkedInputNames.has(widgetName)) {
      inputs[widgetName] = value;
    }

    if (isDynamicComboInputDefinition(definition)) {
      valueIndex = applyDynamicComboWidgetValues({
        inputs,
        definition,
        parentName: widgetName,
        selectedValue: value,
        widgetValues,
        valueIndex,
        linkedInputNames,
      });
    }

    const remainingValues = widgetValues.length - valueIndex;
    const remainingWidgets = widgetNames.length - widgetIndex - 1;
    if (
      remainingValues > remainingWidgets &&
      isSeedWidgetName(widgetName) &&
      isSeedControlWidgetValue(widgetValues[valueIndex])
    ) {
      valueIndex += 1;
    }
  }

  return true;
};

const applyWidgetValues = (
  inputs: JsonObject,
  node: ComfyGraphNode,
  info: JsonObject,
  linkedInputNames: Set<string>,
): void => {
  const widgetValues = node.widgets_values;
  if (Array.isArray(widgetValues)) {
    if (applyObjectInfoWidgetValues(inputs, node, info, linkedInputNames, widgetValues)) {
      return;
    }

    const widgetNames = getGraphWidgetInputNames(node);
    alignWidgetValuesToInputNames(widgetNames, widgetValues).forEach((value, index) => {
      const widgetName = widgetNames[index];
      if (widgetName && !linkedInputNames.has(widgetName)) {
        inputs[widgetName] = value;
      }
    });
    return;
  }

  if (isJsonObject(widgetValues)) {
    for (const [name, value] of Object.entries(widgetValues)) {
      const promptInputName = getPromptInputNameForGraphInput(info, name);
      if (!linkedInputNames.has(name) && !linkedInputNames.has(promptInputName)) {
        inputs[promptInputName] = value;
      }
    }
  }
};

const convertGraphNode = (context: ComfyGraphContext, node: ComfyGraphNode): void => {
  if (
    passthroughGraphNodeTypes.has(node.type) ||
    (ignorableGraphSinkNodeTypes.has(node.type) && !hasGraphOutputConsumers(context, node))
  ) {
    return;
  }

  if (context.subgraphsById.has(node.type)) {
    expandSubgraph(context, node, context.subgraphsById.get(node.type)!);
    return;
  }

  const info = context.objectInfo[node.type];
  if (!info) {
    const hasConnectedInputs = node.inputs?.some(
      (input) => input.link !== undefined && input.link !== null,
    );
    const hasConnectedOutputs = hasGraphOutputConsumers(context, node);
    if (hasConnectedInputs || hasConnectedOutputs) {
      context.unsupportedNodeTypes.add(node.type);
    }
    return;
  }

  const inputs: JsonObject = {};
  const linkedInputNames = new Set<string>();
  for (const input of node.inputs ?? []) {
    if (input.link === undefined || input.link === null) continue;
    const link = resolveGraphLink(context, input.link);
    if (!link) continue;

    const promptInputName = getPromptInputNameForGraphInput(info, input.name);
    inputs[promptInputName] = link;
    linkedInputNames.add(input.name);
    linkedInputNames.add(promptInputName);
  }

  applyWidgetValues(inputs, node, info, linkedInputNames);

  context.prompt[getApiNodeId(context, node.id)] = {
    class_type: node.type,
    inputs,
  };
};

const convertGraphContext = (context: ComfyGraphContext): void => {
  for (const node of getGraphNodes(context.graph)) {
    convertGraphNode(context, node);
  }
};

function expandSubgraph(
  parentContext: ComfyGraphContext,
  wrapperNode: ComfyGraphNode,
  subgraph: JsonObject,
): ComfyGraphContext {
  const prefix = `${parentContext.prefix}${String(wrapperNode.id)}_`;
  const cacheKey = `${prefix}${String(subgraph.id ?? wrapperNode.type)}`;
  const subContext = createGraphContext({
    graph: subgraph,
    objectInfo: parentContext.objectInfo,
    prompt: parentContext.prompt,
    subgraphsById: parentContext.subgraphsById,
    expandedSubgraphs: parentContext.expandedSubgraphs,
    unsupportedNodeTypes: parentContext.unsupportedNodeTypes,
    prefix,
    parent: parentContext,
    wrapperNode,
  });

  if (!parentContext.expandedSubgraphs.has(cacheKey)) {
    parentContext.expandedSubgraphs.add(cacheKey);
    convertGraphContext(subContext);
  }

  return subContext;
}

interface ComfyPromptExtractionResult {
  prompt: JsonObject;
  inputCandidates: ComfyWorkflowInputCandidate[];
  selectedInputIds: string[];
  controlOptions: ComfyWorkflowControlOptions[];
  defaultControlKeys?: string[];
  outputCandidates: ComfyWorkflowOutputCandidate[];
  selectedOutputIds: string[];
}

const getInputDefinitionEnumOptions = (definition: unknown): Array<string | number> => {
  if (!Array.isArray(definition)) return [];

  const inputType = definition[0];

  if (Array.isArray(inputType)) {
    return inputType.filter(
      (option): option is string | number =>
        typeof option === 'string' || typeof option === 'number',
    );
  }

  return getInputDefinitionOptions(definition)
    .map((option) => {
      if (typeof option === 'string' || typeof option === 'number') return option;
      if (
        isJsonObject(option) &&
        (typeof option.key === 'string' || typeof option.key === 'number')
      ) {
        return option.key;
      }
      return null;
    })
    .filter((option): option is string | number => option !== null);
};

const getInputEnumOptions = (info: JsonObject, inputName: string): Array<string | number> =>
  getInputDefinitionEnumOptions(getObjectInfoInputDefinition(info, inputName));

const getObjectInfoInputType = (info: JsonObject | undefined, inputName: string): string | null => {
  if (!info) return null;
  const definition = getObjectInfoInputDefinition(info, inputName);
  if (!Array.isArray(definition)) return null;
  return typeof definition[0] === 'string' ? definition[0] : null;
};

const mediaPromptInputNames = new Set(['image', 'images', 'mask', 'video']);
const mediaGraphInputTypes = new Set(['IMAGE', 'IMAGES', 'IMAGE_LIST', 'MASK', 'MASKS', 'VIDEO']);

const isLoadMediaNodeType = (nodeType: string): boolean => {
  const normalizedType = normalizeComfyType(nodeType);
  return (
    normalizedType.includes('loadimage') ||
    normalizedType.includes('loadimages') ||
    normalizedType.includes('loadvideo')
  );
};

const isLoadMediaGraphNode = (node: ComfyGraphNode): boolean => isLoadMediaNodeType(node.type);

const getFallbackLoadMediaInputName = (nodeType: string): string => {
  const normalizedType = normalizeComfyType(nodeType);
  if (normalizedType.includes('loadvideo')) return 'video';
  if (normalizedType.includes('loadimages')) return 'images';
  return 'image';
};

const isMediaGraphInputType = (inputType: string | null | undefined): boolean => {
  if (!inputType) return false;
  return (
    mediaGraphInputTypes.has(inputType) ||
    inputType === 'IMAGEUPLOAD' ||
    inputType === 'VIDEOUPLOAD'
  );
};

const getGraphNodeInput = (node: ComfyGraphNode, inputName: string): ComfyGraphInput | undefined =>
  node.inputs?.find((input) => input.name === inputName);

const getSubgraphInputPromptTargets = ({
  subgraph,
  subgraphsById,
  wrapperNode,
  inputName,
  prefix = '',
}: {
  subgraph: JsonObject | undefined;
  subgraphsById: Map<string, JsonObject>;
  wrapperNode: ComfyGraphNode;
  inputName: string;
  prefix?: string;
}): Array<{ nodeId: string; inputName: string }> | undefined => {
  if (!subgraph) return undefined;
  const subgraphInputs = Array.isArray(subgraph.inputs) ? subgraph.inputs : [];
  const inputSlot = subgraphInputs.findIndex(
    (input) => isJsonObject(input) && input.name === inputName,
  );
  if (inputSlot < 0) return undefined;

  const subgraphNodesById = new Map(getGraphNodes(subgraph).map((node) => [String(node.id), node]));
  const targets = getGraphLinks(subgraph)
    .filter((link) => String(link.originId) === '-10' && link.originSlot === inputSlot)
    .flatMap((link) => {
      const targetNode = subgraphNodesById.get(String(link.targetId));
      const targetInputName = targetNode?.inputs?.[link.targetSlot]?.name;
      if (!targetNode || !targetInputName) return [];
      const nestedSubgraph = subgraphsById.get(targetNode.type);
      if (nestedSubgraph) {
        return (
          getSubgraphInputPromptTargets({
            subgraph: nestedSubgraph,
            subgraphsById,
            wrapperNode: targetNode,
            inputName: targetInputName,
            prefix: `${prefix}${String(wrapperNode.id)}_`,
          }) ?? []
        );
      }
      return [
        {
          nodeId: `${prefix}${String(wrapperNode.id)}_${String(targetNode.id)}`,
          inputName: targetInputName,
        },
      ];
    });

  return targets.length > 0 ? targets : undefined;
};

export interface ComfyGraphExposedField {
  nodeId: string;
  nodeType: string;
  inputName: string;
  label: string;
  promptTargets: Array<{ nodeId: string; inputName: string }>;
}

export const collectComfyGraphExposedFields = (graph: unknown): ComfyGraphExposedField[] => {
  if (!isComfyGraphWorkflow(graph)) return [];

  const subgraphsById = getSubgraphsById(graph);
  return getGraphNodes(graph).flatMap((node) => {
    const subgraph = subgraphsById.get(node.type);
    const exposedInputs = subgraph
      ? (Array.isArray(subgraph.inputs) ? subgraph.inputs : []).flatMap((input) =>
          isJsonObject(input) && typeof input.name === 'string'
            ? [
                {
                  name: input.name,
                  label: typeof input.label === 'string' ? input.label : undefined,
                  localized_name:
                    typeof input.localized_name === 'string' ? input.localized_name : undefined,
                },
              ]
            : [],
        )
      : (node.inputs ?? []).filter((input) => input.widget);

    return exposedInputs.flatMap((input) => {
      const wrapperInput = getGraphNodeInput(node, input.name);
      if (wrapperInput?.link !== undefined && wrapperInput.link !== null) return [];

      const promptTargets = subgraph
        ? getSubgraphInputPromptTargets({
            subgraph,
            subgraphsById,
            wrapperNode: node,
            inputName: input.name,
          })
        : [{ nodeId: String(node.id), inputName: input.name }];
      if (!promptTargets?.length) return [];

      return {
        nodeId: String(node.id),
        nodeType: node.type,
        inputName: input.name,
        label:
          input.label ??
          wrapperInput?.label ??
          input.localized_name ??
          wrapperInput?.localized_name ??
          input.name,
        promptTargets,
      };
    });
  });
};

const getTopLevelGraphInputCandidateNames = (
  node: ComfyGraphNode,
  info: JsonObject | undefined,
): string[] => {
  const names = new Set<string>();
  const graphInputNames = (node.inputs ?? []).map((input) => input.name).filter(Boolean);

  if (isLoadMediaGraphNode(node)) {
    for (const inputName of graphInputNames) {
      const inputType = getObjectInfoInputType(info, inputName);
      if (isMediaGraphInputType(inputType) || mediaPromptInputNames.has(inputName.toLowerCase())) {
        names.add(inputName);
      }
    }

    if (info) {
      for (const inputName of getOrderedInputNames(info)) {
        const inputType = getObjectInfoInputType(info, inputName);
        if (
          isMediaGraphInputType(inputType) ||
          mediaPromptInputNames.has(inputName.toLowerCase())
        ) {
          names.add(inputName);
        }
      }
    }

    if (names.size === 0) {
      names.add(getFallbackLoadMediaInputName(node.type));
    }

    return [...names];
  }

  if (!info) {
    return graphInputNames.filter((inputName) => {
      const graphInput = getGraphNodeInput(node, inputName);
      return (
        (mediaPromptInputNames.has(inputName.toLowerCase()) ||
          isMediaGraphInputType(graphInput?.type)) &&
        (graphInput?.link === undefined || graphInput.link === null)
      );
    });
  }

  for (const inputName of getOrderedInputNames(info)) {
    const inputType = getObjectInfoInputType(info, inputName);
    if (!isMediaGraphInputType(inputType)) continue;

    const graphInput = getGraphNodeInput(node, inputName);
    if (graphInput?.link !== undefined && graphInput.link !== null) continue;
    names.add(inputName);
  }

  return [...names];
};

const collectTopLevelGraphInputCandidates = (
  graph: JsonObject,
  objectInfo: ComfyObjectInfo | undefined,
): ComfyWorkflowInputCandidate[] => {
  const seen = new Set<string>();
  const result: ComfyWorkflowInputCandidate[] = [];
  const subgraphsById = getSubgraphsById(graph);

  for (const node of getGraphNodes(graph)) {
    const info = objectInfo?.[node.type];
    const subgraph = subgraphsById.get(node.type);
    if (objectInfo && isComfyOutputNodeType(objectInfo, node.type)) continue;

    for (const inputName of getTopLevelGraphInputCandidateNames(node, info)) {
      const id = `${String(node.id)}:${inputName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const promptTargets = getSubgraphInputPromptTargets({
        subgraph,
        subgraphsById,
        wrapperNode: node,
        inputName,
      });
      result.push({
        id,
        nodeId: String(node.id),
        nodeType: node.type,
        inputName,
        label: `${node.type} #${String(node.id)}`,
        ...(promptTargets ? { promptTargets } : {}),
      });
    }
  }

  return result;
};

const isImageUploadPromptInput = ({
  classType,
  inputName,
  value,
  inputType,
}: {
  classType: string;
  inputName: string;
  value: unknown;
  inputType: string | null;
}): boolean => {
  if (typeof value !== 'string') return false;
  if (inputType === 'IMAGEUPLOAD') return true;

  const normalizedClassType = classType.toLowerCase();
  const normalizedInputName = inputName.toLowerCase();
  return normalizedClassType.includes('loadimage') && normalizedInputName === 'image';
};

const collectPromptInputCandidates = (
  prompt: JsonObject,
  objectInfo: ComfyObjectInfo | undefined,
  scope?: ComfyWorkflowInputCandidate['scope'],
): ComfyWorkflowInputCandidate[] => {
  const seen = new Set<string>();
  const result: ComfyWorkflowInputCandidate[] = [];

  for (const [nodeId, promptNode] of Object.entries(prompt)) {
    if (!isJsonObject(promptNode) || typeof promptNode.class_type !== 'string') continue;

    const classType = promptNode.class_type;
    const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
    const info = objectInfo?.[classType];

    const inputNames = new Set([
      ...Object.keys(inputs),
      ...(info ? getOrderedInputNames(info) : []),
    ]);
    for (const inputName of inputNames) {
      const value = inputs[inputName];
      const inputType = getObjectInfoInputType(info, inputName);
      const isUploadInput = isImageUploadPromptInput({
        classType,
        inputName,
        value,
        inputType,
      });
      const isUnconnectedMediaInput =
        isMediaGraphInputType(inputType) &&
        !toPromptLink(value) &&
        (value === null || value === undefined);
      if (!isUploadInput && !isUnconnectedMediaInput) {
        continue;
      }

      const id = `${nodeId}:${inputName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        nodeId,
        nodeType: classType,
        inputName,
        label: `${classType} #${nodeId}`,
        ...(scope ? { scope } : {}),
      });
    }
  }

  return result;
};

const collectGraphInputCandidates = (
  graph: JsonObject,
  prompt: JsonObject,
  objectInfo: ComfyObjectInfo | undefined,
): { candidates: ComfyWorkflowInputCandidate[]; selectedIds: string[] } => {
  const topLevelCandidates = collectTopLevelGraphInputCandidates(graph, objectInfo);
  const coveredPromptInputs = new Set(
    topLevelCandidates.flatMap((candidate) =>
      (candidate.promptTargets?.length
        ? candidate.promptTargets
        : [{ nodeId: candidate.nodeId, inputName: candidate.inputName }]
      ).map((target) => `${target.nodeId}:${target.inputName}`),
    ),
  );
  const topLevelIds = new Set(topLevelCandidates.map((candidate) => candidate.id));
  const internalCandidates = collectPromptInputCandidates(prompt, objectInfo, 'internal').filter(
    (candidate) =>
      !topLevelIds.has(candidate.id) &&
      !coveredPromptInputs.has(`${candidate.nodeId}:${candidate.inputName}`),
  );

  return {
    candidates: [...topLevelCandidates, ...internalCandidates],
    selectedIds: topLevelCandidates.map((candidate) => candidate.id),
  };
};

const collectPromptControlOptions = (
  prompt: JsonObject,
  objectInfo: ComfyObjectInfo | undefined,
): ComfyWorkflowControlOptions[] => {
  if (!objectInfo) return [];

  return Object.entries(prompt).flatMap(([nodeId, promptNode]) => {
    if (!isJsonObject(promptNode) || typeof promptNode.class_type !== 'string') return [];
    const info = objectInfo[promptNode.class_type];
    if (!isJsonObject(info)) return [];
    const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
    const optionsByInputName = new Map<string, ComfyWorkflowControlOptions>();

    for (const inputName of Object.keys(inputs)) {
      const options = getInputEnumOptions(info, inputName);
      if (options.length > 0) {
        optionsByInputName.set(inputName, { nodeId, inputName, options });
      }
    }

    for (const parentName of getOrderedInputNames(info)) {
      const parentDefinition = getObjectInfoInputDefinition(info, parentName);
      if (!isDynamicComboInputDefinition(parentDefinition)) continue;

      const selectedOption = getDynamicComboOption(parentDefinition, inputs[parentName]);
      if (!selectedOption) continue;

      for (const [nestedName, nestedDefinition] of getDynamicComboOptionInputDefinitions(
        selectedOption,
      )) {
        const dottedName = `${parentName}.${nestedName}`;
        const inputName =
          nestedName in inputs ? nestedName : dottedName in inputs ? dottedName : null;
        if (!inputName) continue;

        const options = getInputDefinitionEnumOptions(nestedDefinition);
        if (options.length > 0) {
          optionsByInputName.set(inputName, { nodeId, inputName, options });
        }
      }
    }

    return Array.from(optionsByInputName.values());
  });
};

const isComfyControlValue = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const collectGraphDefaultControlKeys = (
  graph: JsonObject,
  prompt: JsonObject,
  outputCandidates: ComfyWorkflowOutputCandidate[],
): string[] => {
  const keys = new Set<string>();
  const subgraphsById = getSubgraphsById(graph);

  const addPromptInput = (nodeId: string, inputName: string) => {
    const promptNode = prompt[nodeId];
    if (!isJsonObject(promptNode) || !isJsonObject(promptNode.inputs)) return;
    if (isComfyControlValue(promptNode.inputs[inputName])) keys.add(`${nodeId}:${inputName}`);
  };

  for (const node of getGraphNodes(graph)) {
    if (subgraphsById.has(node.type)) continue;
    const nodeId = String(node.id);
    const promptNode = prompt[nodeId];
    if (!isJsonObject(promptNode) || !isJsonObject(promptNode.inputs)) continue;
    for (const [inputName, value] of Object.entries(promptNode.inputs)) {
      if (isComfyControlValue(value)) keys.add(`${nodeId}:${inputName}`);
    }
  }

  for (const field of collectComfyGraphExposedFields(graph)) {
    for (const target of field.promptTargets) addPromptInput(target.nodeId, target.inputName);
  }

  for (const candidate of outputCandidates) {
    if (candidate.kind === 'synthetic') {
      for (const node of candidate.syntheticOutputNodes ?? []) {
        for (const [inputName, value] of Object.entries(node.inputs)) {
          if (isComfyControlValue(value)) keys.add(`${node.id}:${inputName}`);
        }
      }
      continue;
    }
    for (const [inputName, value] of Object.entries(candidate.outputNodeInputs ?? {})) {
      if (isComfyControlValue(value)) keys.add(`${candidate.previewNodeId}:${inputName}`);
    }
  }

  return [...keys].sort();
};

const convertComfyGraphWorkflowToPrompt = (
  workflow: JsonObject,
  objectInfo: ComfyObjectInfo,
): ComfyPromptExtractionResult => {
  const prompt: JsonObject = {};
  const context = createGraphContext({
    graph: workflow,
    objectInfo,
    prompt,
    subgraphsById: getSubgraphsById(workflow),
    expandedSubgraphs: new Set<string>(),
    unsupportedNodeTypes: new Set<string>(),
  });

  convertGraphContext(context);

  if (context.unsupportedNodeTypes.size > 0) {
    throw new Error(
      `Could not convert this ComfyUI workflow because these node types were not available from ComfyUI: ${[
        ...context.unsupportedNodeTypes,
      ].join(', ')}.`,
    );
  }

  const existingOutputCandidates = collectExistingOutputNodeCandidates(context);
  const syntheticOutputCandidates = collectSyntheticOutputCandidates(context, {
    unconnectedOnly: existingOutputCandidates.length > 0,
  });
  const topLevelOutputCandidates = [...existingOutputCandidates, ...syntheticOutputCandidates];
  const topLevelOutputIds = new Set(topLevelOutputCandidates.map((candidate) => candidate.id));
  const internalOutputCandidates = collectExistingPromptOutputNodeCandidates(
    context.prompt,
    context.objectInfo,
    undefined,
    'internal',
  ).filter((candidate) => !topLevelOutputIds.has(candidate.id));
  const outputCandidates = [...topLevelOutputCandidates, ...internalOutputCandidates];
  const selectedOutputIds = [
    ...existingOutputCandidates.map((candidate) => candidate.id),
    ...(syntheticOutputCandidates[0] ? [syntheticOutputCandidates[0].id] : []),
  ];

  const selectedSyntheticOutputCandidates = outputCandidates.filter(
    (candidate) => candidate.kind === 'synthetic' && selectedOutputIds.includes(candidate.id),
  );

  const selectedPreviewOutputCandidates = selectedSyntheticOutputCandidates.filter(
    (candidate) => getSyntheticOutputTerminalNode(candidate)?.nodeType === previewImageNodeType,
  );

  if (selectedPreviewOutputCandidates.length > 0 && !context.objectInfo[previewImageNodeType]) {
    throw new Error(
      'Could not append a ComfyUI preview output because PreviewImage is unavailable.',
    );
  }

  for (const candidate of selectedSyntheticOutputCandidates) {
    appendSyntheticOutputNodes(context, candidate);
  }

  const graphInputs = collectGraphInputCandidates(workflow, prompt, objectInfo);

  if (Object.keys(prompt).length === 0) {
    throw new Error('Could not convert this ComfyUI workflow into an API prompt.');
  }

  return {
    prompt,
    inputCandidates: graphInputs.candidates,
    selectedInputIds: graphInputs.selectedIds,
    controlOptions: collectPromptControlOptions(prompt, objectInfo),
    defaultControlKeys: collectGraphDefaultControlKeys(
      workflow,
      prompt,
      outputCandidates.filter((candidate) => selectedOutputIds.includes(candidate.id)),
    ),
    outputCandidates,
    selectedOutputIds,
  };
};

const getEmbeddedComfyPrompt = (workflow: JsonObject): JsonObject | null => {
  const extra = isJsonObject(workflow.extra) ? workflow.extra : null;
  const prompt = extra?.prompt;
  return isComfyApiPrompt(prompt) ? prompt : null;
};

const extractEmbeddedComfyPromptWithGraphInputs = (
  workflow: JsonObject,
  objectInfo: ComfyObjectInfo | undefined,
): ComfyPromptExtractionResult | null => {
  const prompt = getEmbeddedComfyPrompt(workflow);
  if (!prompt) return null;
  const graphInputs = collectGraphInputCandidates(workflow, prompt, objectInfo);

  return {
    prompt,
    inputCandidates: graphInputs.candidates,
    selectedInputIds: graphInputs.selectedIds,
    controlOptions: collectPromptControlOptions(prompt, objectInfo),
    defaultControlKeys: collectGraphDefaultControlKeys(workflow, prompt, []),
    outputCandidates: [],
    selectedOutputIds: [],
  };
};

const normalizeWorkflowFilePath = (path: string): string => {
  const withoutLeadingSlash = path.replace(/^\/+/, '');
  return withoutLeadingSlash.startsWith('workflows/')
    ? withoutLeadingSlash
    : `workflows/${withoutLeadingSlash}`;
};

const encodeUserDataPath = (path: string): string => encodeURIComponent(path);

const isComfyWorkflowFile = (value: unknown): value is ComfyWorkflowFile => {
  if (!isJsonObject(value) || typeof value.path !== 'string') return false;
  const lowerPath = value.path.toLowerCase();
  return lowerPath.endsWith('.json');
};

const getComfyWorkflowFilesFromBody = (body: unknown): ComfyWorkflowFile[] => {
  const items = Array.isArray(body)
    ? body
    : isJsonObject(body) && Array.isArray(body.files)
      ? body.files
      : [];

  return items.filter(isComfyWorkflowFile).map((item) => ({
    path: normalizeWorkflowFilePath(item.path),
    size: typeof item.size === 'number' ? item.size : undefined,
    modified: typeof item.modified === 'number' ? item.modified : undefined,
  }));
};

export const isComfyApiPrompt = (value: unknown): value is JsonObject => {
  if (!isJsonObject(value)) return false;
  const entries = Object.values(value);
  if (entries.length === 0) return false;
  return entries.every((entry) => {
    if (!isJsonObject(entry)) return false;
    return typeof entry.class_type === 'string' && isJsonObject(entry.inputs ?? {});
  });
};

export const getComfyWorkflowImportError = (value: unknown): string | null => {
  if (isComfyApiPrompt(value)) return null;
  if (isJsonObject(value) && isComfyApiPrompt(value.prompt)) return null;
  if (isComfyGraphWorkflow(value)) {
    return 'This looks like a ComfyUI graph workflow. Studio can convert it when connected to a matching ComfyUI backend.';
  }
  return 'Import an API-format ComfyUI workflow JSON. The root object should contain node ids with class_type and inputs.';
};

export const extractComfyPrompt = (value: unknown, objectInfo?: ComfyObjectInfo): JsonObject => {
  if (isComfyApiPrompt(value)) return value;
  if (isJsonObject(value) && isComfyApiPrompt(value.prompt)) return value.prompt;
  if (isComfyGraphWorkflow(value) && objectInfo) {
    try {
      return convertComfyGraphWorkflowToPrompt(value, objectInfo).prompt;
    } catch (error) {
      const fallback = extractEmbeddedComfyPromptWithGraphInputs(value, objectInfo);
      if (fallback) return fallback.prompt;
      throw error;
    }
  }
  if (isComfyGraphWorkflow(value)) {
    const fallback = extractEmbeddedComfyPromptWithGraphInputs(value, objectInfo);
    if (fallback) return fallback.prompt;
  }
  throw new Error(getComfyWorkflowImportError(value) ?? 'Invalid ComfyUI workflow JSON.');
};

export const extractComfyPromptWithOutputs = (
  value: unknown,
  objectInfo?: ComfyObjectInfo,
): ComfyPromptExtractionResult => {
  if (isComfyApiPrompt(value)) {
    const outputCandidates = collectExistingPromptOutputNodeCandidates(value, objectInfo ?? {});
    const inputCandidates = collectPromptInputCandidates(value, objectInfo);
    return {
      prompt: value,
      inputCandidates,
      selectedInputIds: inputCandidates.map((candidate) => candidate.id),
      controlOptions: collectPromptControlOptions(value, objectInfo),
      outputCandidates,
      selectedOutputIds: outputCandidates.map((candidate) => candidate.id),
    };
  }
  if (isJsonObject(value) && isComfyApiPrompt(value.prompt)) {
    const outputCandidates = collectExistingPromptOutputNodeCandidates(
      value.prompt,
      objectInfo ?? {},
    );
    const inputCandidates = collectPromptInputCandidates(value.prompt, objectInfo);
    return {
      prompt: value.prompt,
      inputCandidates,
      selectedInputIds: inputCandidates.map((candidate) => candidate.id),
      controlOptions: collectPromptControlOptions(value.prompt, objectInfo),
      outputCandidates,
      selectedOutputIds: outputCandidates.map((candidate) => candidate.id),
    };
  }
  if (isComfyGraphWorkflow(value) && objectInfo) {
    try {
      return convertComfyGraphWorkflowToPrompt(value, objectInfo);
    } catch (error) {
      const fallback = extractEmbeddedComfyPromptWithGraphInputs(value, objectInfo);
      if (fallback) return fallback;
      throw error;
    }
  }
  if (isComfyGraphWorkflow(value)) {
    const fallback = extractEmbeddedComfyPromptWithGraphInputs(value, objectInfo);
    if (fallback) return fallback;
  }
  throw new Error(getComfyWorkflowImportError(value) ?? 'Invalid ComfyUI workflow JSON.');
};

const cloneJsonObject = (value: JsonObject): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;

export const selectComfyPromptOutputs = ({
  prompt,
  outputCandidates = [],
  selectedOutputIds = [],
}: {
  prompt: Record<string, unknown>;
  outputCandidates?: ComfyWorkflowOutputCandidate[];
  selectedOutputIds?: string[];
}): Record<string, unknown> => {
  const nextPrompt = cloneJsonObject(prompt);
  const outputCandidateIds = new Set(outputCandidates.map((candidate) => candidate.id));
  const selectedIds = selectedOutputIds.filter((id) => outputCandidateIds.has(id));

  for (const candidate of outputCandidates) {
    if (candidate.kind === 'synthetic' || !selectedIds.includes(candidate.id)) {
      for (const node of candidate.syntheticOutputNodes ?? []) {
        delete nextPrompt[node.id];
      }
      if (candidate.kind !== 'synthetic') delete nextPrompt[candidate.previewNodeId];
    }
  }

  for (const candidate of outputCandidates) {
    if (candidate.kind !== 'synthetic' || !selectedIds.includes(candidate.id)) continue;
    for (const node of candidate.syntheticOutputNodes ?? []) {
      nextPrompt[node.id] = {
        class_type: node.nodeType,
        inputs: node.inputs,
      };
    }
  }

  return nextPrompt;
};

export const applyComfyWorkflowInputImages = (
  prompt: Record<string, unknown>,
  inputImages: Array<{
    candidate: Pick<
      ComfyWorkflowInputCandidate,
      'nodeId' | 'inputName' | 'nodeType' | 'promptTargets'
    >;
    imageName: string;
  }>,
): Record<string, unknown> => {
  const nextPrompt = cloneJsonObject(prompt);

  for (const { candidate, imageName } of inputImages) {
    const isLoadMedia = isLoadMediaNodeType(candidate.nodeType ?? '');

    if (isLoadMedia) {
      const promptNode = nextPrompt[candidate.nodeId];
      if (!isJsonObject(promptNode)) continue;
      const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
      promptNode.inputs = { ...inputs, [candidate.inputName]: imageName };
    } else {
      const loadNodeId = getUniquePromptNodeId(
        nextPrompt,
        `blackboard_input_load_${candidate.nodeId}_${candidate.inputName}`,
      );
      nextPrompt[loadNodeId] = {
        class_type: 'LoadImage',
        inputs: { image: imageName },
      };
      const targets =
        candidate.promptTargets && candidate.promptTargets.length > 0
          ? candidate.promptTargets
          : [{ nodeId: candidate.nodeId, inputName: candidate.inputName }];

      for (const target of targets) {
        const promptNode = nextPrompt[target.nodeId];
        if (!isJsonObject(promptNode)) continue;
        const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
        promptNode.inputs = { ...inputs, [target.inputName]: [loadNodeId, 0] };
      }
    }
  }

  return nextPrompt;
};

const getComfyUploadedImageName = (body: unknown): string => {
  if (!isJsonObject(body) || typeof body.name !== 'string' || !body.name.trim()) {
    throw new Error('ComfyUI returned an unexpected image upload response.');
  }

  const subfolder = typeof body.subfolder === 'string' ? body.subfolder.trim() : '';
  return subfolder ? `${subfolder.replace(/\/+$/, '')}/${body.name}` : body.name;
};

export const uploadComfyInputImage = async ({
  endpoint,
  image,
  filename,
  signal,
}: {
  endpoint: string;
  image: Blob;
  filename: string;
  signal?: AbortSignal;
}): Promise<string> => {
  const formData = new FormData();
  formData.set('image', image, filename);
  formData.set('type', 'input');
  formData.set('subfolder', 'blackboard');
  formData.set('overwrite', 'true');

  const response = await fetchComfy(endpoint, '/upload/image', {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Could not upload input image to ComfyUI.'));
  }

  return getComfyUploadedImageName(await readJson(response));
};

export const fetchComfyObjectInfo = async (endpoint: string): Promise<ComfyObjectInfo> => {
  const response = await fetchComfy(endpoint, '/object_info');
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Could not read ComfyUI node definitions.'));
  }

  const body = await readJson(response);
  if (!isJsonObject(body)) {
    throw new Error('ComfyUI returned unexpected node definitions.');
  }

  return body as ComfyObjectInfo;
};

export const listComfyWorkflowFiles = async (endpoint: string): Promise<ComfyWorkflowFile[]> => {
  const params = new URLSearchParams({
    dir: 'workflows/',
    recurse: 'true',
    full_info: 'true',
  });
  const response = await fetchComfy(endpoint, '/userdata', undefined, params);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Could not list ComfyUI workflows.'));
  }

  return getComfyWorkflowFilesFromBody(await readJson(response));
};

export const fetchComfyWorkflowFile = async (endpoint: string, path: string): Promise<unknown> => {
  const workflowPath = normalizeWorkflowFilePath(path);
  const response = await fetchComfy(endpoint, `/userdata/${encodeUserDataPath(workflowPath)}`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Could not read the ComfyUI workflow file.'));
  }

  return readJson(response);
};

export const testComfyConnection = async (endpoint: string): Promise<void> => {
  const normalizedEndpoint = normalizeComfyEndpoint(endpoint);
  const statsResponse = await fetchComfy(normalizedEndpoint, '/system_stats');
  if (statsResponse.ok && isLikelyComfySystemStats(await readJson(statsResponse))) return;

  const objectInfoResponse = await fetchComfy(normalizedEndpoint, '/object_info');
  const objectInfoBody = await readJson(objectInfoResponse);
  if (objectInfoResponse.ok && isLikelyComfyObjectInfo(objectInfoBody)) return;

  throw new Error(
    objectInfoResponse.ok
      ? `Endpoint responded, but it did not look like ComfyUI at ${normalizedEndpoint}.`
      : getErrorMessageFromBody(
          objectInfoBody,
          `ComfyUI did not respond at ${normalizedEndpoint}.`,
        ),
  );
};

export const interruptComfyPrompt = async (_promptId: string, endpoint: string): Promise<void> => {
  try {
    await fetchComfy(endpoint, '/interrupt', { method: 'POST' });
  } catch {
    console.warn('Failed to interrupt prompt in ComfyUI');
  }
};

export const queueComfyPrompt = async ({
  endpoint,
  prompt,
  clientId,
  extraData,
}: {
  endpoint: string;
  prompt: JsonObject;
  clientId: string;
  extraData?: JsonObject;
}): Promise<ComfyPromptQueueResult> => {
  const response = await fetchComfy(endpoint, '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      client_id: clientId,
      ...(extraData ? { extra_data: extraData } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'ComfyUI rejected the workflow prompt.'));
  }

  const body = await readJson(response);
  if (!isJsonObject(body) || typeof body.prompt_id !== 'string') {
    throw new Error('ComfyUI returned an unexpected queue response.');
  }

  return {
    promptId: body.prompt_id,
    number: typeof body.number === 'number' ? body.number : undefined,
  };
};

export const parseComfyProgressMessage = (value: unknown): ComfyProgressEvent | null => {
  if (!isJsonObject(value) || typeof value.type !== 'string') return null;
  const data = isJsonObject(value.data) ? value.data : {};
  const promptId = typeof data.prompt_id === 'string' ? data.prompt_id : undefined;
  const nodeId =
    typeof data.node === 'string' || data.node === null ? (data.node as string | null) : undefined;

  switch (value.type) {
    case 'execution_start':
      return { type: 'started', promptId };
    case 'executing':
      return {
        type: nodeId === null ? 'complete' : 'executing',
        promptId,
        nodeId,
      };
    case 'progress': {
      const progressValue = typeof data.value === 'number' ? data.value : undefined;
      const max = typeof data.max === 'number' ? data.max : undefined;
      return {
        type: 'progress',
        promptId,
        nodeId,
        value: progressValue,
        max,
      };
    }
    case 'execution_error': {
      const exceptionMessage =
        typeof data.exception_message === 'string' ? data.exception_message : undefined;
      const nodeType = typeof data.node_type === 'string' ? data.node_type : undefined;
      return {
        type: 'error',
        promptId,
        nodeId,
        message: exceptionMessage ?? (nodeType ? `ComfyUI node failed: ${nodeType}.` : undefined),
      };
    }
    default:
      return null;
  }
};

export const subscribeComfyProgress = ({
  endpoint,
  clientId,
  signal,
  onProgress,
  onError,
}: {
  endpoint: string;
  clientId: string;
  signal?: AbortSignal;
  onProgress: (event: ComfyProgressEvent) => void;
  onError?: (message: string) => void;
}): (() => void) => {
  if (typeof WebSocket === 'undefined') return () => {};

  let socket: WebSocket | null = null;
  let closed = false;

  const close = () => {
    closed = true;
    signal?.removeEventListener('abort', close);
    if (
      socket &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.close();
    }
    socket = null;
  };

  try {
    socket = new WebSocket(buildComfyWebSocketUrl(endpoint, clientId));
  } catch {
    onError?.('Could not open ComfyUI progress stream.');
    return close;
  }

  signal?.addEventListener('abort', close, { once: true });

  socket.addEventListener('message', (event) => {
    if (closed) return;
    try {
      const progressEvent = parseComfyProgressMessage(JSON.parse(String(event.data)));
      if (progressEvent) onProgress(progressEvent);
    } catch {
      // Ignore malformed progress frames; history polling still determines run success.
    }
  });

  socket.addEventListener('error', () => {
    if (!closed) onError?.('ComfyUI progress stream disconnected.');
  });

  return close;
};

const getHistoryItem = (history: unknown, promptId: string): JsonObject | null => {
  if (!isJsonObject(history)) return null;
  const keyed = history[promptId];
  if (isJsonObject(keyed)) return keyed;
  if (isJsonObject(history.outputs) || isJsonObject(history.status)) return history;
  return null;
};

const getHistoryError = (historyItem: JsonObject): string | null => {
  const status = historyItem.status;
  if (!isJsonObject(status)) return null;
  const statusString = status.status_str;
  if (statusString === 'error') {
    const messages = status.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      return `ComfyUI workflow failed: ${String(messages[messages.length - 1])}`;
    }
    return 'ComfyUI workflow failed.';
  }
  return null;
};

const isSuccessfulHistoryItem = (historyItem: JsonObject): boolean => {
  const status = historyItem.status;
  if (!isJsonObject(status)) return false;
  return status.status_str === 'success' || status.completed === true;
};

export const collectComfyHistoryOutputFiles = (historyItem: JsonObject): ComfyOutputFile[] => {
  const outputs = historyItem.outputs;
  if (!isJsonObject(outputs)) return [];

  const files: ComfyOutputFile[] = [];
  const outputKeys: Array<{ key: string; kind?: 'image' | 'video' | '3d' }> = [
    { key: 'images', kind: 'image' },
    { key: 'videos', kind: 'video' },
    { key: 'gifs', kind: 'video' },
    { key: 'animated', kind: 'video' },
    { key: '3d', kind: '3d' },
  ];

  for (const [nodeId, output] of Object.entries(outputs)) {
    if (!isJsonObject(output)) continue;
    for (const { key, kind } of outputKeys) {
      const outputEntries = output[key];
      if (!Array.isArray(outputEntries)) continue;

      for (const candidate of outputEntries) {
        if (
          !isJsonObject(candidate) ||
          typeof candidate.filename !== 'string' ||
          candidate.filename.trim().length === 0
        ) {
          continue;
        }

        files.push({
          nodeId,
          kind,
          filename: candidate.filename,
          subfolder: typeof candidate.subfolder === 'string' ? candidate.subfolder : undefined,
          type: typeof candidate.type === 'string' ? candidate.type : undefined,
        });
      }
    }
  }

  return files;
};

export const selectComfyOutputFiles = (
  files: ComfyOutputFile[],
  outputNodeIds: string[] | undefined,
): ComfyOutputFile[] => {
  if (!outputNodeIds?.length) return files;
  const orderByNodeId = new Map(outputNodeIds.map((nodeId, index) => [nodeId, index]));
  return files
    .filter((file) => Boolean(file.nodeId && orderByNodeId.has(file.nodeId)))
    .sort((a, b) => {
      const aOrder = a.nodeId ? orderByNodeId.get(a.nodeId) : undefined;
      const bOrder = b.nodeId ? orderByNodeId.get(b.nodeId) : undefined;
      return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
    });
};

const queueEntryHasPromptId = (value: unknown, promptId: string): boolean => {
  if (typeof value === 'string') return value === promptId;
  if (Array.isArray(value)) return value.some((item) => queueEntryHasPromptId(item, promptId));
  if (!isJsonObject(value)) return false;

  const candidatePromptId =
    typeof value.prompt_id === 'string'
      ? value.prompt_id
      : typeof value.promptId === 'string'
        ? value.promptId
        : undefined;
  if (candidatePromptId === promptId) return true;

  return Object.values(value).some((item) => queueEntryHasPromptId(item, promptId));
};

export const fetchComfyPromptStatus = async ({
  endpoint,
  promptId,
  outputNodeIds,
  signal,
}: {
  endpoint: string;
  promptId: string;
  outputNodeIds?: string[];
  signal?: AbortSignal;
}): Promise<ComfyPromptStatus> => {
  const expectedNodeIds = new Set(outputNodeIds ?? []);
  const historyResponse = await fetchComfy(endpoint, `/history/${promptId}`, { signal });
  if (!historyResponse.ok) {
    throw new Error(await getErrorMessage(historyResponse, 'Could not read ComfyUI history.'));
  }

  const historyBody = await readJson(historyResponse);
  const historyItem = getHistoryItem(historyBody, promptId);
  if (historyItem) {
    const error = getHistoryError(historyItem);
    if (error) return { status: 'error', message: error };

    const files = selectComfyOutputFiles(
      collectComfyHistoryOutputFiles(historyItem),
      outputNodeIds,
    );
    const outputNodeIdsWithFiles = new Set(files.map((file) => file.nodeId).filter(Boolean));
    const hasExpectedOutputs =
      expectedNodeIds.size > 0
        ? [...expectedNodeIds].every((nodeId) => outputNodeIdsWithFiles.has(nodeId))
        : files.length > 0;

    if (hasExpectedOutputs || isSuccessfulHistoryItem(historyItem)) {
      return files.length > 0
        ? { status: 'success', outputs: files }
        : {
            status: 'error',
            message: 'ComfyUI completed the workflow, but no output file was found.',
          };
    }
  }

  const queueResponse = await fetchComfy(endpoint, '/queue', { signal });
  if (!queueResponse.ok) {
    throw new Error(await getErrorMessage(queueResponse, 'Could not read ComfyUI queue.'));
  }

  const queueBody = await readJson(queueResponse);
  if (isJsonObject(queueBody)) {
    if (queueEntryHasPromptId(queueBody.queue_running, promptId)) return { status: 'running' };
    if (queueEntryHasPromptId(queueBody.queue_pending, promptId)) return { status: 'queued' };
  }

  return { status: 'missing' };
};

export const waitForComfyOutputFiles = async ({
  endpoint,
  promptId,
  outputNodeIds,
  signal,
  onPoll,
  pollIntervalMs = 1500,
  timeoutMs = 7200000,
}: {
  endpoint: string;
  promptId: string;
  outputNodeIds?: string[];
  signal?: AbortSignal;
  onPoll?: (attempt: number) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<ComfyOutputFile[]> => {
  const startedAt = Date.now();
  let attempt = 0;
  const expectedNodeIds = new Set(outputNodeIds ?? []);

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw new DOMException('ComfyUI run cancelled.', 'AbortError');
    attempt += 1;
    onPoll?.(attempt);

    const response = await fetchComfy(endpoint, `/history/${promptId}`, {
      signal,
    });
    if (!response.ok) {
      throw new Error(await getErrorMessage(response, 'Could not read ComfyUI history.'));
    }

    const body = await readJson(response);
    const historyItem = getHistoryItem(body, promptId);
    if (historyItem) {
      const error = getHistoryError(historyItem);
      if (error) throw new Error(error);

      const files = selectComfyOutputFiles(
        collectComfyHistoryOutputFiles(historyItem),
        outputNodeIds,
      );
      if (expectedNodeIds.size > 0) {
        const outputNodeIdsWithFiles = new Set(files.map((file) => file.nodeId).filter(Boolean));
        if ([...expectedNodeIds].every((nodeId) => outputNodeIdsWithFiles.has(nodeId))) {
          return files;
        }
      } else if (files.length > 0) {
        return files;
      }

      if (isSuccessfulHistoryItem(historyItem)) {
        if (files.length > 0) return files;
        throw new Error('ComfyUI completed the workflow, but no output file was found.');
      }
    }

    await delay(pollIntervalMs);
  }

  throw new Error('Timed out waiting for ComfyUI to finish the workflow.');
};

export const fetchComfyOutputFile = async ({
  endpoint,
  file,
  signal,
}: {
  endpoint: string;
  file: ComfyOutputFile;
  signal?: AbortSignal;
}): Promise<Blob> => {
  const params = new URLSearchParams({ filename: file.filename });
  if (file.subfolder) params.set('subfolder', file.subfolder);
  if (file.type) params.set('type', file.type);

  const response = await fetchComfyView(endpoint, params, { signal });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Could not download ComfyUI output file.'));
  }
  return response.blob();
};
