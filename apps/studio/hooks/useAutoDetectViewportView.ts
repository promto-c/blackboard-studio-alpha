import { useEffect, useRef, useCallback } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { useOcio } from '@/state/ocioContext';
import { getAutoDetectedView } from '@/color-management';

/**
 * Watches the project node list and the auto-detect preference to
 * automatically set the viewport display/view based on the first input
 * source's color space.
 *
 * When auto-detect is disabled, clears any previously set auto-detected
 * view so the project default is used.
 */
export function useAutoDetectViewportView(): void {
  const nodes = useEditorSelector((state) => state.nodes);
  const { autoDetectViewportView } = usePreferences();
  const { setAutoDetectView } = useEditorActions();
  const ocio = useOcio();
  const prevRef = useRef<{ view: string | null; enabled: boolean }>({
    view: null,
    enabled: false,
  });
  const defaultDisplay = ocio.defaultDisplay;
  const getViews = useCallback((display: string) => ocio.getViews(display), [ocio.getViews]);

  useEffect(() => {
    if (!autoDetectViewportView) {
      // Clear any previously set auto-detected view
      if (prevRef.current.enabled || prevRef.current.view !== null) {
        setAutoDetectView(null);
        prevRef.current = { view: null, enabled: false };
      }
      return;
    }

    const detected = getAutoDetectedView(nodes, defaultDisplay, getViews);

    const detectedView = detected ? `${detected.display}/${detected.view}` : null;
    const prevView = prevRef.current.view;

    if (detectedView !== prevView || !prevRef.current.enabled) {
      setAutoDetectView(detected);
      prevRef.current = { view: detectedView, enabled: true };
    }
  }, [autoDetectViewportView, nodes, defaultDisplay, getViews, setAutoDetectView]);
}
