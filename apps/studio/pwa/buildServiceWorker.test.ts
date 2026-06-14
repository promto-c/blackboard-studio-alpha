import { describe, expect, it } from 'vitest';
import { createStudioServiceWorkerSource, normalizePwaBasePath } from './buildServiceWorker';

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
      assets: [
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
    });

    expect(source).toContain('const APP_VERSION = "1.2.3"');
    expect(source).toContain('const CACHE_VERSION = "1.2.3-abcdef123456"');
    expect(source).toContain('"url": "/studio/assets/app.js"');
    expect(source).toContain('BLACKBOARD_STUDIO_GET_VERSION');
    expect(source).toContain('BLACKBOARD_STUDIO_SKIP_WAITING');
    expect(source).toContain("const CACHE_PREFIX = 'blackboard-studio'");
    expect(source).toContain('-precache-');
    expect(source).toContain('handleNavigation');
  });
});
