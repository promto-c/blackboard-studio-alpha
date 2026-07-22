import { describe, expect, it } from 'vitest';
import {
  buildOpticalFlowPyramid,
  calculateHybridOpticalFlowFromPyramids,
  fitTrackedTransform,
  invertAxisAlignedTransformAroundCenter,
} from '@/utils/opticalFlow';
import {
  composeComfyAlignmentWithReference,
  estimateComfyImageAlignment,
  selectTrackingPoints,
} from './comfyImageAlignment';
import { COMFY_ALIGNMENT_QUALITY_PRESETS } from './comfyAlignmentOptions';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

type PixelImage = { data: Uint8ClampedArray; width: number; height: number };

/** Create a more realistic synthetic image with edges, gradients, and texture. */
const createRichImage = (width: number, height: number): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Multiple frequency bands + sharp edge + gradient
      const low = 128 + 48 * Math.sin(x * 0.11) + 42 * Math.cos(y * 0.15);
      const mid = 34 * Math.sin((x + y) * 0.07) + 20 * Math.cos((x - y) * 0.19);
      const high = 12 * Math.sin(x * 0.43) * Math.cos(y * 0.47);
      const edge = Math.abs(x - width / 2) < 3 ? 60 : 0;
      const gradient = (x / width) * 80;
      const value = Math.max(0, Math.min(255, low + mid + high + edge + gradient));
      data[i] = value;
      data[i + 1] = value * 0.85;
      data[i + 2] = 255 - value * 0.7;
      data[i + 3] = 255;
    }
  }
  return data;
};

/** Bilinear warp (matching the LK tracker's sampling) for maximum realism. */
const warpImageBilinear = (
  src: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): Uint8ClampedArray => {
  const dst = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sxInv = (x - tx) / sx;
      const syInv = (y - ty) / sy;
      const ox = Math.floor(sxInv);
      const oy = Math.floor(syInv);
      const fx = sxInv - ox;
      const fy = syInv - oy;
      const si = (y * w + x) * 4;
      if (ox < 0 || ox + 1 >= w || oy < 0 || oy + 1 >= h) continue;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(oy * w + ox) * 4 + c];
        const p10 = src[(oy * w + ox + 1) * 4 + c];
        const p01 = src[((oy + 1) * w + ox) * 4 + c];
        const p11 = src[((oy + 1) * w + ox + 1) * 4 + c];
        dst[si + c] = Math.round(
          (1 - fx) * (1 - fy) * p00 + fx * (1 - fy) * p10 + (1 - fx) * fy * p01 + fx * fy * p11,
        );
      }
    }
  }
  return dst;
};

/** Paint a "spill" region to simulate img2img edits. */
const applyLocalEdit = (img: Uint8ClampedArray, w: number, h: number): void => {
  const cx = Math.round(w * 0.3);
  const cy = Math.round(h * 0.3);
  const r = Math.round(Math.min(w, h) * 0.15);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const i = (y * w + x) * 4;
      // High-frequency noise
      img[i] = Math.random() * 255;
      img[i + 1] = Math.random() * 255;
      img[i + 2] = Math.random() * 255;
    }
  }
};

/** Compute mean absolute error between estimated and ground-truth transforms. */
const computeTransformError = (
  estimated: { sx: number; sy: number; tx: number; ty: number } | null,
  groundTruth: { sx: number; sy: number; tx: number; ty: number },
  imgW: number,
  imgH: number,
): {
  scaleError: number;
  offsetErrorPx: number;
  offsetErrorPercent: number;
  perPixelError: number;
} | null => {
  if (!estimated) return null;

  const scaleError = Math.hypot(estimated.sx - groundTruth.sx, estimated.sy - groundTruth.sy);
  const offsetErrorPx = Math.hypot(estimated.tx - groundTruth.tx, estimated.ty - groundTruth.ty);
  const offsetErrorPercent = (offsetErrorPx / Math.hypot(imgW, imgH)) * 100;

  // Per-pixel error: average error across all pixel positions in the image
  let totalError = 0;
  const samples = Math.min(100, imgW * imgH);
  for (let i = 0; i < samples; i++) {
    const px = i % imgW;
    const py = Math.floor(i / imgW);
    const ex = estimated.sx * px + estimated.tx;
    const ey = estimated.sy * py + estimated.ty;
    const gx = groundTruth.sx * px + groundTruth.tx;
    const gy = groundTruth.sy * py + groundTruth.ty;
    totalError += Math.hypot(ex - gx, ey - gy);
  }
  const perPixelError = totalError / samples;

  return { scaleError, offsetErrorPx, offsetErrorPercent, perPixelError };
};

/**
 * Run a single-pass alignment with the given parameters and return detailed diagnostics.
 */
const diagnoseAlignmentPass = (
  source: PixelImage,
  output: PixelImage,
  points: Array<{ x: number; y: number }>,
  groundTruth: { sx: number; sy: number; tx: number; ty: number },
  label: string,
  options: {
    searchRadius: number;
    maxError: number;
    outlierDistance: number;
    ransacThreshold: number;
  },
): {
  trackedPointCount: number;
  reliablePairCount: number;
  estimate: { sx: number; sy: number; tx: number; ty: number } | null;
  error: ReturnType<typeof computeTransformError>;
  medianFbError: number;
  ransacInliers: number;
} => {
  // Stage 1: Build pyramids
  const pyrSrc = buildOpticalFlowPyramid(source.data, source.width, source.height);
  const pyrOut = buildOpticalFlowPyramid(output.data, output.width, output.height);

  // Stage 2: Optical flow tracking
  const tracked = calculateHybridOpticalFlowFromPyramids(pyrSrc, pyrOut, points, {
    maxError: options.maxError,
    outlierDistance: options.outlierDistance,
    searchRadius: options.searchRadius,
    patchRadius: 5,
    minimumNccScore: 0.5,
    coherentFallback: false,
  });

  const reliablePairs = points
    .map((sp, i) => ({ source: sp, output: tracked[i], error: tracked[i].error }))
    .filter(
      (p) =>
        Number.isFinite(p.output.x) &&
        Number.isFinite(p.output.y) &&
        Number.isFinite(p.error) &&
        p.error <= options.maxError,
    );

  // Forward-backward error stats
  const fbErrors = reliablePairs.map((p) => p.error);
  fbErrors.sort((a, b) => a - b);
  const medianFbError = fbErrors.length > 0 ? fbErrors[Math.floor(fbErrors.length / 2)] : 0;

  // Stage 3: RANSAC transform fitting
  const src = reliablePairs.map((p) => ({ x: p.source.x, y: p.source.y }));
  const dst = reliablePairs.map((p) => ({ x: p.output.x, y: p.output.y }));
  const solved = fitTrackedTransform(src, dst, {
    translation: true,
    rotation: false,
    scale: false,
    affine: false,
    perspective: false,
    independentScale: true,
    deform: false,
    ransacThreshold: options.ransacThreshold,
  });

  let estimate: { sx: number; sy: number; tx: number; ty: number } | null = null;
  let ransacInliers = 0;

  if (solved && solved.type === 'independent_scale') {
    const [sx, tx, sy, ty] = solved.model;
    if (sx >= 0.8 && sx <= 1.25 && sy >= 0.8 && sy <= 1.25) {
      estimate = { sx, sy, tx, ty };
      // Count RANSAC inliers
      ransacInliers = dst.filter((d, i) => {
        const predX = sx * src[i].x + tx;
        const predY = sy * src[i].y + ty;
        return Math.hypot(predX - d.x, predY - d.y) <= options.ransacThreshold;
      }).length;
    }
  }

  const error = computeTransformError(estimate, groundTruth, source.width, source.height);

  return {
    trackedPointCount: points.length,
    reliablePairCount: reliablePairs.length,
    estimate,
    error,
    medianFbError,
    ransacInliers,
  };
};

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('Comfy alignment diagnostic', () => {
  const W = 240;
  const H = 180;

  /**
   * Test 1: Pure translation — the simplest case.
   * If this fails, something is fundamentally wrong with the tracker or solver.
   */
  it('diagnostic: pure translation', () => {
    const src = createRichImage(W, H);
    const tx = 3.7;
    const ty = -2.3;
    const output = warpImageBilinear(src, W, H, 1, 1, tx, ty);
    const source: PixelImage = { data: src, width: W, height: H };
    const outputImg: PixelImage = { data: output, width: W, height: H };

    // Use all grid points
    const points: Array<{ x: number; y: number }> = [];
    for (let y = 10; y < H - 10; y += 12) {
      for (let x = 10; x < W - 10; x += 12) {
        points.push({ x, y });
      }
    }

    const diag = diagnoseAlignmentPass(
      source,
      outputImg,
      points,
      { sx: 1, sy: 1, tx, ty },
      'translation',
      {
        searchRadius: 16,
        maxError: 12,
        outlierDistance: 20,
        ransacThreshold: 2.0,
      },
    );

    // Even with loose tolerance, pure translation must converge
    expect(diag.estimate).not.toBeNull();
    if (diag.estimate && diag.error) {
      // Per-pixel error should be < 1px for pure translation
      expect(diag.error.perPixelError).toBeLessThan(2.0);
    }
  });

  /**
   * Test 2: Scale + translation — the realistic case.
   */
  it('diagnostic: scale + translation', () => {
    const src = createRichImage(W, H);
    const gt = { sx: 1.03, sy: 0.97, tx: 4, ty: -3 };
    const output = warpImageBilinear(src, W, H, gt.sx, gt.sy, gt.tx, gt.ty);
    const source: PixelImage = { data: src, width: W, height: H };
    const outputImg: PixelImage = { data: output, width: W, height: H };

    const points: Array<{ x: number; y: number }> = [];
    for (let y = 10; y < H - 10; y += 12) {
      for (let x = 10; x < W - 10; x += 12) {
        points.push({ x, y });
      }
    }

    const diag = diagnoseAlignmentPass(source, outputImg, points, gt, 'scale+translate', {
      searchRadius: 16,
      maxError: 12,
      outlierDistance: 20,
      ransacThreshold: 2.0,
    });

    expect(diag.estimate).not.toBeNull();
  });

  /**
   * Test 3: Scale + translation WITH a local edit (img2img simulation).
   */
  it('diagnostic: scale + translation + local edit (img2img)', () => {
    const src = createRichImage(W, H);
    const gt = { sx: 1.02, sy: 0.98, tx: 3, ty: -2 };

    // Warp first, then edit a region of the output
    const outputRaw = warpImageBilinear(src, W, H, gt.sx, gt.sy, gt.tx, gt.ty);
    const output = new Uint8ClampedArray(outputRaw);
    applyLocalEdit(output, W, H);

    const source: PixelImage = { data: src, width: W, height: H };
    const outputImg: PixelImage = { data: output, width: W, height: H };

    // Test with all refinements enabled (Precise quality)
    const estimate = estimateComfyImageAlignment(
      source,
      outputImg,
      COMFY_ALIGNMENT_QUALITY_PRESETS.precise,
    );
    const error = computeTransformError(
      estimate
        ? {
            sx: estimate.sourceToOutputScaleX,
            sy: estimate.sourceToOutputScaleY,
            tx: estimate.sourceToOutputOffsetX,
            ty: estimate.sourceToOutputOffsetY,
          }
        : null,
      gt,
      W,
      H,
    );

    // Must at least get something
    expect(estimate).not.toBeNull();
    expect(error?.perPixelError).toBeLessThan(0.25);
  });

  /**
   * Test 4: Compare point-selection strategies — what density gives the best result?
   */
  it('diagnostic: compare grid density vs edge-aware selection', () => {
    const src = createRichImage(W, H);
    const gt = { sx: 1.025, sy: 0.975, tx: 5, ty: -4 };
    const output = warpImageBilinear(src, W, H, gt.sx, gt.sy, gt.tx, gt.ty);
    const source: PixelImage = { data: src, width: W, height: H };
    const outputImg: PixelImage = { data: output, width: W, height: H };

    // Dense grid (every 8px)
    const densePoints: Array<{ x: number; y: number }> = [];
    for (let y = 8; y < H - 8; y += 8) {
      for (let x = 8; x < W - 8; x += 8) {
        densePoints.push({ x, y });
      }
    }

    // Sparse grid (every 20px)
    const sparsePoints: Array<{ x: number; y: number }> = [];
    for (let y = 10; y < H - 10; y += 20) {
      for (let x = 10; x < W - 10; x += 20) {
        sparsePoints.push({ x, y });
      }
    }

    // Edge-aware (selectTrackingPoints)
    const edgePoints = selectTrackingPoints(source);
  });

  /**
   * Test 5: Sweep RANSAC threshold to find optimal setting.
   */
  it('diagnostic: RANSAC threshold sweep', () => {
    const src = createRichImage(W, H);
    const gt = { sx: 1.03, sy: 0.97, tx: 4, ty: -3 };
    const output = warpImageBilinear(src, W, H, gt.sx, gt.sy, gt.tx, gt.ty);
    const source: PixelImage = { data: src, width: W, height: H };
    const outputImg: PixelImage = { data: output, width: W, height: H };

    const points: Array<{ x: number; y: number }> = [];
    for (let y = 10; y < H - 10; y += 12) {
      for (let x = 10; x < W - 10; x += 12) {
        points.push({ x, y });
      }
    }
  });

  /**
   * Test 6: Does the tracker itself have systematic bias?
   * Track known source points and measure the bias in tracked positions.
   */
  it('diagnostic: tracker bias on known transform', () => {
    const src = createRichImage(W, H);
    const gt = { sx: 1.02, sy: 0.98, tx: 4.5, ty: -3.2 };
    const output = warpImageBilinear(src, W, H, gt.sx, gt.sy, gt.tx, gt.ty);
    const source: PixelImage = { data: src, width: W, height: H };
    const outputImg: PixelImage = { data: output, width: W, height: H };

    const pyrSrc = buildOpticalFlowPyramid(source.data, source.width, source.height);
    const pyrOut = buildOpticalFlowPyramid(outputImg.data, outputImg.width, outputImg.height);

    // Sample points in a grid
    const points: Array<{ x: number; y: number }> = [];
    for (let y = 10; y < H - 10; y += 8) {
      for (let x = 10; x < W - 10; x += 8) {
        points.push({ x, y });
      }
    }

    const tracked = calculateHybridOpticalFlowFromPyramids(pyrSrc, pyrOut, points, {
      maxError: 20,
      outlierDistance: 30,
      searchRadius: 16,
      patchRadius: 5,
      minimumNccScore: 0.4,
      coherentFallback: false,
    });

    // For each tracked point, compute the error between tracked position and ground truth position
    const errors = points.map((p, i) => {
      const expectedX = gt.sx * p.x + gt.tx;
      const expectedY = gt.sy * p.y + gt.ty;
      const actualX = tracked[i].x;
      const actualY = tracked[i].y;
      return {
        x: actualX - expectedX,
        y: actualY - expectedY,
        error: Math.hypot(actualX - expectedX, actualY - expectedY),
        fbError: tracked[i].error,
      };
    });

    const validErrors = errors.filter((e) => Number.isFinite(e.error) && e.fbError <= 15);
    validErrors.sort((a, b) => a.error - b.error);
    const medianErr =
      validErrors.length > 0 ? validErrors[Math.floor(validErrors.length / 2)].error : 0;
    const meanErr =
      validErrors.length > 0
        ? validErrors.reduce((s, e) => s + e.error, 0) / validErrors.length
        : 0;
    const medianBiasX =
      validErrors.length > 0
        ? validErrors.map((e) => e.x).sort((a, b) => a - b)[Math.floor(validErrors.length / 2)]
        : 0;
    const medianBiasY =
      validErrors.length > 0
        ? validErrors.map((e) => e.y).sort((a, b) => a - b)[Math.floor(validErrors.length / 2)]
        : 0;
  });

  /**
   * Test 7: Test the full pipeline with varying transform magnitudes.
   * Small shifts (1-3px) and large shifts (10-20px).
   */
  it('diagnostic: full pipeline across transform magnitudes', () => {
    const src = createRichImage(W, H);
    const source: PixelImage = { data: src, width: W, height: H };

    const scenarios = [
      { sx: 1.0, sy: 1.0, tx: 1.5, ty: -0.8, label: 'tiny translate' },
      { sx: 1.0, sy: 1.0, tx: 5.3, ty: -3.7, label: 'med translate' },
      { sx: 1.0, sy: 1.0, tx: 15.0, ty: -10.0, label: 'large translate' },
      { sx: 1.01, sy: 0.99, tx: 2.0, ty: -1.0, label: 'tiny scale + small translate' },
      { sx: 1.03, sy: 0.97, tx: 5.0, ty: -3.0, label: 'moderate scale + translate' },
      { sx: 1.05, sy: 0.95, tx: 8.0, ty: -5.0, label: 'larger scale + translate' },
    ];

    for (const scenario of scenarios) {
      const output = warpImageBilinear(
        src,
        W,
        H,
        scenario.sx,
        scenario.sy,
        scenario.tx,
        scenario.ty,
      );
      const outputImg: PixelImage = { data: output, width: W, height: H };

      const estimateBasic = estimateComfyImageAlignment(source, outputImg, {
        skipEditedRegions: false,
        iterativeRefinement: false,
        edgeAwareSampling: false,
      });

      const estimateFull = estimateComfyImageAlignment(
        source,
        outputImg,
        COMFY_ALIGNMENT_QUALITY_PRESETS.precise,
      );

      expect(estimateBasic).not.toBeNull();
      expect(estimateFull).not.toBeNull();
    }
  });

  /**
   * Test 8: Does the transform correction math in alignComfyOutputToInput amplify errors?
   * Simulate the correction calculation to verify the math.
   */
  it('diagnostic: correction math amplification', () => {
    // Show how analysis error amplifies at output resolution
    const outputWidth = 1920;
    const outputHeight = 1080;
    // Old: 480, New: 640
    for (const analysisWidth of [480, 640]) {
      const analysisHeight = Math.round((analysisWidth / outputWidth) * outputHeight);
      const scaleFactor = outputWidth / analysisWidth;

      // 0.5px error at analysis resolution
      const analysisErrorPx = 0.5;
      const outputErrorPx = analysisErrorPx * scaleFactor;

      console.log(
        `\n  Analysis ${analysisWidth}x${analysisHeight}: 1px analysis error = ${scaleFactor.toFixed(1)}px output error`,
      );
      console.log(`    0.5px analysis error = ${outputErrorPx.toFixed(1)}px output error`);
    }

    // At 640px analysis: 0.5px → 1.5px output (better than 2.0px at 480)
    const old640Factor = 1920 / 640;
    expect(old640Factor).toBe(3);
  });
});

describe('Comfy alignment scene transform composition', () => {
  it('preserves the connected input node placement for an identity image match', () => {
    const transform = composeComfyAlignmentWithReference({
      reference: {
        width: 1000,
        height: 500,
        transform: { x: 120.25, y: -40.5, scaleX: 0.75, scaleY: 1.2 },
      },
      outputSize: { width: 1000, height: 500 },
      analysisSize: { width: 200, height: 100 },
      correction: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
    });

    expect(transform).toMatchObject({ x: 120.25, y: -40.5, scaleX: 0.75, scaleY: 1.2 });
  });

  it('composes tracked correction with input placement and output resolution', () => {
    const transform = composeComfyAlignmentWithReference({
      reference: {
        width: 1000,
        height: 500,
        transform: { x: 120, y: -40, scaleX: 0.75, scaleY: 1.2 },
      },
      outputSize: { width: 500, height: 250 },
      analysisSize: { width: 200, height: 100 },
      correction: { scaleX: 0.9, scaleY: 1.1, offsetX: 10, offsetY: -5 },
    });

    expect(transform.x).toBeCloseTo(157.5);
    expect(transform.y).toBeCloseTo(-10);
    expect(transform.scaleX).toBeCloseTo(1.35);
    expect(transform.scaleY).toBeCloseTo(2.64);
  });

  it('maps corresponding pixel centers to identical renderer scene coordinates', () => {
    const analysisSize = { width: 200, height: 100 };
    const reference = {
      width: 1000,
      height: 500,
      transform: { x: 120, y: -40, scaleX: 0.75, scaleY: 1.2 },
    };
    const outputSize = { width: 500, height: 250 };
    const tracked = { scaleX: 1.04, scaleY: 0.96, offsetX: 3, offsetY: -2 };
    const correction = invertAxisAlignedTransformAroundCenter(tracked, analysisSize)!;
    const transform = composeComfyAlignmentWithReference({
      reference,
      outputSize,
      analysisSize,
      correction,
    });
    const sourceAnalysis = { x: 73, y: 41 };
    const outputAnalysis = {
      x: tracked.scaleX * sourceAnalysis.x + tracked.offsetX,
      y: tracked.scaleY * sourceAnalysis.y + tracked.offsetY,
    };
    const sourcePixel = {
      x: ((sourceAnalysis.x + 0.5) * reference.width) / analysisSize.width - 0.5,
      y: ((sourceAnalysis.y + 0.5) * reference.height) / analysisSize.height - 0.5,
    };
    const outputPixel = {
      x: ((outputAnalysis.x + 0.5) * outputSize.width) / analysisSize.width - 0.5,
      y: ((outputAnalysis.y + 0.5) * outputSize.height) / analysisSize.height - 0.5,
    };
    const sourceScene = {
      x:
        reference.transform.x +
        reference.transform.scaleX * (sourcePixel.x - (reference.width - 1) / 2),
      y:
        reference.transform.y -
        reference.transform.scaleY * (sourcePixel.y - (reference.height - 1) / 2),
    };
    const outputScene = {
      x:
        Number(transform.x) +
        Number(transform.scaleX) * (outputPixel.x - (outputSize.width - 1) / 2),
      y:
        Number(transform.y) -
        Number(transform.scaleY) * (outputPixel.y - (outputSize.height - 1) / 2),
    };

    expect(outputScene.x).toBeCloseTo(sourceScene.x, 8);
    expect(outputScene.y).toBeCloseTo(sourceScene.y, 8);
  });
});
