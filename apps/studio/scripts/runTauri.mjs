/* global process */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const studioDir = path.resolve(scriptDir, '..');
const tauriExecutable = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
const localTauri = path.join(studioDir, 'node_modules', '.bin', tauriExecutable);
const command = existsSync(localTauri) ? localTauri : tauriExecutable;

const env = {
  ...process.env,
  BLACKBOARD_STUDIO_DESKTOP: '1',
};

const enableWebkitDmabuf = ['1', 'true', 'yes'].includes(
  env.BLACKBOARD_STUDIO_ENABLE_WEBKIT_DMABUF?.toLowerCase() ?? '',
);

if (process.platform === 'linux' && !enableWebkitDmabuf) {
  env.WEBKIT_DISABLE_DMABUF_RENDERER ??= '1';
}

const child = spawn(command, process.argv.slice(2), {
  cwd: studioDir,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
