export const EditorPanelWidth = {
  MIN: 280,
  MAX: 1000,
  DEFAULT: 600,
} as const;

export const EditorTimelineHeight = {
  MIN: 40,
  MAX: 600,
  /** Defaults to MIN (40) */
  DEFAULT: 40,
} as const;

export const EditorSubPanelWidth = {
  MIN: 240,
  MAX: 560,
  DEFAULT: 360,
} as const;

export const EditorSubPanelHeight = {
  MIN: 180,
  MAX: 340,
  DEFAULT: 220,
} as const;

export const EditorItemsPanelPercent = {
  MIN: 20,
  MAX: 72,
  DEFAULT: 38,
} as const;

const clampFiniteNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
};

const clampEditor = (value: unknown, config: { DEFAULT: number; MIN: number; MAX: number }) =>
  clampFiniteNumber(value, config.DEFAULT, config.MIN, config.MAX);

export const clampEditorPanelWidth = (v: unknown) => clampEditor(v, EditorPanelWidth);
export const clampEditorTimelineHeight = (v: unknown) => clampEditor(v, EditorTimelineHeight);
export const clampEditorSubPanelWidth = (v: unknown) => clampEditor(v, EditorSubPanelWidth);
export const clampEditorSubPanelHeight = (v: unknown) => clampEditor(v, EditorSubPanelHeight);
export const clampEditorItemsPanelPercent = (v: unknown) => clampEditor(v, EditorItemsPanelPercent);
