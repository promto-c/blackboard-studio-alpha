import type { OnnxInputMetadata, OnnxOutputMetadata } from '@blackboard/types';
import { inferInputKind, inferOutputKind, isDynamicShape, formatOnnxShape } from './onnxShape';

const ELEM_TYPE_NAMES: Record<number, string> = {
  1: 'float32',
  2: 'uint8',
  3: 'int8',
  4: 'uint16',
  5: 'int16',
  6: 'int32',
  7: 'int64',
  8: 'string',
  9: 'bool',
  10: 'float16',
  11: 'double',
  12: 'uint32',
  13: 'uint64',
  14: 'complex64',
  15: 'complex128',
  16: 'bfloat16',
};

const textDecoder = new TextDecoder();

interface OnnxIoMetadata {
  inputs: OnnxInputMetadata[];
  outputs: OnnxOutputMetadata[];
}

const INITIAL_ONNX_METADATA_SCAN_BYTES = 1024 * 1024;
const MAX_ONNX_METADATA_SCAN_BYTES = 256 * 1024 * 1024;

type ProtobufField = {
  fieldNumber: number;
  wireType: number;
  value: number;
  length: number;
  offset: number;
};

const protobufDecodeVarint = (view: DataView, offset: number): [number, number] | null => {
  let value = 0;
  let shift = 0;

  while (offset < view.byteLength) {
    const byte = view.getUint8(offset);
    offset += 1;

    value += (byte & 0x7f) * 2 ** shift;

    if ((byte & 0x80) === 0) {
      return [value, offset];
    }

    shift += 7;

    if (shift > 53) {
      return null;
    }
  }

  return null;
};

const protobufReadField = (view: DataView, offset: number): ProtobufField | null => {
  if (offset >= view.byteLength) {
    return null;
  }

  const decodedTag = protobufDecodeVarint(view, offset);

  if (!decodedTag) {
    return null;
  }

  const [tag, next] = decodedTag;
  const fieldNumber = tag >> 3;
  const wireType = tag & 0x07;

  if (wireType === 0) {
    const decodedValue = protobufDecodeVarint(view, next);

    if (!decodedValue) {
      return null;
    }

    return {
      fieldNumber,
      wireType,
      value: decodedValue[0],
      length: 0,
      offset: decodedValue[1],
    };
  }

  if (wireType === 1) {
    if (next + 8 > view.byteLength) {
      return null;
    }

    return {
      fieldNumber,
      wireType,
      value: 0,
      length: 8,
      offset: next + 8,
    };
  }

  if (wireType === 2) {
    const decodedLength = protobufDecodeVarint(view, next);

    if (!decodedLength) {
      return null;
    }

    return {
      fieldNumber,
      wireType,
      value: 0,
      length: decodedLength[0],
      offset: decodedLength[1],
    };
  }

  if (wireType === 5) {
    if (next + 4 > view.byteLength) {
      return null;
    }

    return {
      fieldNumber,
      wireType,
      value: 0,
      length: 4,
      offset: next + 4,
    };
  }

  return null;
};

const getFieldEnd = (field: ProtobufField): number => {
  if (field.wireType === 2) {
    return field.offset + field.length;
  }

  return field.offset;
};

const skipField = (view: DataView, offset: number, max: number): number => {
  const field = protobufReadField(view, offset);

  if (!field) {
    return max;
  }

  return Math.min(getFieldEnd(field), max);
};

// --- metadata constructors ---

const createInputMetadata = (name: string, type: string, dims: number[]): OnnxInputMetadata => ({
  name,
  type,
  dims,
  isDynamic: isDynamicShape(dims),
  dimsLabel: dims.length > 0 ? formatOnnxShape(dims) : 'unknown',
  kind: inferInputKind(dims, type),
});

const createOutputMetadata = (name: string, type: string, dims: number[]): OnnxOutputMetadata => ({
  name,
  type,
  dims,
  isDynamic: isDynamicShape(dims),
  dimsLabel: dims.length > 0 ? formatOnnxShape(dims) : 'unknown',
  kind: inferOutputKind(dims, type),
});

// --- protobuf-level ONNX model parsing ---

const findGraphProtoRange = (view: DataView): [number, number] | null => {
  let offset = 0;

  while (offset < view.byteLength) {
    const field = protobufReadField(view, offset);

    if (!field) {
      return null;
    }

    if (field.fieldNumber === 7 && field.wireType === 2) {
      return [field.offset, field.offset + field.length];
    }

    const nextOffset = getFieldEnd(field);

    if (nextOffset <= offset) {
      return null;
    }

    offset = nextOffset;
  }

  return null;
};

const parseDimension = (view: DataView, start: number, end: number): number => {
  let offset = start;

  while (offset < end && offset < view.byteLength) {
    const field = protobufReadField(view, offset);

    if (!field) {
      break;
    }

    if (field.fieldNumber === 1 && field.wireType === 0) {
      return field.value;
    }

    if (field.fieldNumber === 2 && field.wireType === 2) {
      return -1;
    }

    offset = skipField(view, offset, end);
  }

  return -1;
};

const parseTensorShape = (view: DataView, start: number, end: number): number[] => {
  const dims: number[] = [];
  let offset = start;

  while (offset < end && offset < view.byteLength) {
    const field = protobufReadField(view, offset);

    if (!field) {
      break;
    }

    const valueEnd = field.offset + field.length;

    if (field.fieldNumber === 1 && field.wireType === 2) {
      dims.push(parseDimension(view, field.offset, valueEnd));
      offset = valueEnd;
      continue;
    }

    offset = skipField(view, offset, end);
  }

  return dims;
};

const parseTensorType = (
  view: DataView,
  start: number,
  end: number,
): { elemType?: number; dims: number[] } => {
  let offset = start;
  let elemType: number | undefined;
  let dims: number[] = [];

  while (offset < end && offset < view.byteLength) {
    const field = protobufReadField(view, offset);

    if (!field) {
      break;
    }

    const valueEnd = field.offset + field.length;

    if (field.fieldNumber === 1 && field.wireType === 0) {
      elemType = field.value;
      offset = field.offset;
      continue;
    }

    if (field.fieldNumber === 2 && field.wireType === 2) {
      dims = parseTensorShape(view, field.offset, valueEnd);
      offset = valueEnd;
      continue;
    }

    offset = skipField(view, offset, end);
  }

  return { elemType, dims };
};

const parseTypeProto = (
  view: DataView,
  start: number,
  end: number,
): { elemTypeName: string; dims: number[] } => {
  let offset = start;
  let elemTypeName = 'unknown';
  let dims: number[] = [];

  while (offset < end && offset < view.byteLength) {
    const field = protobufReadField(view, offset);

    if (!field) {
      break;
    }

    const valueEnd = field.offset + field.length;

    if (field.fieldNumber === 1 && field.wireType === 2) {
      const tensorType = parseTensorType(view, field.offset, valueEnd);

      if (tensorType.elemType !== undefined) {
        elemTypeName = ELEM_TYPE_NAMES[tensorType.elemType] ?? 'unknown';
      }

      dims = tensorType.dims;
      offset = valueEnd;
      continue;
    }

    offset = skipField(view, offset, end);
  }

  return { elemTypeName, dims };
};

const parseValueInfo = (
  view: DataView,
  start: number,
  end: number,
): { name: string; elemTypeName: string; dims: number[] } | null => {
  let offset = start;
  let name = '';
  let elemTypeName = 'unknown';
  let dims: number[] = [];

  while (offset < end && offset < view.byteLength) {
    const field = protobufReadField(view, offset);

    if (!field) {
      break;
    }

    const valueEnd = field.offset + field.length;

    if (field.fieldNumber === 1 && field.wireType === 2) {
      if (valueEnd > view.byteLength) {
        return null;
      }

      const bytes = new Uint8Array(view.buffer, field.offset, field.length);
      name = textDecoder.decode(bytes);
      offset = valueEnd;
      continue;
    }

    if (field.fieldNumber === 2 && field.wireType === 2) {
      const typeInfo = parseTypeProto(view, field.offset, valueEnd);
      elemTypeName = typeInfo.elemTypeName;
      dims = typeInfo.dims;
      offset = valueEnd;
      continue;
    }

    offset = skipField(view, offset, end);
  }

  if (!name) {
    return null;
  }

  return {
    name,
    elemTypeName,
    dims,
  };
};

const readOnnxMetadataFromScannedBuffer = (buffer: ArrayBuffer): OnnxIoMetadata | null => {
  try {
    const view = new DataView(buffer);
    const graphRange = findGraphProtoRange(view);

    if (!graphRange) {
      return null;
    }

    const [graphStart, graphEnd] = graphRange;
    const inputs: OnnxInputMetadata[] = [];
    const outputs: OnnxOutputMetadata[] = [];

    let offset = graphStart;
    let hasSeenOutputField = false;

    while (offset < graphEnd && offset < view.byteLength) {
      const field = protobufReadField(view, offset);

      if (!field) {
        break;
      }

      const valueEnd = field.offset + field.length;

      if (valueEnd > view.byteLength) {
        break;
      }

      if (field.fieldNumber === 11 && field.wireType === 2) {
        const parsed = parseValueInfo(view, field.offset, valueEnd);

        if (parsed) {
          inputs.push(createInputMetadata(parsed.name, parsed.elemTypeName, parsed.dims));
        }
      }

      if (field.fieldNumber === 12 && field.wireType === 2) {
        hasSeenOutputField = true;

        const parsed = parseValueInfo(view, field.offset, valueEnd);

        if (parsed) {
          outputs.push(createOutputMetadata(parsed.name, parsed.elemTypeName, parsed.dims));
        }
      }

      offset = valueEnd;

      if (
        hasSeenOutputField &&
        inputs.length > 0 &&
        outputs.length > 0 &&
        field.fieldNumber !== 12
      ) {
        break;
      }
    }

    if (inputs.length === 0 && outputs.length === 0) {
      return null;
    }

    return {
      inputs,
      outputs,
    };
  } catch {
    return null;
  }
};

export const readOnnxMetadataFromBlobProgressively = async (
  blob: Blob,
): Promise<{ inputs: OnnxInputMetadata[]; outputs: OnnxOutputMetadata[] } | null> => {
  let scanBytes = Math.min(INITIAL_ONNX_METADATA_SCAN_BYTES, blob.size);

  while (scanBytes <= blob.size && scanBytes <= MAX_ONNX_METADATA_SCAN_BYTES) {
    const buffer = await blob.slice(0, scanBytes).arrayBuffer();
    const parsed = readOnnxMetadataFromScannedBuffer(buffer);

    if (parsed && parsed.inputs.length > 0 && parsed.outputs.length > 0) {
      return parsed;
    }

    if (scanBytes >= blob.size) {
      break;
    }

    scanBytes = Math.min(scanBytes * 2, blob.size);
  }

  return null;
};
