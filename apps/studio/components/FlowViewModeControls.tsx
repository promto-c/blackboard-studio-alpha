import * as Icons from '@blackboard/icons';
import {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
} from './SlidingSegmentedControl';
import { SegmentedControlAction, SegmentedControlSeparator } from './SegmentedControl';

export interface FlowViewModeControlsProps {
  viewMode: 'list' | 'graph';
  flowListDirection: 'bottom-up' | 'top-down';
  onSelectViewMode: (mode: 'list' | 'graph') => void;
  onToggleFlowDirection: () => void;
  onAutoArrange: () => void;
  variant?: 'pill' | 'panel';
}

const STYLES = {
  icon: 'h-3.5 w-3.5',
  activeWidth: 64,
  height: 28,
  inactiveWidth: 28,
} as const;

const VIEW_MODE_OPTIONS: SlidingSegmentedControlOption<'list' | 'graph'>[] = [
  { value: 'list', label: 'List', Icon: Icons.Bars4, title: 'List View' },
  { value: 'graph', label: 'Graph', Icon: Icons.Branch, title: 'Graph View' },
];

export function FlowViewModeControls({
  viewMode,
  flowListDirection,
  onSelectViewMode,
  onToggleFlowDirection,
  onAutoArrange,
}: FlowViewModeControlsProps) {
  return (
    <SlidingSegmentedControl
      options={VIEW_MODE_OPTIONS}
      value={viewMode}
      onChange={onSelectViewMode}
      activeWidth={STYLES.activeWidth}
      height={STYLES.height}
      inactiveWidth={STYLES.inactiveWidth}
      iconClassName={STYLES.icon}
      labelMaxWidthClassName="max-w-10"
    >
      <SegmentedControlSeparator />
      {viewMode === 'list' ? (
        <SegmentedControlAction
          onClick={onToggleFlowDirection}
          title={`Flow Direction: ${flowListDirection === 'bottom-up' ? 'Bottom to Top' : 'Top to Bottom'}`}
        >
          {flowListDirection === 'bottom-up' ? (
            <Icons.ArrowUp className={STYLES.icon} />
          ) : (
            <Icons.ArrowDown className={STYLES.icon} />
          )}
        </SegmentedControlAction>
      ) : (
        <SegmentedControlAction onClick={onAutoArrange} title="Reset Layout">
          <Icons.ArrowsPointingOut className={STYLES.icon} />
        </SegmentedControlAction>
      )}
    </SlidingSegmentedControl>
  );
}
