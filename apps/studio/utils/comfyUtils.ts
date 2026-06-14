export const normalizeComfyType = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');
