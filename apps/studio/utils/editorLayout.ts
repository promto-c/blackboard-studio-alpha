export const EDITOR_PANEL_WIDTH_MIN = 280;
export const EDITOR_PANEL_WIDTH_MAX = 1000;
export const EDITOR_PANEL_WIDTH_DEFAULT = 600;

export const EDITOR_TIMELINE_HEIGHT_MIN = 40;
export const EDITOR_TIMELINE_HEIGHT_MAX = 600;
export const EDITOR_TIMELINE_HEIGHT_DEFAULT = EDITOR_TIMELINE_HEIGHT_MIN;

export const EDITOR_SUB_PANEL_WIDTH_MIN = 240;
export const EDITOR_SUB_PANEL_WIDTH_MAX = 560;
export const EDITOR_SUB_PANEL_WIDTH_DEFAULT = 360;

export const EDITOR_SUB_PANEL_HEIGHT_MIN = 180;
export const EDITOR_SUB_PANEL_HEIGHT_MAX = 340;
export const EDITOR_SUB_PANEL_HEIGHT_DEFAULT = 220;

export const EDITOR_ITEMS_PANEL_PERCENT_MIN = 20;
export const EDITOR_ITEMS_PANEL_PERCENT_MAX = 72;
export const EDITOR_ITEMS_PANEL_PERCENT_DEFAULT = 38;

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampFiniteNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return clampValue(numericValue, min, max);
};

export const clampEditorPanelWidth = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EDITOR_PANEL_WIDTH_DEFAULT,
    EDITOR_PANEL_WIDTH_MIN,
    EDITOR_PANEL_WIDTH_MAX,
  );

export const clampEditorTimelineHeight = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EDITOR_TIMELINE_HEIGHT_DEFAULT,
    EDITOR_TIMELINE_HEIGHT_MIN,
    EDITOR_TIMELINE_HEIGHT_MAX,
  );

export const clampEditorSubPanelWidth = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EDITOR_SUB_PANEL_WIDTH_DEFAULT,
    EDITOR_SUB_PANEL_WIDTH_MIN,
    EDITOR_SUB_PANEL_WIDTH_MAX,
  );

export const clampEditorSubPanelHeight = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EDITOR_SUB_PANEL_HEIGHT_DEFAULT,
    EDITOR_SUB_PANEL_HEIGHT_MIN,
    EDITOR_SUB_PANEL_HEIGHT_MAX,
  );

export const clampEditorItemsPanelPercent = (value: unknown): number =>
  clampFiniteNumber(
    value,
    EDITOR_ITEMS_PANEL_PERCENT_DEFAULT,
    EDITOR_ITEMS_PANEL_PERCENT_MIN,
    EDITOR_ITEMS_PANEL_PERCENT_MAX,
  );
