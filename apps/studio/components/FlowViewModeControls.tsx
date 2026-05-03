import React from 'react';
import * as Icons from '@blackboard/icons';

export interface FlowViewModeControlsProps {
  viewMode: 'list' | 'graph';
  flowListDirection: 'bottom-up' | 'top-down';
  onSelectViewMode: (mode: 'list' | 'graph') => void;
  onToggleFlowDirection: () => void;
  onAutoArrange: () => void;
  variant?: 'pill' | 'panel';
}

const VARIANT_STYLES = {
  pill: {
    container: 'flex items-center gap-1 rounded-full bg-gray-700/50 p-0.5 text-xs',
    button: 'rounded-full p-1 transition-colors',
    active: 'bg-gray-600 text-white',
    inactive: 'text-gray-400 hover:text-white',
    divider: 'mx-1 h-4 w-px bg-gray-600/50',
    icon: 'h-4 w-4',
  },
  panel: {
    container:
      'flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-0.5 text-xs',
    button: 'rounded p-1 transition-colors',
    active: 'bg-gray-700 text-white shadow-sm',
    inactive: 'text-gray-400 hover:bg-white/5 hover:text-white',
    divider: 'h-4 w-px bg-gray-600/50',
    icon: 'h-3.5 w-3.5',
  },
} as const;

const FlowViewModeControls: React.FC<FlowViewModeControlsProps> = ({
  viewMode,
  flowListDirection,
  onSelectViewMode,
  onToggleFlowDirection,
  onAutoArrange,
  variant = 'pill',
}) => {
  const styles = VARIANT_STYLES[variant];
  const getButtonClassName = (active: boolean) =>
    `${styles.button} ${active ? styles.active : styles.inactive}`;

  return (
    <div className={styles.container}>
      <button
        type="button"
        onClick={() => onSelectViewMode('list')}
        className={getButtonClassName(viewMode === 'list')}
        title="List View"
      >
        <Icons.Bars4 className={styles.icon} />
      </button>
      <button
        type="button"
        onClick={() => onSelectViewMode('graph')}
        className={getButtonClassName(viewMode === 'graph')}
        title="Graph View"
      >
        <Icons.Branch className={styles.icon} />
      </button>
      <div className={styles.divider} />
      {viewMode === 'list' ? (
        <button
          type="button"
          onClick={onToggleFlowDirection}
          className={getButtonClassName(false)}
          title={`Flow Direction: ${flowListDirection === 'bottom-up' ? 'Bottom to Top' : 'Top to Bottom'}`}
        >
          {flowListDirection === 'bottom-up' ? (
            <Icons.ArrowUp className={styles.icon} />
          ) : (
            <Icons.ArrowDown className={styles.icon} />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={onAutoArrange}
          className={getButtonClassName(false)}
          title="Reset Layout"
        >
          <Icons.ArrowsPointingOut className={styles.icon} />
        </button>
      )}
    </div>
  );
};

export default FlowViewModeControls;
