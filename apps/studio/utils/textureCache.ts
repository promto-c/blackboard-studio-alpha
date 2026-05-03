import * as THREE from 'three';

interface CacheEntry {
  id: string;
  texture: THREE.Texture;
  video?: HTMLVideoElement;
  objectUrl?: string;
  sizeBytes: number;
  lastAccess: number;
  frameIndex?: number; // Optional: helps map specific frames for sequences
}

export class TextureCache {
  private cache = new Map<string, CacheEntry>();
  private memoryUsage = 0;
  private memoryLimit = 512 * 1024 * 1024; // 512 MB default limit
  private frameLimit: number | null = null;

  constructor(limitMB: number = 512, frameLimit?: number | null) {
    this.memoryLimit = limitMB * 1024 * 1024;
    this.frameLimit = typeof frameLimit === 'number' && frameLimit >= 0 ? frameLimit : null;
  }

  public get(id: string): CacheEntry | undefined {
    const entry = this.cache.get(id);
    if (entry) {
      entry.lastAccess = performance.now();
      return entry;
    }
    return undefined;
  }

  public has(id: string): boolean {
    return this.cache.has(id);
  }

  public entries(): IterableIterator<[string, CacheEntry]> {
    return this.cache.entries();
  }

  public add(
    id: string,
    texture: THREE.Texture,
    video?: HTMLVideoElement,
    objectUrl?: string,
    frameIndex?: number,
  ) {
    if (this.cache.has(id)) {
      this.get(id); // Touch
      return;
    }

    const width = (texture.image as any)?.width || video?.videoWidth || 1024;
    const height = (texture.image as any)?.height || video?.videoHeight || 1024;
    const sizeBytes = width * height * this.getBytesPerPixel(texture);

    // Ensure we have space
    this.ensureSpace(sizeBytes);

    const entry: CacheEntry = {
      id,
      texture,
      video,
      objectUrl,
      sizeBytes,
      lastAccess: performance.now(),
      frameIndex,
    };

    this.cache.set(id, entry);
    this.memoryUsage += sizeBytes;
    this.ensureFrameBudget();
  }

  private ensureSpace(requiredBytes: number) {
    if (this.memoryUsage + requiredBytes <= this.memoryLimit) return;

    // Sort by last access time (oldest first)
    const sortedEntries = Array.from(this.cache.values()).sort(
      (a, b) => a.lastAccess - b.lastAccess,
    );

    for (const entry of sortedEntries) {
      if (this.memoryUsage + requiredBytes <= this.memoryLimit) break;

      this.remove(entry.id);
    }
  }

  private remove(id: string) {
    const entry = this.cache.get(id);
    if (!entry) return;

    entry.texture.dispose();
    if (entry.video) {
      entry.video.pause();
      entry.video.src = '';
      entry.video.remove();
    }
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }

    this.memoryUsage -= entry.sizeBytes;
    this.cache.delete(id);
  }

  private ensureFrameBudget() {
    if (this.frameLimit === null) return;

    const frameEntries = Array.from(this.cache.values())
      .filter((entry) => entry.frameIndex !== undefined)
      .sort((a, b) => a.lastAccess - b.lastAccess);

    let overflow = frameEntries.length - this.frameLimit;
    if (overflow <= 0) return;

    for (const entry of frameEntries) {
      if (overflow <= 0) break;
      this.remove(entry.id);
      overflow -= 1;
    }
  }

  public getMemoryStatus() {
    return {
      used: this.memoryUsage,
      limit: this.memoryLimit,
      count: this.cache.size,
    };
  }

  public getCachedFramesForNode(assetIds: string[]): boolean[] {
    // Returns a boolean map corresponding to the input array
    return assetIds.map((id) => this.cache.has(id));
  }

  public prune(keepIds: Set<string>) {
    for (const id of Array.from(this.cache.keys())) {
      if (!keepIds.has(id)) this.remove(id);
    }
  }

  public clear() {
    Array.from(this.cache.keys()).forEach((id) => this.remove(id));
  }

  public setLimit(limitMB: number) {
    this.memoryLimit = limitMB * 1024 * 1024;
    this.ensureSpace(0); // Prune immediately if current usage exceeds new limit
  }

  public setFrameLimit(limit: number | null) {
    this.frameLimit = typeof limit === 'number' && limit >= 0 ? limit : null;
    this.ensureFrameBudget();
  }

  private getBytesPerPixel(texture: THREE.Texture): number {
    if (texture.type === THREE.FloatType) return 16;
    if (texture.type === THREE.HalfFloatType) return 8;
    return 4;
  }
}
