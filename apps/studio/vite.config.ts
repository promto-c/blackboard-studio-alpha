import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  createStudioServiceWorkerSource,
  normalizePwaBasePath,
  type StudioServiceWorkerAsset,
} from './pwa/buildServiceWorker';

const onnxWasmSrc = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');
const publicWasmDir = path.resolve(__dirname, 'public/wasm');
const distDir = path.resolve(__dirname, 'dist');
const distWasmDir = path.resolve(__dirname, 'dist/wasm');
const studioPackagePath = path.resolve(__dirname, 'package.json');
const studioPackage = JSON.parse(fs.readFileSync(studioPackagePath, 'utf8')) as {
  version?: string;
};
const studioVersion = studioPackage.version ?? '0.0.0';
const hostedBase = '/blackboard-studio-alpha/';

const isTruthyEnv = (value: string | undefined) =>
  value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';

function copyOnnxWasmFiles(destDir: string, filter: (f: string) => boolean) {
  const files = fs.readdirSync(onnxWasmSrc).filter(filter);
  if (files.length === 0) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    const src = path.join(onnxWasmSrc, file);
    const dst = path.join(destDir, file);
    if (!fs.existsSync(dst) || fs.statSync(src).mtimeMs !== fs.statSync(dst).mtimeMs) {
      fs.copyFileSync(src, dst);
    }
  }
}

const isWasm = (f: string) => f.startsWith('ort-wasm') && f.endsWith('.wasm');
const isMjs = (f: string) => f.startsWith('ort-wasm') && f.endsWith('.mjs');
const toPosixPath = (value: string) => value.split(path.sep).join('/');

function collectDistFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectDistFiles(fullPath);
    if (!entry.isFile()) return [];
    return [fullPath];
  });
}

function createStudioPwaBuildPlugin({ base, version }: { base: string; version: string }): Plugin {
  return {
    name: 'studio-pwa-build',
    apply: 'build',
    closeBundle() {
      const normalizedBase = normalizePwaBasePath(base);
      const files = collectDistFiles(distDir)
        .filter((file) => {
          const relativePath = toPosixPath(path.relative(distDir, file));
          return relativePath !== 'sw.js' && !relativePath.endsWith('.map');
        })
        .sort();

      const assets: StudioServiceWorkerAsset[] = files.map((file) => {
        const contents = fs.readFileSync(file);
        const relativePath = toPosixPath(path.relative(distDir, file));
        return {
          url: `${normalizedBase}${relativePath}`,
          revision: createHash('sha256').update(contents).digest('hex'),
          size: contents.byteLength,
        };
      });

      const cacheDigest = createHash('sha256')
        .update(JSON.stringify(assets.map(({ url, revision, size }) => ({ url, revision, size }))))
        .digest('hex')
        .slice(0, 12);
      const cacheVersion = `${version}-${cacheDigest}`;
      const serviceWorker = createStudioServiceWorkerSource({
        appName: 'Blackboard Studio',
        appVersion: version,
        cacheVersion,
        baseUrl: normalizedBase,
        navigationFallbackUrl: `${normalizedBase}index.html`,
        assets,
      });

      fs.writeFileSync(path.resolve(distDir, 'sw.js'), serviceWorker);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const desktopEnv = env.BLACKBOARD_STUDIO_DESKTOP ?? env.VITE_BLACKBOARD_STUDIO_DESKTOP;
  const isTauriDesktop = Boolean(
    isTruthyEnv(desktopEnv) ||
    process.env.TAURI_ENV_PLATFORM ||
    process.env.TAURI_ENV_ARCH ||
    process.env.TAURI_ENV_DEBUG,
  );
  const appBase = isTauriDesktop ? './' : hostedBase;
  const devHost = process.env.TAURI_DEV_HOST ?? (isTauriDesktop ? '127.0.0.1' : '0.0.0.0');
  const studioBuildId =
    env.BLACKBOARD_STUDIO_BUILD_ID ?? env.VITE_BLACKBOARD_STUDIO_BUILD_ID ?? studioVersion;

  copyOnnxWasmFiles(publicWasmDir, isWasm);

  const plugins: (Plugin | Plugin[])[] = [
    react(),
    {
      name: 'onnx-wasm',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? '';
          const match = url.match(/\/wasm\/(ort-wasm.+\.mjs)/);
          if (match) {
            const filePath = path.join(onnxWasmSrc, match[1]);
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/javascript');
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }
          next();
        });
      },
      closeBundle() {
        copyOnnxWasmFiles(distWasmDir, (f) => isWasm(f) || isMjs(f));
      },
    },
  ];

  if (!isTauriDesktop) {
    plugins.push(
      createStudioPwaBuildPlugin({
        base: appBase,
        version: studioVersion,
      }),
    );
  }

  return {
    base: appBase,
    clearScreen: !isTauriDesktop,
    envPrefix: ['VITE_', 'TAURI_ENV_*'],

    server: {
      port: 3000,
      strictPort: isTauriDesktop,
      host: devHost,
      hmr: process.env.TAURI_DEV_HOST
        ? {
            protocol: 'ws',
            host: process.env.TAURI_DEV_HOST,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },

    plugins,

    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __BLACKBOARD_STUDIO_VERSION__: JSON.stringify(studioVersion),
      __BLACKBOARD_STUDIO_BUILD_ID__: JSON.stringify(studioBuildId),
      __BLACKBOARD_STUDIO_DESKTOP__: JSON.stringify(isTauriDesktop),
    },

    resolve: {
      conditions: ['vite', 'module', 'browser', 'development|production'],
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@blackboard/renderer': path.resolve(__dirname, '../../packages/renderer/src/index.ts'),
        '@blackboard/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      },
    },

    build: {
      target: isTauriDesktop
        ? process.env.TAURI_ENV_PLATFORM === 'windows'
          ? 'chrome105'
          : 'safari13'
        : undefined,
      chunkSizeWarningLimit: 2000,
      minify: isTauriDesktop && process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
      sourcemap: isTauriDesktop && Boolean(process.env.TAURI_ENV_DEBUG),
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Split heavy markdown libraries into their own chunk
            if (
              id.includes('node_modules/react-markdown') ||
              id.includes('node_modules/remark-gfm') ||
              id.includes('node_modules/remark-parse') ||
              id.includes('node_modules/mdast-util') ||
              id.includes('node_modules/micromark') ||
              id.includes('node_modules/unified') ||
              id.includes('node_modules/unist-') ||
              id.includes('node_modules/hast-util') ||
              id.includes('node_modules/vfile') ||
              id.includes('node_modules/ccount') ||
              id.includes('node_modules/longest-streak') ||
              id.includes('node_modules/decode-named-character-reference') ||
              id.includes('node_modules/character-entities')
            ) {
              return 'vendor-markdown';
            }
            // Split Google GenAI SDK into its own chunk
            if (id.includes('node_modules/@google/genai')) {
              return 'vendor-genai';
            }
          },
        },
      },
    },

    optimizeDeps: {
      exclude: ['@blackboard/renderer', '@blackboard/types', 'onnxruntime-web'],
    },
  };
});
