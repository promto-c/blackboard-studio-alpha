import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import isTextEntryTarget from '@/utils/isTextEntryTarget';
import { isSelectableTextTarget } from '@/utils/textSelectionScope';
import {
  findHotkeyConflicts,
  compileHotkeyBinding,
  resolveHotkeyBinding,
  type RegisteredHotkeyBinding,
} from './resolver';
import type {
  HotkeyBinding,
  HotkeyCommand,
  HotkeyExecutionContext,
  HotkeyScopeId,
  HotkeyScopeRegistration,
  KeyboardSnapshot,
} from './types';

interface RegisteredCommand {
  command: HotkeyCommand;
  namespace: string;
  order: number;
}

interface KeyboardStore {
  getSnapshot: () => KeyboardSnapshot;
  setSnapshot: (updater: (state: KeyboardSnapshot) => KeyboardSnapshot) => void;
  subscribe: (listener: () => void) => () => void;
}

interface HotkeyRegistryApi {
  keyboardStore: KeyboardStore;
  registerBindings: (namespace: string, bindings: HotkeyBinding[]) => () => void;
  registerCommands: (namespace: string, commands: HotkeyCommand[]) => () => void;
  registerScope: (registration: HotkeyScopeRegistration) => () => void;
}

interface HotkeyProviderProps {
  baseBindings?: HotkeyBinding[];
  baseCommands?: HotkeyCommand[];
  buildContext: (params: {
    keyboard: KeyboardSnapshot;
    target: EventTarget | null;
    isTextEntry: boolean;
  }) => HotkeyExecutionContext;
  children: React.ReactNode;
}

const HotkeyRegistryContext = createContext<HotkeyRegistryApi | null>(null);
const isDefined = <T,>(value: T | null | undefined): value is T => value != null;

const createKeyboardStore = (): KeyboardStore => {
  let snapshot: KeyboardSnapshot = {
    activeScopeId: 'global',
    activeScopePath: ['global'],
    focusedScopeId: null,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      mod: false,
      shift: false,
    },
    pointerScopeId: null,
    pressedCodes: new Set<string>(),
    pressedKeys: new Set<string>(),
  };
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (updater) => {
      const nextSnapshot = updater(snapshot);
      const hasChanged =
        nextSnapshot !== snapshot &&
        (nextSnapshot.activeScopeId !== snapshot.activeScopeId ||
          nextSnapshot.focusedScopeId !== snapshot.focusedScopeId ||
          nextSnapshot.pointerScopeId !== snapshot.pointerScopeId ||
          nextSnapshot.modifiers !== snapshot.modifiers ||
          nextSnapshot.pressedCodes !== snapshot.pressedCodes ||
          nextSnapshot.pressedKeys !== snapshot.pressedKeys ||
          nextSnapshot.activeScopePath !== snapshot.activeScopePath);

      snapshot = nextSnapshot;
      if (hasChanged) {
        listeners.forEach((listener) => listener());
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const getEventKey = (event: KeyboardEvent): string => {
  if (event.key === ' ') {
    return ' ';
  }
  return event.key.toLowerCase();
};

const blurActiveTextEntryForPointerTarget = (target: EventTarget | null): boolean => {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement) || !isTextEntryTarget(activeElement)) {
    return false;
  }

  if (target instanceof Node && activeElement.contains(target)) {
    return false;
  }

  if (isTextEntryTarget(target)) {
    return false;
  }

  activeElement.blur();
  return true;
};

export const HotkeyProvider: React.FC<HotkeyProviderProps> = ({
  baseBindings = [],
  baseCommands = [],
  buildContext,
  children,
}) => {
  const keyboardStoreRef = useRef<KeyboardStore | null>(null);
  if (!keyboardStoreRef.current) {
    keyboardStoreRef.current = createKeyboardStore();
  }
  const keyboardStore = keyboardStoreRef.current;

  const bindingsRef = useRef(new Map<string, RegisteredHotkeyBinding[]>());
  const commandsRef = useRef(new Map<string, RegisteredCommand[]>());
  const scopesRef = useRef(new Map<HotkeyScopeId, HotkeyScopeRegistration>());
  const orderRef = useRef(0);
  const reportedConflictsRef = useRef(new Set<string>());

  const getRegisteredBindings = useCallback((): RegisteredHotkeyBinding[] => {
    const bindings: RegisteredHotkeyBinding[] = [];
    bindingsRef.current.forEach((entries) => {
      bindings.push(...entries);
    });
    return bindings;
  }, []);

  const getRegisteredCommands = useCallback((): RegisteredCommand[] => {
    const commands: RegisteredCommand[] = [];
    commandsRef.current.forEach((entries) => {
      commands.push(...entries);
    });
    return commands;
  }, []);

  const buildScopePath = useCallback((scopeId: HotkeyScopeId | null): HotkeyScopeId[] => {
    if (!scopeId) {
      return ['global'];
    }

    const path: HotkeyScopeId[] = [];
    let currentId: HotkeyScopeId | undefined | null = scopeId;
    while (currentId) {
      path.unshift(currentId);
      currentId = scopesRef.current.get(currentId)?.parentId ?? null;
    }

    if (path[0] !== 'global') {
      path.unshift('global');
    }

    return path;
  }, []);

  const getActiveScopeId = useCallback(
    (focusedScopeId: HotkeyScopeId | null, pointerScopeId: HotkeyScopeId | null): HotkeyScopeId => {
      return focusedScopeId ?? pointerScopeId ?? 'global';
    },
    [],
  );

  const updateActiveScope = useCallback(
    (focusedScopeId: HotkeyScopeId | null, pointerScopeId: HotkeyScopeId | null) => {
      const activeScopeId = getActiveScopeId(focusedScopeId, pointerScopeId);
      const activeScopePath = buildScopePath(activeScopeId);
      keyboardStore.setSnapshot((snapshot) => ({
        ...snapshot,
        activeScopeId,
        activeScopePath,
        focusedScopeId,
        pointerScopeId,
      }));
    },
    [buildScopePath, getActiveScopeId, keyboardStore],
  );

  const resolveScopeFromTarget = useCallback((target: EventTarget | null): HotkeyScopeId | null => {
    if (!(target instanceof Element)) {
      return null;
    }

    const scopeElement = target.closest('[data-hotkey-scope-id]');
    if (!scopeElement) {
      return null;
    }

    const scopeId = scopeElement.getAttribute('data-hotkey-scope-id') as HotkeyScopeId | null;
    if (!scopeId || !scopesRef.current.has(scopeId)) {
      return null;
    }

    return scopeId;
  }, []);

  const warnForBindingConflicts = useCallback(() => {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const bindings = getRegisteredBindings();
    const conflicts = findHotkeyConflicts(bindings);
    conflicts.forEach((conflict) => {
      const signature = [
        conflict.combo,
        conflict.left.namespace,
        conflict.right.namespace,
        conflict.left.command,
        conflict.right.command,
      ].join('::');

      if (reportedConflictsRef.current.has(signature)) {
        return;
      }

      reportedConflictsRef.current.add(signature);
      console.warn(
        '[hotkeys] conflicting bindings:',
        conflict.combo,
        conflict.left.namespace,
        '->',
        conflict.left.command,
        'and',
        conflict.right.namespace,
        '->',
        conflict.right.command,
      );
    });
  }, [getRegisteredBindings]);

  const registerBindings = useCallback(
    (namespace: string, bindings: HotkeyBinding[]) => {
      const compiled = bindings
        .map((binding) => compileHotkeyBinding(namespace, binding, ++orderRef.current))
        .filter(isDefined);
      bindingsRef.current.set(namespace, compiled);
      warnForBindingConflicts();
      return () => {
        bindingsRef.current.delete(namespace);
      };
    },
    [warnForBindingConflicts],
  );

  const registerCommands = useCallback((namespace: string, commands: HotkeyCommand[]) => {
    const entries = commands.map((command) => ({
      command,
      namespace,
      order: ++orderRef.current,
    }));
    commandsRef.current.set(namespace, entries);
    return () => {
      commandsRef.current.delete(namespace);
    };
  }, []);

  const registerScope = useCallback(
    (registration: HotkeyScopeRegistration) => {
      scopesRef.current.set(registration.id, registration);
      updateActiveScope(
        keyboardStore.getSnapshot().focusedScopeId,
        keyboardStore.getSnapshot().pointerScopeId,
      );
      return () => {
        scopesRef.current.delete(registration.id);
        const snapshot = keyboardStore.getSnapshot();
        const focusedScopeId =
          snapshot.focusedScopeId === registration.id ? null : snapshot.focusedScopeId;
        const pointerScopeId =
          snapshot.pointerScopeId === registration.id ? null : snapshot.pointerScopeId;
        updateActiveScope(focusedScopeId, pointerScopeId);
      };
    },
    [keyboardStore, updateActiveScope],
  );

  const registryApi = useMemo<HotkeyRegistryApi>(
    () => ({
      keyboardStore,
      registerBindings,
      registerCommands,
      registerScope,
    }),
    [keyboardStore, registerBindings, registerCommands, registerScope],
  );

  useEffect(
    () => registerCommands('__base_commands__', baseCommands),
    [baseCommands, registerCommands],
  );
  useEffect(
    () => registerBindings('__base_bindings__', baseBindings),
    [baseBindings, registerBindings],
  );

  useEffect(() => {
    const handlePointerDownCapture = (event: PointerEvent) => {
      const pointerScopeId = resolveScopeFromTarget(event.target);
      const didBlurTextEntry = blurActiveTextEntryForPointerTarget(event.target);
      const focusedScopeId = didBlurTextEntry
        ? resolveScopeFromTarget(document.activeElement)
        : keyboardStore.getSnapshot().focusedScopeId;
      updateActiveScope(focusedScopeId, pointerScopeId);
    };

    const handleFocusInCapture = (event: FocusEvent) => {
      const focusedScopeId = resolveScopeFromTarget(event.target);
      updateActiveScope(focusedScopeId, keyboardStore.getSnapshot().pointerScopeId);
    };

    const handleFocusOutCapture = (event: FocusEvent) => {
      const nextFocusedTarget = event.relatedTarget ?? document.activeElement;
      const focusedScopeId = resolveScopeFromTarget(nextFocusedTarget);
      updateActiveScope(focusedScopeId, keyboardStore.getSnapshot().pointerScopeId);
    };

    const handleWindowBlur = () => {
      keyboardStore.setSnapshot((snapshot) => ({
        ...snapshot,
        modifiers: {
          alt: false,
          ctrl: false,
          meta: false,
          mod: false,
          shift: false,
        },
        pressedCodes: new Set<string>(),
        pressedKeys: new Set<string>(),
      }));
    };

    const updateKeyboardState = (event: KeyboardEvent, isKeyDown: boolean) => {
      keyboardStore.setSnapshot((snapshot) => {
        const pressedCodes = new Set(snapshot.pressedCodes);
        const pressedKeys = new Set(snapshot.pressedKeys);
        const eventKey = getEventKey(event);

        if (isKeyDown) {
          pressedCodes.add(event.code);
          pressedKeys.add(eventKey);
        } else {
          pressedCodes.delete(event.code);
          pressedKeys.delete(eventKey);
        }

        return {
          ...snapshot,
          modifiers: {
            alt: isKeyDown ? event.altKey : event.altKey,
            ctrl: isKeyDown ? event.ctrlKey : event.ctrlKey,
            meta: isKeyDown ? event.metaKey : event.metaKey,
            mod: isKeyDown ? event.metaKey || event.ctrlKey : event.metaKey || event.ctrlKey,
            shift: isKeyDown ? event.shiftKey : event.shiftKey,
          },
          pressedCodes,
          pressedKeys,
        };
      });
    };

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      updateKeyboardState(event, true);

      const keyboard = keyboardStore.getSnapshot();
      const isTextEntry = isTextEntryTarget(event.target) || isSelectableTextTarget(event.target);
      const context = buildContext({
        keyboard,
        target: event.target,
        isTextEntry,
      });

      const candidates = resolveHotkeyBinding(getRegisteredBindings(), event, context);
      if (!candidates.length) {
        return;
      }

      const registeredCommands = getRegisteredCommands();
      for (const candidate of candidates) {
        const command = registeredCommands
          .filter((entry) => entry.command.id === candidate.command)
          .sort((left, right) => right.order - left.order)[0]?.command;
        if (!command) {
          continue;
        }

        const handled = command.run(context, candidate.args);
        if (handled === false) {
          continue;
        }

        if (candidate.preventDefault) {
          event.preventDefault();
        }
        break;
      }
    };

    const handleKeyUpCapture = (event: KeyboardEvent) => {
      updateKeyboardState(event, false);
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    document.addEventListener('focusin', handleFocusInCapture, true);
    document.addEventListener('focusout', handleFocusOutCapture, true);
    window.addEventListener('keydown', handleKeyDownCapture, true);
    window.addEventListener('keyup', handleKeyUpCapture, true);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDownCapture, true);
      document.removeEventListener('focusin', handleFocusInCapture, true);
      document.removeEventListener('focusout', handleFocusOutCapture, true);
      window.removeEventListener('keydown', handleKeyDownCapture, true);
      window.removeEventListener('keyup', handleKeyUpCapture, true);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    buildContext,
    getRegisteredBindings,
    getRegisteredCommands,
    keyboardStore,
    resolveScopeFromTarget,
    updateActiveScope,
  ]);

  return (
    <HotkeyRegistryContext.Provider value={registryApi}>{children}</HotkeyRegistryContext.Provider>
  );
};

const useHotkeyRegistry = (): HotkeyRegistryApi => {
  const registry = useContext(HotkeyRegistryContext);
  if (!registry) {
    throw new Error('Hotkey hooks must be used within a HotkeyProvider');
  }
  return registry;
};

export const useHotkeyScope = (
  registration: Omit<HotkeyScopeRegistration, 'element'> & {
    ref: React.RefObject<HTMLElement | null>;
  },
): void => {
  const registry = useHotkeyRegistry();
  const { id, parentId, ref } = registration;

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    element.dataset.hotkeyScopeId = id;
    const unregister = registry.registerScope({ element, id, parentId });
    return () => {
      unregister();
      if (element.dataset.hotkeyScopeId === id) {
        delete element.dataset.hotkeyScopeId;
      }
    };
  }, [id, parentId, ref, registry]);
};

export const useRegisterHotkeys = (namespace: string, bindings: HotkeyBinding[]): void => {
  const registry = useHotkeyRegistry();
  useEffect(() => registry.registerBindings(namespace, bindings), [bindings, namespace, registry]);
};

export const useRegisterHotkeyCommands = (namespace: string, commands: HotkeyCommand[]): void => {
  const registry = useHotkeyRegistry();
  useEffect(() => registry.registerCommands(namespace, commands), [commands, namespace, registry]);
};

export function useKeyboardState<T>(selector: (snapshot: KeyboardSnapshot) => T): T {
  const registry = useHotkeyRegistry();
  const selectorRef = useRef(selector);
  const resultRef = useRef<T>();
  selectorRef.current = selector;

  return useSyncExternalStore(registry.keyboardStore.subscribe, () => {
    const nextResult = selectorRef.current(registry.keyboardStore.getSnapshot());
    if (resultRef.current !== undefined && Object.is(resultRef.current, nextResult)) {
      return resultRef.current;
    }
    resultRef.current = nextResult;
    return nextResult;
  });
}

export const useKeyPressed = (code: string): boolean => {
  return useKeyboardState((snapshot) => snapshot.pressedCodes.has(code));
};
