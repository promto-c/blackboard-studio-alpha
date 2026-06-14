import type { Scene3DNode, SceneViewportMode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { useEditorActions } from '@/state/editorContext';
import {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
} from '@/components/SlidingSegmentedControl';

interface ViewportModeSwitchProps {
  scene3DNode: Scene3DNode;
}

const STYLES = {
  container: 'flex items-center rounded-md border border-white/10 bg-black/20 text-xs',
  segment: 'border-0 bg-transparent',
  icon: 'h-3.5 w-3.5',
  activeWidth: 48,
  height: '100%',
  inactiveWidth: 28,
} as const;

const VIEWPORT_MODE_OPTIONS: SlidingSegmentedControlOption<SceneViewportMode>[] = [
  { value: 'canvas2d', label: '2D', Icon: Icons.Rectangle, title: '2D Canvas (V)' },
  { value: 'scene3d', label: '3D', Icon: Icons.CubeTransparent, title: '3D Scene (V)' },
];

function ViewportModeSwitch({ scene3DNode }: ViewportModeSwitchProps) {
  const { updateNode } = useEditorActions();
  const activeMode = scene3DNode.viewportMode ?? 'scene3d';

  const setMode = (mode: SceneViewportMode) => {
    if (mode === activeMode) return;
    updateNode(scene3DNode.id, { viewportMode: mode }, false);
  };

  return (
    <div className={STYLES.container}>
      <SlidingSegmentedControl
        options={VIEWPORT_MODE_OPTIONS}
        value={activeMode}
        onChange={setMode}
        activeWidth={STYLES.activeWidth}
        height={STYLES.height}
        inactiveWidth={STYLES.inactiveWidth}
        className={STYLES.segment}
        iconClassName={STYLES.icon}
        labelMaxWidthClassName="max-w-8"
      />
    </div>
  );
}

export default ViewportModeSwitch;
