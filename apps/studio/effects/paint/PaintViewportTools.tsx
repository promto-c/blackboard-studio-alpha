import React from 'react';
import { AnyNode } from '@blackboard/types';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import * as Icons from '@blackboard/icons';
import { ViewportToolButton } from '@/components';
import { CloneIcon, EraserIcon } from './PaintIcons';

type PaintViewportToolType = 'select' | 'nudge' | 'brush' | 'erase' | 'clone';

const PaintViewportTools: React.FC<{
  node: AnyNode;
  openPanels: ReadonlySet<string>;
  onPanelToggle: (panel: string) => void;
}> = ({ node: _node, openPanels, onPanelToggle }) => {
  const activeViewportTool = useEditorSelector((state) => state.activeViewportTool);
  const { setActiveViewportTool } = useEditorActions();
  const { paintStrokePathsVisible, setPreferences } = usePreferences();
  const isDrawingToolsPanelOpen = openPanels.has('drawing-tools');
  const isStrokePathsPanelOpen = openPanels.has('stroke-paths');

  const selectTool = (tool: PaintViewportToolType) => {
    setActiveViewportTool(tool);
  };

  const handleDrawingSettingsClick = (
    tool: Extract<PaintViewportToolType, 'brush' | 'erase' | 'clone'>,
  ) => {
    setActiveViewportTool(tool);
    if (!isDrawingToolsPanelOpen || activeViewportTool !== tool) {
      if (!isDrawingToolsPanelOpen) {
        onPanelToggle('drawing-tools');
      }
      return;
    }
    onPanelToggle('drawing-tools');
  };

  return (
    <>
      <ViewportToolButton
        label="Select Tool (Q)"
        icon={<Icons.CursorArrow className="h-5 w-5" />}
        isActive={activeViewportTool === 'select'}
        onClick={() => selectTool('select')}
      />
      <ViewportToolButton
        label="Nudge Tool (W)"
        icon={<Icons.OffsetRing className="h-5 w-5" />}
        isActive={activeViewportTool === 'nudge'}
        onClick={() => selectTool('nudge')}
        onSettingsClick={() => onPanelToggle('nudge')}
      />
      <div className="w-full h-px bg-gray-700/50 my-1" />
      <ViewportToolButton
        label="Brush Tool (B)"
        icon={<Icons.Brush className="h-5 w-5" />}
        isActive={activeViewportTool === 'brush'}
        onClick={() => selectTool('brush')}
        onSettingsClick={() => handleDrawingSettingsClick('brush')}
        isSettingsActive={isDrawingToolsPanelOpen && activeViewportTool === 'brush'}
      />
      <ViewportToolButton
        label="Erase Tool (E)"
        icon={<EraserIcon className="h-5 w-5" />}
        isActive={activeViewportTool === 'erase'}
        onClick={() => selectTool('erase')}
        onSettingsClick={() => handleDrawingSettingsClick('erase')}
        isSettingsActive={isDrawingToolsPanelOpen && activeViewportTool === 'erase'}
      />
      <ViewportToolButton
        label="Clone Tool (C)"
        icon={<CloneIcon className="h-5 w-5" />}
        isActive={activeViewportTool === 'clone'}
        onClick={() => selectTool('clone')}
        onSettingsClick={() => handleDrawingSettingsClick('clone')}
        isSettingsActive={isDrawingToolsPanelOpen && activeViewportTool === 'clone'}
      />
      <div className="w-full h-px bg-gray-700/50 my-1" />
      <ViewportToolButton
        label="Stroke Paths"
        icon={<Icons.Curve className="h-5 w-5" />}
        isActive={paintStrokePathsVisible}
        onClick={() => setPreferences({ paintStrokePathsVisible: !paintStrokePathsVisible })}
        onSettingsClick={() => onPanelToggle('stroke-paths')}
        isSettingsActive={isStrokePathsPanelOpen}
      />
    </>
  );
};

export default PaintViewportTools;
