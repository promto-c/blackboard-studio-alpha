import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const onnxWasmSrc = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');
const publicWasmDir = path.resolve(__dirname, 'public/wasm');
const distWasmDir = path.resolve(__dirname, 'dist/wasm');

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  copyOnnxWasmFiles(publicWasmDir, isWasm);

  return {
    base: '/blackboard-studio-alpha/',

    server: {
      port: 3000,
      host: '0.0.0.0',
    },

    plugins: [
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
    ],

    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@blackboard/renderer': path.resolve(__dirname, '../../packages/renderer/src/index.ts'),
        '@blackboard/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      },
    },

    optimizeDeps: {
      exclude: ['@blackboard/renderer', '@blackboard/types', 'onnxruntime-web'],
    },
  };
});
