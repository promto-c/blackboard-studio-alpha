import type { HotkeyBinding, HotkeyCommand, HotkeyScopeId } from '@/hotkeys';

export interface StandardClipboardHandlers {
  onCopy?: () => boolean;
  onCut?: () => boolean;
  onPaste?: () => boolean;
}

export type StandardClipboardAction = 'copy' | 'cut' | 'paste';

interface StandardClipboardKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

const resolveClipboardHandler = (
  action: StandardClipboardAction,
  handlers: StandardClipboardHandlers,
): (() => boolean) | undefined => {
  if (action === 'copy') return handlers.onCopy;
  if (action === 'cut') return handlers.onCut;
  return handlers.onPaste;
};

export const getStandardClipboardAction = (
  event: Pick<StandardClipboardKeyEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): StandardClipboardAction | null => {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === 'c') return 'copy';
  if (key === 'x') return 'cut';
  if (key === 'v') return 'paste';
  return null;
};

export const handleStandardClipboardHotkeyEvent = (
  event: StandardClipboardKeyEvent,
  handlers: StandardClipboardHandlers | undefined,
): boolean => {
  if (!handlers) {
    return false;
  }

  const action = getStandardClipboardAction(event);
  if (!action) {
    return false;
  }

  const handler = resolveClipboardHandler(action, handlers);
  if (!handler || handler() === false) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  return true;
};

const getClipboardCommandIds = (idPrefix: string) => ({
  copy: `${idPrefix}.clipboard.copy`,
  cut: `${idPrefix}.clipboard.cut`,
  paste: `${idPrefix}.clipboard.paste`,
});

export const createStandardClipboardHotkeyCommands = (
  idPrefix: string,
  handlers: StandardClipboardHandlers,
): HotkeyCommand[] => {
  const ids = getClipboardCommandIds(idPrefix);

  return [
    {
      id: ids.copy,
      run: () => handlers.onCopy?.() ?? false,
    },
    {
      id: ids.cut,
      run: () => handlers.onCut?.() ?? false,
    },
    {
      id: ids.paste,
      run: () => handlers.onPaste?.() ?? false,
    },
  ];
};

export const createStandardClipboardHotkeyBindings = ({
  idPrefix,
  scope,
  weight = 350,
  when,
}: {
  idPrefix: string;
  scope: HotkeyScopeId | HotkeyScopeId[];
  weight?: number;
  when?: HotkeyBinding['when'];
}): HotkeyBinding[] => {
  const ids = getClipboardCommandIds(idPrefix);

  return [
    {
      keys: 'Mod+C',
      command: ids.copy,
      scope,
      weight,
      when,
    },
    {
      keys: 'Mod+X',
      command: ids.cut,
      scope,
      weight,
      when,
    },
    {
      keys: 'Mod+V',
      command: ids.paste,
      scope,
      weight,
      when,
    },
  ];
};
