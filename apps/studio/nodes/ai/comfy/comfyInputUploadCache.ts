export interface ComfyInputUploadCacheEntry {
  endpoint: string;
  fingerprint: string;
  imageName: string;
  uploadedAt: number;
}

export interface ComfyInputUploadCacheOptions {
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 96;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const fallbackHashBytes = (bytes: Uint8Array): string => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const digestBytes = async (bytes: Uint8Array): Promise<string> => {
  if (globalThis.crypto?.subtle) {
    try {
      return toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
    } catch {
      // Fall back to a cheap content hash in older embedded runtimes.
    }
  }

  return fallbackHashBytes(bytes);
};

export const getComfyInputBlobFingerprint = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = await digestBytes(bytes);
  return [blob.type || 'application/octet-stream', blob.size, hash].join(':');
};

const normalizeCacheEndpoint = (endpoint: string): string => endpoint.trim().replace(/\/+$/, '');

const getCacheKey = (endpoint: string, fingerprint: string): string =>
  `${normalizeCacheEndpoint(endpoint)}\u0000${fingerprint}`;

export class ComfyInputUploadCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, ComfyInputUploadCacheEntry>();

  constructor(options: ComfyInputUploadCacheOptions = {}) {
    this.#maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
  }

  get(endpoint: string, fingerprint: string): ComfyInputUploadCacheEntry | null {
    const key = getCacheKey(endpoint, fingerprint);
    const entry = this.#entries.get(key);
    if (!entry) return null;

    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  set(entry: ComfyInputUploadCacheEntry): void {
    const key = getCacheKey(entry.endpoint, entry.fingerprint);
    this.#entries.delete(key);
    this.#entries.set(key, entry);

    while (this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (!oldestKey) break;
      this.#entries.delete(oldestKey);
    }
  }

  delete(endpoint: string, fingerprint: string): void {
    this.#entries.delete(getCacheKey(endpoint, fingerprint));
  }

  deleteByImageName(endpoint: string, imageName: string): void {
    const normalizedEndpoint = normalizeCacheEndpoint(endpoint);
    for (const [key, entry] of this.#entries) {
      const isSameEndpoint = normalizeCacheEndpoint(entry.endpoint) === normalizedEndpoint;
      if (isSameEndpoint && entry.imageName === imageName) {
        this.#entries.delete(key);
      }
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}
