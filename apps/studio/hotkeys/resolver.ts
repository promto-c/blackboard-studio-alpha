import {
  matchesHotkeyEvent,
  normalizeHotkeyForLookup,
  parseHotkeyCombo,
  splitHotkeyAlternatives,
} from './strings';
import type { HotkeyBinding, HotkeyContext, HotkeyScopeId } from './types';

export const DEFAULT_PREVENT_DEFAULT = true;
export const DEFAULT_REPEAT = true;

export const DEFAULT_SCOPE_WEIGHTS: Record<HotkeyScopeId, number> = {
  global: 100,
  flow: 200,
  'flow.list': 200,
  'flow.graph': 200,
  viewport: 200,
  timeline: 200,
  'timeline.dopesheet': 200,
  'timeline.graph': 200,
};

export interface RegisteredHotkeyBinding {
  allowInTextEntry: boolean;
  args: unknown;
  command: string;
  combos: ReturnType<typeof parseHotkeyCombo>[];
  keys: string[];
  namespace: string;
  order: number;
  preventDefault: boolean;
  raw: HotkeyBinding;
  repeat: boolean;
  scope: HotkeyScopeId[];
  weight: number;
}

export interface HotkeyConflict {
  combo: string;
  left: RegisteredHotkeyBinding;
  right: RegisteredHotkeyBinding;
}

const normalizeBindingKeys = (keys: string | string[]): string[] => {
  const source = Array.isArray(keys) ? keys : [keys];
  return source
    .flatMap((value) => splitHotkeyAlternatives(value))
    .map((combo) => combo.trim())
    .filter(Boolean);
};

const normalizeScopes = (scope?: HotkeyScopeId | HotkeyScopeId[]): HotkeyScopeId[] => {
  if (!scope) return ['global'];
  return Array.isArray(scope) ? scope : [scope];
};

export const getDefaultHotkeyWeight = (scopes: HotkeyScopeId[]): number => {
  return scopes.reduce((max, scope) => Math.max(max, DEFAULT_SCOPE_WEIGHTS[scope] ?? 100), 100);
};

export const compileHotkeyBinding = (
  namespace: string,
  binding: HotkeyBinding,
  order: number,
): RegisteredHotkeyBinding | null => {
  const keys = normalizeBindingKeys(binding.keys);
  const combos = keys.map((combo) => parseHotkeyCombo(combo)).filter(Boolean);
  if (!combos.length) {
    return null;
  }

  const scopes = normalizeScopes(binding.scope);

  return {
    allowInTextEntry: binding.allowInTextEntry ?? false,
    args: binding.args,
    command: binding.command,
    combos,
    keys,
    namespace,
    order,
    preventDefault: binding.preventDefault ?? DEFAULT_PREVENT_DEFAULT,
    raw: binding,
    repeat: binding.repeat ?? DEFAULT_REPEAT,
    scope: scopes,
    weight: binding.weight ?? getDefaultHotkeyWeight(scopes),
  };
};

const scopeMatches = (
  binding: RegisteredHotkeyBinding,
  activeScopePath: HotkeyScopeId[],
): boolean => {
  return binding.scope.some((scope) => activeScopePath.includes(scope));
};

const scopeDepth = (binding: RegisteredHotkeyBinding, activeScopePath: HotkeyScopeId[]): number => {
  return binding.scope.reduce((maxDepth, scope) => {
    const index = activeScopePath.indexOf(scope);
    return index === -1 ? maxDepth : Math.max(maxDepth, index);
  }, -1);
};

export const resolveHotkeyBinding = (
  bindings: RegisteredHotkeyBinding[],
  event: KeyboardEvent,
  context: HotkeyContext,
): RegisteredHotkeyBinding[] => {
  return bindings
    .filter((binding) => {
      if (!binding.repeat && event.repeat) {
        return false;
      }
      if (!binding.allowInTextEntry && context.isTextEntry) {
        return false;
      }
      if (!scopeMatches(binding, context.activeScopePath)) {
        return false;
      }
      if (binding.raw.when && !binding.raw.when(context)) {
        return false;
      }
      return binding.combos.some((combo) => combo && matchesHotkeyEvent(combo, event));
    })
    .sort((left, right) => {
      if (right.weight !== left.weight) {
        return right.weight - left.weight;
      }

      const depthDiff =
        scopeDepth(right, context.activeScopePath) - scopeDepth(left, context.activeScopePath);
      if (depthDiff !== 0) {
        return depthDiff;
      }

      return right.order - left.order;
    });
};

export const findHotkeyConflicts = (bindings: RegisteredHotkeyBinding[]): HotkeyConflict[] => {
  const conflicts: HotkeyConflict[] = [];
  for (let index = 0; index < bindings.length; index += 1) {
    const left = bindings[index];
    for (let compareIndex = index + 1; compareIndex < bindings.length; compareIndex += 1) {
      const right = bindings[compareIndex];
      if (left.weight !== right.weight) continue;

      const sharedScope = left.scope.some((scope) => right.scope.includes(scope));
      if (!sharedScope) continue;

      const leftCombos = new Set(
        left.keys.map((combo) => normalizeHotkeyForLookup(combo)).filter(Boolean),
      );
      const rightCombos = new Set(
        right.keys.map((combo) => normalizeHotkeyForLookup(combo)).filter(Boolean),
      );

      for (const combo of leftCombos) {
        if (rightCombos.has(combo)) {
          conflicts.push({ combo, left, right });
        }
      }
    }
  }
  return conflicts;
};
