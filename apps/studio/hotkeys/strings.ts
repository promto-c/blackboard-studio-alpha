const HOTKEY_COMBO_SEPARATOR = /\s*\+\s*/;
const HOTKEY_ALTERNATIVE_SEPARATOR = /\s+\/\s+|\s*,\s*|\s+\bor\b\s+/i;

const TOKEN_ALIASES: Record<string, string> = {
  command: 'cmd',
  cmd: 'cmd',
  control: 'ctrl',
  ctrl: 'ctrl',
  mod: 'mod',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  enter: 'enter',
  return: 'enter',
  escape: 'esc',
  esc: 'esc',
  tab: 'tab',
  space: 'space',
  spacebar: 'space',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pgup: 'pageup',
  pagedown: 'pagedown',
  pgdn: 'pagedown',
  arrowup: 'up',
  up: 'up',
  arrowdown: 'down',
  down: 'down',
  arrowleft: 'left',
  left: 'left',
  arrowright: 'right',
  right: 'right',
  minus: '-',
  plus: '+',
};

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent || '');
}

const DISPLAY_TOKEN_ALIASES: Record<string, string> = {
  cmd: 'Cmd',
  ctrl: 'Ctrl',
  mod: isMacPlatform() ? 'Cmd' : 'Ctrl',
  shift: 'Shift',
  alt: isMacPlatform() ? 'Opt' : 'Alt',
  meta: 'Meta',
  enter: 'Enter',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Del',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
};

const MODIFIER_ORDER = ['cmd', 'ctrl', 'mod', 'alt', 'shift', 'meta'] as const;
const HOTKEY_TOKEN_PATTERN =
  /^(?:Mod|Ctrl|Cmd|Shift|Alt|Option|Meta|Space|Tab|Enter|Esc|Escape|Backspace|Delete|Del|Home|End|Up|Down|Left|Right|PageUp|PageDown|PgUp|PgDn|F(?:[1-9]|1[0-2])|[A-Za-z0-9]|[-=+])$/i;

export interface ParsedHotkeyCombo {
  alt: boolean;
  ctrl: boolean;
  key: string | null;
  meta: boolean;
  mod: boolean;
  raw: string;
  shift: boolean;
}

const normalizeToken = (rawToken: string): string => {
  const token = rawToken.trim();
  if (!token) return '';

  if (token.includes('/')) {
    return token
      .split('/')
      .map((part) => normalizeToken(part))
      .filter(Boolean)
      .join('/');
  }

  const alias = TOKEN_ALIASES[token.toLowerCase()];
  if (alias) return alias;

  if (/^f(?:[1-9]|1[0-2])$/i.test(token)) return token.toLowerCase();
  if (token.length === 1) return token.toLowerCase();
  return token.toLowerCase();
};

export const splitComboTokens = (value: string): string[] =>
  value
    .split(HOTKEY_COMBO_SEPARATOR)
    .map((token) => token.trim())
    .filter(Boolean);

export const splitHotkeyAlternatives = (value: string): string[] =>
  value
    .split(HOTKEY_ALTERNATIVE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);

const isHotkeyToken = (rawToken: string): boolean => {
  const token = rawToken.trim();
  if (!token) return false;

  if (token.includes('/')) {
    return token.split('/').every((part) => HOTKEY_TOKEN_PATTERN.test(part.trim()));
  }

  return HOTKEY_TOKEN_PATTERN.test(token);
};

export const looksLikeHotkeyCombo = (value: string): boolean => {
  const alternatives = splitHotkeyAlternatives(value);
  if (!alternatives.length) return false;

  return alternatives.every((alternative) => {
    const comboTokens = splitComboTokens(alternative);
    return comboTokens.length > 0 && comboTokens.every((token) => isHotkeyToken(token));
  });
};

export const formatHotkeyToken = (rawToken: string): string => {
  const token = normalizeToken(rawToken);
  if (!token) return '';

  const alias = DISPLAY_TOKEN_ALIASES[token];
  if (alias) return alias;
  if (/^f(?:[1-9]|1[0-2])$/i.test(token)) return token.toUpperCase();
  if (token.length === 1) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
};

export const formatHotkeyCombo = (combo: string): string[] =>
  splitComboTokens(combo)
    .map((token) => formatHotkeyToken(token))
    .filter(Boolean);

export const parseHotkeyCombo = (combo: string): ParsedHotkeyCombo | null => {
  const tokens = splitComboTokens(combo)
    .map((token) => normalizeToken(token))
    .filter(Boolean);
  if (!tokens.length) return null;

  const parsed: ParsedHotkeyCombo = {
    alt: false,
    ctrl: false,
    key: null,
    meta: false,
    mod: false,
    raw: combo,
    shift: false,
  };

  for (const token of tokens) {
    if (token === 'alt') {
      parsed.alt = true;
      continue;
    }
    if (token === 'ctrl') {
      parsed.ctrl = true;
      continue;
    }
    if (token === 'meta') {
      parsed.meta = true;
      continue;
    }
    if (token === 'mod') {
      parsed.mod = true;
      continue;
    }
    if (token === 'shift') {
      parsed.shift = true;
      continue;
    }
    if (parsed.key) {
      return null;
    }
    parsed.key = token;
  }

  return parsed.key ? parsed : null;
};

const normalizeEventKey = (event: KeyboardEvent): string | null => {
  const { key } = event;
  if (!key) return null;

  if (key === ' ') return 'space';
  if (key === 'Esc') return 'esc';
  if (key.length === 1) return key.toLowerCase();

  return normalizeToken(key);
};

export const isModifierOnlyEvent = (event: KeyboardEvent): boolean => {
  const key = normalizeEventKey(event);
  return key === 'alt' || key === 'ctrl' || key === 'meta' || key === 'shift';
};

export const matchesHotkeyEvent = (
  parsed: ParsedHotkeyCombo,
  event: KeyboardEvent,
  isMac = isMacPlatform(),
): boolean => {
  const key = normalizeEventKey(event);
  if (!key || key !== parsed.key) {
    return false;
  }

  const expectedCtrl = parsed.ctrl || (!isMac && parsed.mod);
  const expectedMeta = parsed.meta || (isMac && parsed.mod);

  return (
    event.altKey === parsed.alt &&
    event.ctrlKey === expectedCtrl &&
    event.metaKey === expectedMeta &&
    event.shiftKey === parsed.shift
  );
};

export const normalizeHotkeyForLookup = (combo: string): string | null => {
  const parsed = parseHotkeyCombo(combo);
  if (!parsed || !parsed.key) return null;

  const modifiers = MODIFIER_ORDER.filter((modifier) => {
    if (modifier === 'alt') return parsed.alt;
    if (modifier === 'ctrl') return parsed.ctrl;
    if (modifier === 'meta') return parsed.meta;
    if (modifier === 'mod') return parsed.mod;
    if (modifier === 'shift') return parsed.shift;
    if (modifier === 'cmd') return false;
    return false;
  });

  return [...modifiers, parsed.key].join('+');
};
