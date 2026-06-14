import React from 'react';
import { AnyNode } from '@blackboard/types';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import * as Icons from '@blackboard/icons';
import { ViewportToolButton, ViewportToolsRenderer } from '@/components';
import { CloneIcon, EraserIcon } from './PaintIcons';
import type { ViewportToolEntry } from '@/nodes/NodeDefinition';

const SIMPLE_TOOLS: ViewportToolEntry[] = [
  { id: 'select', label: 'Select Tool', icon: Icons.CursorArrow, hotkey: 'Q' },
  { id: 'nudge', label: 'Nudge Tool', icon: Icons.OffsetRing, hotkey: 'W', panelId: 'nudge' },
];

type DrawingToolId = 'brush' | 'erase' | 'clone';

/**
 * Shared-panel behaviour: clicking a drawing tool activates it and opens the
 * drawing-tools panel (or closes it if the same tool was already active).
 */
const useDrawingTools = (
  openPanels: ReadonlySet<string>,
  onPanelToggle: (panel: string) => void,
) => {
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
  const { setActiveViewportTool } = useEditorActions();
  const isDrawingToolsPanelOpen = openPanels.has('drawing-tools');

  const handleDrawingToolClick = (tool: DrawingToolId) => {
    setActiveViewportTool(tool);
    if (!isDrawingToolsPanelOpen || activeViewportTool !== tool) {
      if (!isDrawingToolsPanelOpen) {
        onPanelToggle('drawing-tools');
      }
      return;
    }
    onPanelToggle('drawing-tools');
  };

  return { activeViewportTool, handleDrawingToolClick, isDrawingToolsPanelOpen };
};

function PaintViewportTools({
  node: _node,
  openPanels,
  onPanelToggle,
}: {
  node: AnyNode;
  openPanels: ReadonlySet<string>;
  onPanelToggle: (panel: string) => void;
}) {
  const { paintStrokePathsVisible, setPreferences } = usePreferences();
  const { activeViewportTool, handleDrawingToolClick, isDrawingToolsPanelOpen } = useDrawingTools(
    openPanels,
    onPanelToggle,
  );

  const drawingTools: {
    id: DrawingToolId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'brush', label: 'Brush Tool', icon: Icons.Brush },
    { id: 'erase', label: 'Erase Tool', icon: EraserIcon },
    { id: 'clone', label: 'Clone Tool', icon: CloneIcon },
  ];

  const hotkeyMap: Record<DrawingToolId, string> = { brush: 'B', erase: 'E', clone: 'C' };

  return (
    <>
      <ViewportToolsRenderer
        tools={SIMPLE_TOOLS}
        openPanels={openPanels}
        onPanelToggle={onPanelToggle}
      />

      <div className="w-full h-px bg-gray-700/50 my-1" />

      {drawingTools.map(({ id, label, icon: Icon }) => (
        <ViewportToolButton
          key={id}
          label={`${label} (${hotkeyMap[id]})`}
          icon={<Icon className="h-5 w-5" />}
          isActive={activeViewportTool === id}
          onClick={() => handleDrawingToolClick(id)}
          onSettingsClick={() => handleDrawingToolClick(id)}
          isSettingsActive={isDrawingToolsPanelOpen && activeViewportTool === id}
        />
      ))}

      <div className="w-full h-px bg-gray-700/50 my-1" />

      <ViewportToolButton
        label="Stroke Paths"
        icon={<Icons.Curve className="h-5 w-5" />}
        isActive={paintStrokePathsVisible}
        onClick={() => setPreferences({ paintStrokePathsVisible: !paintStrokePathsVisible })}
        onSettingsClick={() => onPanelToggle('stroke-paths')}
        isSettingsActive={openPanels.has('stroke-paths')}
      />
    </>
  );
}

export default PaintViewportTools;
