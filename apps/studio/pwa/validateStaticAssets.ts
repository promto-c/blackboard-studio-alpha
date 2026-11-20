import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_FILES = new Set([
  'manifest.webmanifest',
  'pwa/icon.svg',
  'pwa/icon-192.png',
  'pwa/icon-512.png',
  'pwa/maskable-512.png',
]);

const BUILD_FILES = new Set([...PUBLIC_FILES, 'index.html', 'sw.js']);
const ASSET_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.wasm', '.svg', '.png', '.woff2']);

function validateFiles(
  root: string,
  label: string,
  allowedDirectory: (relativePath: string) => boolean,
  allowedFile: (relativePath: string) => boolean,
): void {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`${label} does not exist: ${root}`);
  }

  const unexpected: string[] = [];
  const visit = (directory: string, prefix = ''): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isSymbolicLink()) {
        unexpected.push(`${relativePath} (symlink)`);
      } else if (entry.isDirectory()) {
        if (allowedDirectory(relativePath)) visit(absolutePath, relativePath);
        else unexpected.push(`${relativePath}/ (unexpected directory)`);
      } else if (!entry.isFile() || !allowedFile(relativePath)) {
        unexpected.push(relativePath);
      }
    }
  };
  visit(root);

  if (unexpected.length > 0) {
    throw new Error(
      `${label} contains unreviewed release assets:\n${unexpected.map((file) => `  - ${file}`).join('\n')}`,
    );
  }
}

export function validateStudioPublicAssets(publicDir: string): void {
  validateFiles(
    publicDir,
    'Studio public/',
    (directory) => directory === 'pwa',
    (file) => PUBLIC_FILES.has(file),
  );
}

export function validateStudioBuildAssets(distDir: string): void {
  for (const required of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    if (!fs.existsSync(path.join(distDir, required))) {
      throw new Error(`Studio dist/ is missing required release asset: ${required}`);
    }
  }

  validateFiles(
    distDir,
    'Studio dist/',
    (directory) => ['pwa', 'assets', 'wasm'].includes(directory) || directory.startsWith('assets/'),
    (file) =>
      BUILD_FILES.has(file) ||
      (file.startsWith('assets/') && ASSET_EXTENSIONS.has(path.posix.extname(file))) ||
      (file.startsWith('wasm/ort-wasm') &&
        !file.slice('wasm/'.length).includes('/') &&
        (file.endsWith('.wasm') || file.endsWith('.mjs'))),
  );
}
