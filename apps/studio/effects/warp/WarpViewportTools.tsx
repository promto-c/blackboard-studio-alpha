import React from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import * as Icons from '@blackboard/icons';
import { ViewportToolButton } from '@/components';

const WarpViewportTools: React.FC = () => {
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
  const { setActiveViewportTool } = useEditorActions();

  return (
    <>
      <ViewportToolButton
        label="Add Pin"
        icon={<Icons.Plus className="h-5 w-5" />}
        isActive={activeViewportTool === 'add_pin'}
        onClick={() => setActiveViewportTool('add_pin')}
      />
      <ViewportToolButton
        label="Move Pin (V)"
        icon={<Icons.CursorArrow className="h-5 w-5" />}
        isActive={activeViewportTool === 'move_pin'}
        onClick={() => setActiveViewportTool('move_pin')}
      />
    </>
  );
};

export default WarpViewportTools;
