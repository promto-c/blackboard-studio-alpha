// Stub OCIO WebAssembly module for demonstration
//
// This file simulates the output of an Emscripten build.  It exports a
// default async function that resolves to an object implementing the OCIO API
// expected by the TypeScript adapter.  Because this environment cannot
// compile OpenColorIO to WebAssembly, the methods here are no‑ops or return
// placeholder values.
//
// In a real build, Emscripten would generate a loader that fetches
// `ocio-wasm.wasm`, instantiates it, and provides bindings via Embind.  See
// the README for instructions on how to compile the real module.

export default async function () {
  return {
    /** Return the version of this stub module */
    getModuleVersion() {
      return '0.0.0';
    },
    /** Return a placeholder OCIO version */
    getOcioVersion() {
      return '0.0.0';
    },
    /** Initialize the configuration (no‑op in stub) */
    initConfig(bufferOrPath, isPath) {
      // In a real module, this would parse the config and set the default.
    },
    /** Create a processor and return a handle.  Always returns 1 in stub. */
    createProcessor(opts) {
      return 1;
    },
    /** Apply the processor to an image buffer.  Returns the input unmodified. */
    applyCPU(handle, pixels, width, height) {
      return pixels;
    },
    /** Get GPU shader snippets.  Returns empty strings in stub. */
    getGpuShader(handle) {
      return { header: '', uniforms: '', main: '' };
    },
  };
}
