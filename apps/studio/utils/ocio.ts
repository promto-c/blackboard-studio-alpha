let ocioModule: any;

// A simplified representation of the view transforms we expose in the UI.
const MOCK_CONFIG = {
  views: ['Raw', 'sRGB'],
};

class OcioManager {
  private isInitialized = false;

  public async initialize() {
    if (this.isInitialized) return;
    try {
      const OcioModule = (await (import('@/services/ocio/ocio-wasm.js') as any)).default;
      ocioModule = await OcioModule();
      // In a real scenario, load a config here. The stub is a no-op.
      // ocioModule.initConfig('config.ocio', true);
      this.isInitialized = true;
      console.log('OCIO Initialized');
    } catch (e) {
      console.error('Failed to initialize OCIO:', e);
    }
  }

  public getIsInitialized() {
    return this.isInitialized;
  }

  public getViews() {
    if (!this.isInitialized) return [];
    return MOCK_CONFIG.views;
  }

  public createProcessor(from: string, to: string) {
    if (!this.isInitialized) throw new Error('OCIO not initialized');
    return ocioModule.createProcessor({
      srcColorSpace: from,
      dstColorSpace: to,
    });
  }

  public getGpuShader(processorHandle: number) {
    if (!this.isInitialized) throw new Error('OCIO not initialized');
    const shader = ocioModule.getGpuShader(processorHandle);

    // The stub returns empty strings. Let's provide a fallback to see something.
    if (!shader.header && !shader.main) {
      return {
        header: '// OCIO STUB: No-op shader',
        uniforms: '',
        main: 'color = color;', // No-op
      };
    }
    return shader;
  }
}

export const ocioManager = new OcioManager();
