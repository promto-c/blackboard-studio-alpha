import * as Icons from '@blackboard/icons';
import {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
} from '@/components/SlidingSegmentedControl';

export type Scene3DViewportCameraMode = 'sceneCamera' | 'perspective';

interface ViewportCameraSelectorProps {
  value: Scene3DViewportCameraMode;
  onChange: (value: Scene3DViewportCameraMode) => void;
}

const STYLES = {
  container: 'flex items-center rounded-md border border-white/10 bg-black/20 text-xs',
  segment: 'border-0 bg-transparent',
  icon: 'h-3.5 w-3.5',
  activeWidth: 88,
  height: '100%',
  inactiveWidth: 28,
} as const;

const CAMERA_MODE_OPTIONS: SlidingSegmentedControlOption<Scene3DViewportCameraMode>[] = [
  {
    value: 'sceneCamera',
    label: 'Camera',
    Icon: Icons.Video,
    title: 'Scene Camera View',
    ariaLabel: 'Use Scene Camera View',
  },
  {
    value: 'perspective',
    label: 'Perspective',
    Icon: Icons.CursorArrow,
    title: 'Free Perspective View',
    ariaLabel: 'Use Free Perspective View',
  },
];

function ViewportCameraSelector({ value, onChange }: ViewportCameraSelectorProps) {
  return (
    <div className={STYLES.container}>
      <SlidingSegmentedControl
        options={CAMERA_MODE_OPTIONS}
        value={value}
        onChange={onChange}
        activeWidth={STYLES.activeWidth}
        height={STYLES.height}
        inactiveWidth={STYLES.inactiveWidth}
        className={STYLES.segment}
        iconClassName={STYLES.icon}
        labelMaxWidthClassName="max-w-[4.5rem]"
      />
    </div>
  );
}

export default ViewportCameraSelector;
