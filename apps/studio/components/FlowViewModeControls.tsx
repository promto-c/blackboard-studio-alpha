import React from 'react';
import * as Icons from '@blackboard/icons';
import SlidingSegmentedControl, {
  type SlidingSegmentedControlOption,
} from './SlidingSegmentedControl';

export interface FlowViewModeControlsProps {
  viewMode: 'list' | 'graph';
  flowListDirection: 'bottom-up' | 'top-down';
  onSelectViewMode: (mode: 'list' | 'graph') => void;
  onToggleFlowDirection: () => void;
  onAutoArrange: () => void;
  variant?: 'pill' | 'panel';
}

const STYLES = {
  container: 'flex items-center rounded-md border border-white/10 bg-black/20 text-xs',
  segment: 'border-0 bg-transparent',
  actionButton:
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/5 hover:text-white',
  divider: 'h-4 w-px bg-gray-600/50',
  icon: 'h-3.5 w-3.5',
  activeWidth: 68,
  height: '100%',
  inactiveWidth: 28,
} as const;

const VIEW_MODE_OPTIONS: SlidingSegmentedControlOption<'list' | 'graph'>[] = [
  { value: 'list', label: 'List', Icon: Icons.Bars4, title: 'List View' },
  { value: 'graph', label: 'Graph', Icon: Icons.Branch, title: 'Graph View' },
];

const FlowViewModeControls: React.FC<FlowViewModeControlsProps> = ({
  viewMode,
  flowListDirection,
  onSelectViewMode,
  onToggleFlowDirection,
  onAutoArrange,
}) => {
  return (
    <div className={STYLES.container}>
      <SlidingSegmentedControl
        options={VIEW_MODE_OPTIONS}
        value={viewMode}
        onChange={onSelectViewMode}
        activeWidth={STYLES.activeWidth}
        height={STYLES.height}
        inactiveWidth={STYLES.inactiveWidth}
        className={STYLES.segment}
        iconClassName={STYLES.icon}
        labelMaxWidthClassName="max-w-10"
      />
      <div className={STYLES.divider} />
      {viewMode === 'list' ? (
        <button
          type="button"
          onClick={onToggleFlowDirection}
          className={STYLES.actionButton}
          title={`Flow Direction: ${flowListDirection === 'bottom-up' ? 'Bottom to Top' : 'Top to Bottom'}`}
        >
          {flowListDirection === 'bottom-up' ? (
            <Icons.ArrowUp className={STYLES.icon} />
          ) : (
            <Icons.ArrowDown className={STYLES.icon} />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={onAutoArrange}
          className={STYLES.actionButton}
          title="Reset Layout"
        >
          <Icons.ArrowsPointingOut className={STYLES.icon} />
        </button>
      )}
    </div>
  );
};

export default FlowViewModeControls;
