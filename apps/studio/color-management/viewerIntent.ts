import type { DisplayViewSelection } from '@blackboard/types';
import type { ColorManagementRuntimeSnapshot } from './types';

export interface ViewerColorManagement {
  displayViewOverride: DisplayViewSelection | null;
  /**
   * Auto-detected display/view derived from the first input source's
   * color space.  Mutually compatible with `displayViewOverride`:
   * the override takes precedence when set, and the auto-detected view
   * is used when no manual override exists.
   */
  autoDetectView: DisplayViewSelection | null;
}

export const createDefaultViewerColorManagement = (): ViewerColorManagement => ({
  displayViewOverride: null,
  autoDetectView: null,
});

/**
 * Resolve the effective viewport display/view by checking, in order:
 *
 * 1. `displayViewOverride` — temporary manual override from the viewport toolbar.
 * 2. `autoDetectView`       — auto-detected view based on the first input source.
 * 3. `projectDisplayView`   — the project's configured default.
 */
export const resolveCurrentViewerDisplayView = (
  projectDisplayView: DisplayViewSelection,
  viewerColorManagement: ViewerColorManagement,
): DisplayViewSelection =>
  viewerColorManagement.displayViewOverride ??
  viewerColorManagement.autoDetectView ??
  projectDisplayView;

/**
 * Returns `true` when the user has explicitly overridden the viewport
 * display/view via the viewport toolbar.  Auto-detected views are
 * *not* considered user overrides so that the "Reset to Project View"
 * button does not appear when only auto-detection is active.
 */
export const hasViewerDisplayOverride = (viewerColorManagement: ViewerColorManagement): boolean =>
  viewerColorManagement.displayViewOverride !== null;

type DisplayViewRuntime = Pick<
  ColorManagementRuntimeSnapshot,
  'defaultDisplay' | 'defaultView' | 'displays' | 'viewsByDisplay'
>;

export const resolveDisplayViewSelectionWithConfigFallback = (
  selection: DisplayViewSelection,
  runtime: DisplayViewRuntime,
): DisplayViewSelection => {
  const displayViews = runtime.viewsByDisplay[selection.display] ?? [];
  const selectedView = displayViews.find((candidate) => candidate.name === selection.view);

  if (!runtime.displays.includes(selection.display) || !selectedView) {
    return {
      display: runtime.defaultDisplay,
      view: runtime.defaultView,
    };
  }

  const configuredLook = selectedView.looks?.trim() ?? '';
  if (selection.look && selection.look !== configuredLook) {
    return {
      display: selection.display,
      view: selection.view,
    };
  }

  return selection;
};
