import { describe, expect, it } from 'vitest';
import {
  DEPTH_ANYTHING_V2_RECIPE,
  getVariantRequiredFiles,
  getVariantTotalSize,
  normalizeHuggingFaceRepoName,
  resolveOnnxVariantsFromRepoFiles,
  selectDefaultOnnxVariant,
} from './modelRegistry';

describe('ONNX model registry', () => {
  it('normalizes Hugging Face repo URLs to owner/name', () => {
    expect(
      normalizeHuggingFaceRepoName(
        'https://huggingface.co/onnx-community/depth-anything-v2-small-ONNX/tree/main',
      ),
    ).toBe('onnx-community/depth-anything-v2-small-ONNX');
  });

  it('detects and ranks ONNX variants with the smallest compatible default first', () => {
    const variants = resolveOnnxVariantsFromRepoFiles({
      repoName: DEPTH_ANYTHING_V2_RECIPE.defaultRepoName,
      recipe: DEPTH_ANYTHING_V2_RECIPE,
      files: [
        { path: 'onnx/model_large_fp32.onnx', size: 1_000_000_000 },
        { path: 'onnx/model_small_fp16.onnx', size: 240_000_000 },
        { path: 'README.md', size: 1000 },
        { path: 'onnx/model_base_quantized_wasm.onnx', size: 120_000_000 },
      ],
    });

    expect(variants).toHaveLength(3);
    expect(selectDefaultOnnxVariant(variants)).toEqual(
      expect.objectContaining({
        filePath: 'onnx/model_small_fp16.onnx',
        scale: 'small',
        precision: 'fp16',
        supportedBackends: ['webgpu', 'wasm'],
      }),
    );
  });

  it('associates external data files with .onnx_data extension', () => {
    const variants = resolveOnnxVariantsFromRepoFiles({
      repoName: 'test/repo',
      recipe: DEPTH_ANYTHING_V2_RECIPE,
      files: [
        { path: 'model.onnx', size: 100_000 },
        { path: 'model.onnx_data', size: 500_000_000 },
        { path: 'README.md', size: 1000 },
      ],
    });

    expect(variants).toHaveLength(1);
    expect(variants[0].externalDataFiles).toHaveLength(1);
    expect(variants[0].externalDataFiles![0].path).toBe('model.onnx_data');
    expect(variants[0].externalDataFiles![0].size).toBe(500_000_000);
  });

  it('associates external data files with .bin extension', () => {
    const variants = resolveOnnxVariantsFromRepoFiles({
      repoName: 'test/repo',
      recipe: DEPTH_ANYTHING_V2_RECIPE,
      files: [
        { path: 'weights/model.onnx', size: 50_000 },
        { path: 'weights/params.bin', size: 300_000_000 },
      ],
    });

    expect(variants).toHaveLength(1);
    expect(variants[0].externalDataFiles).toHaveLength(1);
    expect(variants[0].externalDataFiles![0].path).toBe('weights/params.bin');
  });

  it('associates external data via .onnx_data extension in subdirectory', () => {
    const variants = resolveOnnxVariantsFromRepoFiles({
      repoName: 'test/repo',
      recipe: DEPTH_ANYTHING_V2_RECIPE,
      files: [
        { path: 'onnx/model_fp16.onnx', size: 80_000 },
        { path: 'onnx/model_fp16.onnx_data', size: 400_000_000 },
        { path: 'onnx/model_fp16.extra', size: 1000 },
      ],
    });

    expect(variants).toHaveLength(1);
    expect(variants[0].externalDataFiles).toHaveLength(1);
    expect(variants[0].externalDataFiles![0].path).toBe('onnx/model_fp16.onnx_data');
  });

  it('computes total variant size including external data', () => {
    const variants = resolveOnnxVariantsFromRepoFiles({
      repoName: 'test/repo',
      recipe: DEPTH_ANYTHING_V2_RECIPE,
      files: [
        { path: 'model.onnx', size: 100_000 },
        { path: 'model.onnx_data', size: 500_000_000 },
      ],
    });

    expect(getVariantTotalSize(variants[0])).toBe(500_100_000);
  });

  it('returns required files list for a variant', () => {
    const variants = resolveOnnxVariantsFromRepoFiles({
      repoName: 'test/repo',
      recipe: DEPTH_ANYTHING_V2_RECIPE,
      files: [
        { path: 'model.onnx', size: 100_000 },
        { path: 'model.onnx_data', size: 500_000_000 },
      ],
    });

    const files = getVariantRequiredFiles(variants[0]);
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ path: 'model.onnx', size: 100_000, type: 'onnx' });
    expect(files[1]).toEqual({ path: 'model.onnx_data', size: 500_000_000, type: 'external-data' });
  });

  it('ignores external data files in different directories', () => {
    const variants = resolveOnnxVariantsFromRepoFiles({
      repoName: 'test/repo',
      recipe: DEPTH_ANYTHING_V2_RECIPE,
      files: [
        { path: 'subdir/model.onnx', size: 100_000 },
        { path: 'other/model.onnx_data', size: 500_000_000 },
      ],
    });

    expect(variants[0].externalDataFiles).toHaveLength(0);
  });
});
