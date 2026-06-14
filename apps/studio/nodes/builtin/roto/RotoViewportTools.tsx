import * as Icons from '@blackboard/icons';
import { usePreferences } from '@/state/preferencesContext';
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
  { id: 'auto-trace', label: 'Auto-Trace', icon: Icons.Sparkles, isPanel: true, panelId: 'trace' },
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

  return (
    <>
      <ViewportToolsRenderer
        tools={ROTO_TOOLS}
        openPanels={openPanels}
        onPanelToggle={onPanelToggle}
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
