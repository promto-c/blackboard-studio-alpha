import * as THREE from 'three';
import type { AnyNode, FeatureMatchNode } from '@blackboard/types';
import { isPromiseLike, type ResolveOutputContext } from '@blackboard/renderer';

/**
 * Single-pass shader that composites the warped source OVER the reference.
 * Reference is the background, warped source is layered on top.
 *
 * The transform matrix operates in top-left origin pixel coordinates
 * [0, W] × [0, H], matching the convention used by fitTrackedTransform
 * and the optical flow feature tracking pipeline.
 */
const FEATURE_MATCH_COMPOSITE_SHADER = `
  precision highp float;
  in vec2 v_uv;
  out vec4 fragColor;

  uniform sampler2D u_tSource;
  uniform sampler2D u_tReference;
  uniform mat3 u_warpMatrix;
  uniform vec2 u_scene_res;
  uniform bool u_hasWarp;

  void main() {
    // Sample reference (background)
    vec4 refColor = texture(u_tReference, v_uv);

    if (!u_hasWarp) {
      // No warp — just show the reference
      fragColor = refColor;
      return;
    }

    // Convert UV [0,1] to top-left origin pixel coordinates.
    // The matrix was computed by fitTrackedTransform which operates in
    // top-left pixel space (same as the optical flow tracking).
    vec2 pixel = v_uv * u_scene_res;

    // Apply the FORWARD warp matrix: maps reference pixel -> source pixel.
    // fitTrackedTransform returns a model that maps reference positions
    // to source positions. For each output pixel (reference space), we
    // find the corresponding source pixel using this forward mapping.
    vec3 srcCoord = u_warpMatrix * vec3(pixel, 1.0);
    vec2 srcPixel = srcCoord.xy / srcCoord.z;

    // Convert back to UV [0,1]
    vec2 srcUV = srcPixel / u_scene_res;

    // Clamp to valid UV range to avoid edge stretching artifacts
    bool inside = srcUV.x >= 0.0 && srcUV.x <= 1.0 && srcUV.y >= 0.0 && srcUV.y <= 1.0;

    vec4 srcColor = inside
      ? texture(u_tSource, srcUV)
      : vec4(0.0);

    // Source-over-alpha compositing (straight alpha — matches pipeline convention)
    float srcA = srcColor.a;
    float refA = refColor.a;
    float outAlpha = srcA + refA * (1.0 - srcA);
    vec3 outColor;
    if (outAlpha > 0.0) {
      outColor = (srcColor.rgb * srcA + refColor.rgb * refA * (1.0 - srcA)) / outAlpha;
    } else {
      outColor = vec3(0.0);
    }
    fragColor = vec4(outColor, outAlpha);
  }
`;

const IDENTITY_MATRIX_3: number[][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Invert a 3x3 homography matrix (row-major array of arrays).
 */
export function invertMatrix3(m: number[][]): number[][] | null {
  const n11 = m[0][0],
    n12 = m[0][1],
    n13 = m[0][2];
  const n21 = m[1][0],
    n22 = m[1][1],
    n23 = m[1][2];
  const n31 = m[2][0],
    n32 = m[2][1],
    n33 = m[2][2];

  const t11 = n33 * n22 - n32 * n23;
  const t12 = n32 * n13 - n33 * n12;
  const t13 = n23 * n12 - n22 * n13;
  const det = n11 * t11 + n21 * t12 + n31 * t13;

  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;

  return [
    [t11 * invDet, (n31 * n23 - n33 * n21) * invDet, (n32 * n21 - n31 * n22) * invDet],
    [t12 * invDet, (n33 * n11 - n31 * n13) * invDet, (n31 * n12 - n32 * n11) * invDet],
    [t13 * invDet, (n21 * n13 - n23 * n11) * invDet, (n22 * n11 - n21 * n12) * invDet],
  ];
}

/**
 * Convert a 2D array matrix to a flat Float32Array in column-major order
 * for use as a mat3 uniform in WebGL.
 */
function matrixToUniform3x3(m: number[][]): Float32Array {
  return new Float32Array([
    m[0][0],
    m[1][0],
    m[2][0], // column 0
    m[0][1],
    m[1][1],
    m[2][1], // column 1
    m[0][2],
    m[1][2],
    m[2][2], // column 2
  ]);
}

export function renderFeatureMatchGpu(
  anyNode: AnyNode,
  target: THREE.WebGLRenderTarget,
  inputTexture: THREE.Texture | undefined,
  context: ResolveOutputContext,
): boolean | Promise<boolean> {
  const node = anyNode as FeatureMatchNode;
  const sourceTexture = inputTexture ?? context.getTransparentInputTexture();

  // Get scene resolution for coordinate conversion
  const sceneRes = new THREE.Vector2(context.sceneNode.width, context.sceneNode.height);

  // Resolve reference texture from the second input port
  const refNodeId = node.inputs?.reference;
  const refSourcePort = context.getInputSourcePort(node, 'reference');
  const isSolved = node.result?.status === 'solved' && node.result.matrix?.length === 3;

  // Use the FORWARD matrix (reference → source), NOT the inverse.
  // fitTrackedTransform returns a model mapping reference positions to
  // source positions. The shader applies this forward mapping to find
  // the source pixel for each output (reference) pixel.
  const warpMatrix =
    isSolved && node.result.matrix?.length === 3 ? node.result.matrix : IDENTITY_MATRIX_3;

  const refTexturePromise = refNodeId ? context.resolveOutput(refNodeId, refSourcePort) : undefined;

  const render = (refTexture: THREE.Texture | undefined): boolean => {
    const referenceTex = refTexture ?? context.getTransparentInputTexture();

    const material = context.getMaterial(
      `${node.id}:feature-match-composite`,
      FEATURE_MATCH_COMPOSITE_SHADER,
      {
        u_tSource: { value: sourceTexture },
        u_tReference: { value: referenceTex },
        u_warpMatrix: { value: matrixToUniform3x3(warpMatrix) },
        u_scene_res: { value: sceneRes },
        u_hasWarp: { value: isSolved },
      },
    );
    context.applyNoBlending(material);
    context.clearRenderTargetTransparent(target);
    context.quad.material = material;
    context.renderer.setRenderTarget(target);
    context.renderer.render(context.scene, context.camera);
    return true;
  };

  if (isPromiseLike(refTexturePromise)) {
    return refTexturePromise.then(render);
  }
  return render(refTexturePromise);
}
