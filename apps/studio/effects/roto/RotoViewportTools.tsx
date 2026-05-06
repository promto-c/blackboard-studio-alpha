import React from 'react';
import { AnyNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';

import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { ViewportToolButton } from '@/components';

type RotoToolType = 'select' | 'rectangle' | 'bspline' | 'freehand' | 'nudge';

const RotoViewportTools: React.FC<{
  node: AnyNode;
  openPanels: ReadonlySet<string>;
  onPanelToggle: (panel: string) => void;
}> = ({ node: _node, openPanels, onPanelToggle }) => {
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
  const { setActiveViewportTool } = useEditorActions();
  const { rotoMotionCueEnabled, setPreferences } = usePreferences();

  const handleToolSelect = (tool: RotoToolType) => {
    setActiveViewportTool(tool);
  };

  return (
    <>
      <ViewportToolButton
        label="Select Tool (Q)"
        icon={<Icons.CursorArrow className="h-5 w-5" />}
        isActive={activeViewportTool === 'select'}
        onClick={() => handleToolSelect('select')}
      />
      <ViewportToolButton
        label="Nudge Tool (W)"
        icon={<Icons.OffsetRing className="h-5 w-5" />}
        isActive={activeViewportTool === 'nudge'}
        onClick={() => handleToolSelect('nudge')}
        onSettingsClick={() => onPanelToggle('nudge')}
        isSettingsActive={openPanels.has('nudge')}
      />

      <div className="w-full h-px bg-gray-700/50 my-1"></div>

      <ViewportToolButton
        label="Rectangle Tool (R)"
        icon={<Icons.Rectangle className="h-5 w-5" />}
        isActive={activeViewportTool === 'rectangle'}
        onClick={() => handleToolSelect('rectangle')}
      />
      <ViewportToolButton
        label="Freehand Tool (F)"
        icon={<Icons.Curve className="h-5 w-5" />}
        isActive={activeViewportTool === 'freehand'}
        onClick={() => handleToolSelect('freehand')}
      />
      <ViewportToolButton
        label="B-spline Tool (B)"
        icon={<Icons.Bsline className="h-5 w-5" />}
        isActive={activeViewportTool === 'bspline'}
        onClick={() => handleToolSelect('bspline')}
      />

      <div className="w-full h-px bg-gray-700/50 my-1"></div>

      <ViewportToolButton
        label="Auto-Trace"
        icon={<Icons.Sparkles className="h-5 w-5" />}
        isActive={openPanels.has('trace')}
        onClick={() => onPanelToggle('trace')}
      />
      <ViewportToolButton
        label="Tracking (T)"
        icon={<Icons.Play className="h-5 w-5" />}
        isActive={openPanels.has('tracking')}
        onClick={() => onPanelToggle('tracking')}
      />
      <ViewportToolButton
        label="Motion Cue"
        icon={<Icons.Bundle className="h-5 w-5" />}
        isActive={rotoMotionCueEnabled}
        onClick={() => setPreferences({ rotoMotionCueEnabled: !rotoMotionCueEnabled })}
        onSettingsClick={() => onPanelToggle('motion-cue')}
        isSettingsActive={openPanels.has('motion-cue')}
      />
    </>
  );
};

export default RotoViewportTools;
