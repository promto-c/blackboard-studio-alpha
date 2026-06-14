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

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampFiniteNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return clampValue(numericValue, min, max);
};

export const clampEditorPanelWidth = (value: unknown): number =>
  clampFiniteNumber(value, EditorPanelWidth.DEFAULT, EditorPanelWidth.MIN, EditorPanelWidth.MAX);

export const clampEditorTimelineHeight = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EditorTimelineHeight.DEFAULT,
    EditorTimelineHeight.MIN,
    EditorTimelineHeight.MAX,
  );

export const clampEditorSubPanelWidth = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EditorSubPanelWidth.DEFAULT,
    EditorSubPanelWidth.MIN,
    EditorSubPanelWidth.MAX,
  );

export const clampEditorSubPanelHeight = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EditorSubPanelHeight.DEFAULT,
    EditorSubPanelHeight.MIN,
    EditorSubPanelHeight.MAX,
  );

export const clampEditorItemsPanelPercent = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EditorItemsPanelPercent.DEFAULT,
    EditorItemsPanelPercent.MIN,
    EditorItemsPanelPercent.MAX,
  );
