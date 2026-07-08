import { describe, expect, it } from 'vitest';
import { createStudioServiceWorkerSource, normalizePwaBasePath } from './buildServiceWorker';
import { getManagedAssetManualChunk, getManagedAssetMetadata } from './managedAssets';

describe('PWA service worker generation', () => {
  it('normalizes Vite base paths for scoped installs', () => {
    expect(normalizePwaBasePath('/blackboard-studio-alpha')).toBe('/blackboard-studio-alpha/');
    expect(normalizePwaBasePath('studio')).toBe('/studio/');
    expect(normalizePwaBasePath('./')).toBe('/');
  });

  it('embeds app versioning, precache assets, and manual update messaging', () => {
    const source = createStudioServiceWorkerSource({
      appName: 'Blackboard Studio',
      appVersion: '1.2.3',
      cacheVersion: '1.2.3-abcdef123456',
      baseUrl: '/studio/',
      navigationFallbackUrl: '/studio/index.html',
      precacheAssets: [
        {
          url: '/studio/index.html',
          revision: 'index-revision',
          size: 128,
        },
        {
          url: '/studio/assets/app.js',
          revision: 'app-revision',
          size: 256,
        },
      ],
      runtimeAssets: [
        {
          url: '/studio/wasm/ort-wasm-simd-threaded.jsep.wasm',
          revision: 'onnx-revision',
          size: 1024,
          group: 'onnx-runtime',
          label: 'ONNX node runtime',
          description: 'Runs browser ONNX model nodes.',
          removable: true,
        },
      ],
    });

    expect(source).toContain('const APP_VERSION = "1.2.3"');
    expect(source).toContain('const CACHE_VERSION = "1.2.3-abcdef123456"');
    expect(source).toContain('"url": "/studio/assets/app.js"');
    expect(source).toContain('const RUNTIME_ASSETS = [');
    expect(source).toContain('"label": "ONNX node runtime"');
    expect(source).toContain('"description": "Runs browser ONNX model nodes."');
    expect(source).toContain('"removable": true');
    expect(source).toContain('precacheBytes');
    expect(source).toContain('runtimeBytes');
    expect(source).toContain('BLACKBOARD_STUDIO_GET_CACHE_STATUS');
    expect(source).toContain('BLACKBOARD_STUDIO_CACHE_RUNTIME_ASSETS');
    expect(source).toContain('BLACKBOARD_STUDIO_DELETE_RUNTIME_ASSETS');
    expect(source).toContain('BLACKBOARD_STUDIO_SW_CACHE_RESULT');
    expect(source).toContain("operation: 'install'");
    expect(source).toContain("operation: 'remove'");
    expect(source).toContain('notifyCacheStatus');
    expect(source).toContain('cachedBytes');
    expect(source).toContain('BLACKBOARD_STUDIO_GET_VERSION');
    expect(source).toContain('BLACKBOARD_STUDIO_SKIP_WAITING');
    expect(source).toContain("const CACHE_PREFIX = 'blackboard-studio'");
    expect(source).toContain('-precache-');
    expect(source).toContain('handleNavigation');
  });

  it('classifies managed feature assets from one registry', () => {
    expect(getManagedAssetMetadata('wasm/ort-wasm-simd-threaded.wasm')).toMatchObject({
      group: 'onnx-runtime',
      removable: true,
    });
    expect(getManagedAssetMetadata('assets/gaussian-splat-abc123.js')).toMatchObject({
      group: 'gaussian-splat',
    });
    expect(getManagedAssetManualChunk('/repo/node_modules/@sparkjsdev/spark/dist/index.js')).toBe(
      'gaussian-splat',
    );
    expect(getManagedAssetMetadata('assets/app-abc123.js')).toBeNull();
  });
});
