import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ExternalColorConfigReference } from '@blackboard/types';

export interface ExternalOcioConfigFile {
  relativePath: string;
  data: Uint8Array;
}

export interface ExternalOcioConfigPackage {
  configPath: string;
  configRelativePath: string;
  files: ExternalOcioConfigFile[];
}

interface NativeExternalOcioConfigPackage {
  configPath: string;
  configRelativePath: string;
  files: Array<{ relativePath: string; data: number[] }>;
}

const sessionPackages = new Map<string, ExternalOcioConfigPackage>();

const normalizeRelativePath = (path: string): string => {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '');
  if (
    !normalized ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid external OCIO package path "${path}".`);
  }
  return normalized;
};

const normalizePackage = (
  reference: ExternalColorConfigReference,
  source: ExternalOcioConfigPackage,
): ExternalOcioConfigPackage => {
  const configRelativePath = normalizeRelativePath(source.configRelativePath);
  const files = source.files.map((file) => ({
    relativePath: normalizeRelativePath(file.relativePath),
    data: file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data),
  }));
  if (!files.some((file) => file.relativePath === configRelativePath)) {
    throw new Error(
      `External OCIO config "${reference.uri}" is missing "${configRelativePath}" from its source package.`,
    );
  }
  return {
    configPath: source.configPath,
    configRelativePath,
    files,
  };
};

const fileUriToPath = (uri: string): string => {
  const url = new URL(uri);
  const decodedPath = decodeURIComponent(url.pathname);
  if (url.host) return `//${url.host}${decodedPath}`;
  return /^[A-Za-z]:/.test(decodedPath.slice(1)) ? decodedPath.slice(1) : decodedPath;
};

const loadNativePackage = async (
  reference: ExternalColorConfigReference,
): Promise<ExternalOcioConfigPackage> => {
  const configPath = reference.uri.startsWith('file:')
    ? fileUriToPath(reference.uri)
    : reference.uri;
  const result = await invoke<NativeExternalOcioConfigPackage>('read_ocio_config_package', {
    configPath,
  });
  return normalizePackage(reference, {
    ...result,
    files: result.files.map((file) => ({
      relativePath: file.relativePath,
      data: new Uint8Array(file.data),
    })),
  });
};

const loadNetworkConfig = async (
  reference: ExternalColorConfigReference,
): Promise<ExternalOcioConfigPackage> => {
  const response = await fetch(reference.uri);
  if (!response.ok) {
    throw new Error(
      `Could not load external OCIO config "${reference.uri}": ${response.status} ${response.statusText}.`,
    );
  }
  const relativePath =
    new URL(reference.uri).pathname.split('/').filter(Boolean).at(-1) ?? 'config.ocio';
  return normalizePackage(reference, {
    configPath: reference.uri,
    configRelativePath: relativePath,
    files: [{ relativePath, data: new Uint8Array(await response.arrayBuffer()) }],
  });
};

export const registerExternalOcioConfigPackage = (
  reference: ExternalColorConfigReference,
  source: ExternalOcioConfigPackage,
): void => {
  sessionPackages.set(reference.uri, normalizePackage(reference, source));
};

export const removeExternalOcioConfigPackage = (uri: string): void => {
  sessionPackages.delete(uri);
};

export const loadExternalOcioConfigPackage = async (
  reference: ExternalColorConfigReference,
): Promise<ExternalOcioConfigPackage> => {
  const registered = sessionPackages.get(reference.uri);
  if (registered) return registered;

  if (reference.uri.startsWith('http://') || reference.uri.startsWith('https://')) {
    return loadNetworkConfig(reference);
  }
  if (isTauri()) {
    return loadNativePackage(reference);
  }

  throw new Error(
    `External OCIO config "${reference.uri}" is not available in this session. Locate its directory before rendering.`,
  );
};

export const createExternalOcioConfigPackageFromFiles = async (
  reference: ExternalColorConfigReference,
  files: readonly File[],
  configRelativePath: string,
): Promise<ExternalOcioConfigPackage> => {
  const packageFiles = await Promise.all(
    files.map(async (file) => ({
      relativePath: file.webkitRelativePath || file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    })),
  );
  return normalizePackage(reference, {
    configPath: reference.uri,
    configRelativePath,
    files: packageFiles,
  });
};
