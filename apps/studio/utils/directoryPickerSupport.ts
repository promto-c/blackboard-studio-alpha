export interface DirectoryPickerSupport {
  canUseDirectoryPicker: boolean;
  reason?: string;
}

const isCrossOriginEmbeddedFrame = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (window.parent === window) return false;

  try {
    return window.parent.location.origin !== window.location.origin;
  } catch {
    return true;
  }
};

export const getDirectoryPickerSupport = (): DirectoryPickerSupport => {
  if (typeof window === 'undefined') {
    return {
      canUseDirectoryPicker: false,
      reason: 'Folder picker is unavailable in this environment.',
    };
  }

  if (!(window as any).showDirectoryPicker) {
    return {
      canUseDirectoryPicker: false,
      reason: 'Your browser does not support the File System Access folder picker API.',
    };
  }

  if (!window.isSecureContext) {
    return {
      canUseDirectoryPicker: false,
      reason: 'Folder picker requires a secure context (HTTPS or localhost).',
    };
  }

  if (isCrossOriginEmbeddedFrame()) {
    return {
      canUseDirectoryPicker: false,
      reason:
        'This app is running in a cross-origin embedded frame, and browsers block folder picker APIs there.',
    };
  }

  return { canUseDirectoryPicker: true };
};
