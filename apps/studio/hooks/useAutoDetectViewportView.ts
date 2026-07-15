import { useEffect, useMemo, useRef } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { useOcio } from '@/state/ocioContext';
import { getAutoDetectedView } from '@/color-management';
import { getOutputRenderNodes } from '@/utils/viewerSlots';

/**
 * Watches the canonical output graph and the auto-detect preference to set
 * the viewport display/view from the first connected source's color space.
 *
 * When auto-detect is disabled, clears any previously set auto-detected
 * view so the project default is used.
 */
export function useAutoDetectViewportView(): void {
  const nodes = useEditorSelector((state) => state.nodes);
  const activeFlow = useEditorSelector((state) => {
    const flowId = state.activeFlowId ?? state.rootFlowId;
    return flowId ? state.flows[flowId] : null;
  });
  const { autoDetectViewportView } = usePreferences();
  const { setAutoDetectView } = useEditorActions();
  const ocio = useOcio();
  const prevRef = useRef<{ view: string | null; enabled: boolean }>({
    view: null,
    enabled: false,
  });
  const defaultDisplay = ocio.defaultDisplay;
  const getViews = ocio.getViews;
  const outputNodes = useMemo(() => getOutputRenderNodes(nodes, activeFlow), [activeFlow, nodes]);

  useEffect(() => {
    if (!autoDetectViewportView) {
      // Clear any previously set auto-detected view
      if (prevRef.current.enabled || prevRef.current.view !== null) {
        setAutoDetectView(null);
        prevRef.current = { view: null, enabled: false };
      }
      return;
    }

    const detected = getAutoDetectedView(outputNodes, defaultDisplay, getViews);

    const detectedView = detected ? `${detected.display}/${detected.view}` : null;
    const prevView = prevRef.current.view;

    if (detectedView !== prevView || !prevRef.current.enabled) {
      setAutoDetectView(detected);
      prevRef.current = { view: detectedView, enabled: true };
    }
  }, [autoDetectViewportView, defaultDisplay, getViews, outputNodes, setAutoDetectView]);
}
