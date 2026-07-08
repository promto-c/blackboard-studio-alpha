import * as THREE from 'three';

const assertFloatingRenderTarget = (target: THREE.WebGLRenderTarget): void => {
  if (target.texture.type !== THREE.FloatType && target.texture.type !== THREE.HalfFloatType) {
    throw new Error('Internal render-target readback requires floating-point RGBA data.');
  }
};

/**
 * External renderers can use WebGL2 pixel-pack buffers for asynchronous GPU
 * readback and leave one bound between frames. Three.js CPU readback passes a
 * TypedArray directly to gl.readPixels, which is invalid while a PBO is bound.
 */
const readRenderTargetPixelsToCpu = (
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  x: number,
  y: number,
  width: number,
  height: number,
  buffer: Float32Array | Uint16Array,
): void => {
  const gl = renderer.getContext?.() as WebGL2RenderingContext | undefined;
  const canManagePixelPackBuffer =
    gl &&
    typeof gl.PIXEL_PACK_BUFFER === 'number' &&
    typeof gl.PIXEL_PACK_BUFFER_BINDING === 'number' &&
    typeof gl.getParameter === 'function' &&
    typeof gl.bindBuffer === 'function';
  const previousPixelPackBuffer = canManagePixelPackBuffer
    ? (gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null)
    : null;

  if (previousPixelPackBuffer) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }
  try {
    renderer.readRenderTargetPixels(target, x, y, width, height, buffer);
  } finally {
    if (previousPixelPackBuffer) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPixelPackBuffer);
    }
  }
};

const readFloatingComponents = (
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  x: number,
  y: number,
  width: number,
  height: number,
): Float32Array => {
  assertFloatingRenderTarget(target);
  const componentCount = width * height * 4;

  if (target.texture.type === THREE.FloatType) {
    const values = new Float32Array(componentCount);
    readRenderTargetPixelsToCpu(renderer, target, x, y, width, height, values);
    return values;
  }

  const encoded = new Uint16Array(componentCount);
  const values = new Float32Array(componentCount);
  readRenderTargetPixelsToCpu(renderer, target, x, y, width, height, encoded);
  for (let index = 0; index < componentCount; index += 1) {
    values[index] = THREE.DataUtils.fromHalfFloat(encoded[index]);
  }
  return values;
};

export const readRenderTargetPixelRgbaFloat = (
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  x: number,
  y: number,
): [number, number, number, number] => {
  const values = readFloatingComponents(renderer, target, x, y, 1, 1);
  return [values[0], values[1], values[2], values[3]];
};

export const readRenderTargetRgbaFloat = (
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  options: { flipY?: boolean } = {},
): Float32Array => {
  const { width, height } = target;
  const source = readFloatingComponents(renderer, target, 0, 0, width, height);
  if (options.flipY === false) return source;

  const output = new Float32Array(source.length);
  const rowLength = width * 4;
  for (let sourceY = 0; sourceY < height; sourceY += 1) {
    const targetY = height - sourceY - 1;
    output.set(
      source.subarray(sourceY * rowLength, (sourceY + 1) * rowLength),
      targetY * rowLength,
    );
  }
  return output;
};
