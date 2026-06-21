interface ComfyRunShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export const isComfyRunShortcut = (event: ComfyRunShortcutEvent): boolean =>
  event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey;
