interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

const getDefinedString = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value : fallback;

export const isNativeDesktopApp = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as TauriWindow).__TAURI_INTERNALS__) || Boolean(__BLACKBOARD_STUDIO_DESKTOP__));

export const getNativeDesktopVersion = () =>
  getDefinedString(
    typeof __BLACKBOARD_STUDIO_VERSION__ === 'undefined'
      ? undefined
      : __BLACKBOARD_STUDIO_VERSION__,
    '0.0.0',
  );
