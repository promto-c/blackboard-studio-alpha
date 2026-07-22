import { describe, expect, it } from 'vitest';
import {
  getSam3ModelVariant,
  getSam3RuntimeDtypeConfig,
  SAM3_MODEL_VARIANTS,
  SAM3_TRACKER_MODEL,
  SAM3_VISION_ENCODER_TARGET,
} from './builtinModelRegistry';

describe('built-in SAM3 model registry', () => {
  it('exposes the bundle and selectable Roto variants', () => {
    expect(SAM3_TRACKER_MODEL.repoName).toBe('onnx-community/sam3-tracker-ONNX');
    expect(SAM3_MODEL_VARIANTS.map((variant) => variant.id)).toEqual(['auto', 'q4', 'q4f16', 'q8']);
    expect(getSam3ModelVariant(undefined).id).toBe('auto');
  });

  it('resolves Auto through the shared ONNX backend choice', () => {
    expect(getSam3RuntimeDtypeConfig('auto', 'webgpu')).toEqual({
      vision_encoder: 'q4',
      prompt_encoder_mask_decoder: 'fp32',
    });
    expect(getSam3RuntimeDtypeConfig('auto', 'wasm')).toEqual({
      vision_encoder: 'q8',
      prompt_encoder_mask_decoder: 'q8',
    });
  });

  it('keeps explicit quantizations stable across compatible backends', () => {
    expect(getSam3RuntimeDtypeConfig('q4f16', 'webgpu')).toEqual({
      vision_encoder: 'q4f16',
      prompt_encoder_mask_decoder: 'q4f16',
    });
    expect(getSam3RuntimeDtypeConfig('q8', 'wasm')).toEqual({
      vision_encoder: 'q8',
      prompt_encoder_mask_decoder: 'q8',
    });
  });

  it('exposes compatible single-graph targets for advanced ONNX nodes', () => {
    expect(SAM3_TRACKER_MODEL.onnxNodeTargets).toContain(SAM3_VISION_ENCODER_TARGET);
    expect(SAM3_VISION_ENCODER_TARGET.variants.map((variant) => variant.filePath)).toEqual([
      'onnx/vision_encoder_q4.onnx',
      'onnx/vision_encoder_q4f16.onnx',
      'onnx/vision_encoder_quantized.onnx',
    ]);
  });
});
