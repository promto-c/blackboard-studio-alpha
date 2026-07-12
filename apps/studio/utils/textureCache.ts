import * as THREE from 'three';

export interface TextureCacheEntry {
  id: string;
  texture: THREE.Texture;
  video?: HTMLVideoElement;
  objectUrl?: string;
  sizeBytes: number;
  lastAccess: number;
  frameIndex?: number; // Optional: helps map specific frames for sequences
}

export class TextureCache {
  private cache = new Map<string, TextureCacheEntry>();
  private memoryUsage = 0;
  private memoryLimit = 512 * 1024 * 1024; // 512 MB default limit
  private frameLimit: number | null = null;

  constructor(limitMB: number = 512, frameLimit?: number | null) {
    this.memoryLimit = limitMB * 1024 * 1024;
    this.frameLimit = typeof frameLimit === 'number' && frameLimit >= 0 ? frameLimit : null;
  }

  public get(id: string): TextureCacheEntry | undefined {
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

  public entries(): IterableIterator<[string, TextureCacheEntry]> {
    return this.cache.entries();
  }

  public add(
    id: string,
    texture: THREE.Texture,
    video?: HTMLVideoElement,
    objectUrl?: string,
    frameIndex?: number,
  ): boolean {
    const existing = this.cache.get(id);
    if (existing) {
      existing.lastAccess = performance.now();
      // add() transfers ownership to the cache. A racing producer that loses
      // deduplication must have its newly-created resources released.
      if (existing.texture !== texture) this.disposeTexture(texture);
      if (video && existing.video !== video) this.disposeVideo(video);
      if (objectUrl && existing.objectUrl !== objectUrl) URL.revokeObjectURL(objectUrl);
      return false;
    }

    const img = texture.image as { width?: number; height?: number } | null;
    const width = img?.width || video?.videoWidth || 1024;
    const height = img?.height || video?.videoHeight || 1024;
    const sizeBytes = this.estimateResidentBytes(texture, width, height);

    // Ensure we have space
    this.ensureSpace(sizeBytes);

    const entry: TextureCacheEntry = {
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
    return true;
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

    this.memoryUsage -= entry.sizeBytes;
    this.cache.delete(id);

    this.disposeTexture(entry.texture);
    if (
      entry.video &&
      !Array.from(this.cache.values()).some(({ video }) => video === entry.video)
    ) {
      this.disposeVideo(entry.video);
    }
    if (
      entry.objectUrl &&
      !Array.from(this.cache.values()).some(({ objectUrl }) => objectUrl === entry.objectUrl)
    ) {
      URL.revokeObjectURL(entry.objectUrl);
    }
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

  public prune(keepIds: Set<string>, shouldKeep?: (id: string) => boolean) {
    for (const id of Array.from(this.cache.keys())) {
      if (!keepIds.has(id) && !shouldKeep?.(id)) this.remove(id);
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

  private estimateResidentBytes(texture: THREE.Texture, width: number, height: number): number {
    const gpuBytes = width * height * this.getBytesPerPixel(texture);
    const image = texture.image as { data?: unknown } | null;
    const data = image?.data;

    if (ArrayBuffer.isView(data)) {
      return gpuBytes + data.byteLength;
    }

    const ownsDecodedPixelSource =
      (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
      (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
      (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement) ||
      (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap);

    // Canvas/image/video-backed textures retain decoded CPU pixels as well as
    // their GPU upload. Counting both keeps the user-visible cache budget close
    // to actual process memory instead of under-reporting it by roughly 2x.
    return gpuBytes + (ownsDecodedPixelSource ? width * height * 4 : 0);
  }

  private disposeTexture(texture: THREE.Texture) {
    const image = texture.image as unknown;
    const retainedEntries = Array.from(this.cache.values());
    if (retainedEntries.some((entry) => entry.texture === texture)) return;

    texture.dispose();
    if (retainedEntries.some((entry) => entry.texture.image === image)) return;

    if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
      image.width = 0;
      image.height = 0;
    } else if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      image.close();
    }
  }

  private disposeVideo(video: HTMLVideoElement) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}
