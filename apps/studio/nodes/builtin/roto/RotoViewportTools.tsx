import * as Icons from '@blackboard/icons';
import { usePreferences } from '@/state/preferencesContext';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { ViewportToolButton, ViewportToolsRenderer } from '@/components';
import type { ViewportToolEntry } from '@/nodes/NodeDefinition';

const ROTO_TOOLS: ViewportToolEntry[] = [
  { id: 'select', label: 'Select Tool', icon: Icons.CursorArrow, hotkey: 'Q' },
  { id: 'nudge', label: 'Nudge Tool', icon: Icons.OffsetRing, hotkey: 'W', panelId: 'nudge' },
  { kind: 'separator' },
  { id: 'rectangle', label: 'Rectangle Tool', icon: Icons.Rectangle, hotkey: 'R' },
  { id: 'freehand', label: 'Freehand Tool', icon: Icons.Curve, hotkey: 'F' },
  { id: 'bspline', label: 'B-spline Tool', icon: Icons.Bsline, hotkey: 'B' },
  { kind: 'separator' },
  {
    id: 'smart-mask',
    label: 'Smart Mask',
    icon: Icons.Sparkles,
    isPanel: true,
    panelId: 'segmentation',
  },
  {
    id: 'separate-parts',
    label: 'Separate Parts',
    icon: Icons.Branch,
    isPanel: true,
    panelId: 'part-separation',
  },
  {
    id: 'auto-trace',
    label: 'Auto-Trace',
    icon: Icons.ContourTrace,
    isPanel: true,
    panelId: 'trace',
  },
  {
    id: 'tracking',
    label: 'Tracking',
    icon: Icons.Play,
    hotkey: 'T',
    isPanel: true,
    panelId: 'tracking',
  },
];

function RotoViewportTools({
  openPanels,
  onPanelToggle,
}: {
  openPanels: ReadonlySet<string>;
  onPanelToggle: (panel: string) => void;
}) {
  const { rotoMotionCueEnabled, setPreferences } = usePreferences();
  const activeViewportTool = useEditorSelector((state) => state.activeViewportTool);
  const { setActiveViewportTool } = useEditorActions();

  const handlePanelToggle = (panel: string) => {
    onPanelToggle(panel);
    if (panel === 'segmentation' && !openPanels.has(panel)) {
      setActiveViewportTool('segment-point');
    } else if (
      panel === 'segmentation' &&
      openPanels.has(panel) &&
      activeViewportTool?.startsWith('segment-')
    ) {
      setActiveViewportTool('select');
    }
  };

  return (
    <>
      <ViewportToolsRenderer
        tools={ROTO_TOOLS}
        openPanels={openPanels}
        onPanelToggle={handlePanelToggle}
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
}

export default RotoViewportTools;
