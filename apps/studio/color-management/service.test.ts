import { describe, expect, it } from 'vitest';
import { shouldSuppressOcioWasmLogMessage } from './service';

describe('OCIO WASM logging', () => {
  it('suppresses built-in config inactive reference info logs', () => {
    expect(
      shouldSuppressOcioWasmLogMessage(
        "[OpenColorIO Info]: Inactive 'P3-D60 - Display' is neither a color space nor a named transform.",
      ),
    ).toBe(true);
  });

  it('does not suppress other OpenColorIO output', () => {
    expect(
      shouldSuppressOcioWasmLogMessage(
        '[OpenColorIO Warning]: Could not create display transform.',
      ),
    ).toBe(false);
    expect(shouldSuppressOcioWasmLogMessage('Failed to initialize OpenColorIO.')).toBe(false);
  });
});
