import React, { useEffect, useState } from 'react';
import type { ComfyWorkflowControl } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { getComfyWorkflowControlRunMode, isSeedLikeComfyInput } from '../comfyControls';
import { getIntegerStepDefault, getNumericModeLabel } from '../utils/comfyControlValues';
import { IncrementRunModeIcon } from './IncrementRunModeIcon';

const RUN_MODE_BADGE_ANIMATION_MS = 520;

export const WorkflowRunModeBadge: React.FC<{
  control: ComfyWorkflowControl;
  rollToken?: number;
  onUpdate: (updates: Partial<ComfyWorkflowControl>) => void;
}> = ({ control, rollToken = 0, onUpdate }) => {
  const mode = getComfyWorkflowControlRunMode(control);
  const isFixed = mode === 'fixed';
  const shouldShow = isSeedLikeComfyInput(control.inputName) || !isFixed;
  const [isRolling, setIsRolling] = useState(false);
  const incrementStep = getIntegerStepDefault(control);
  const isIncrementMode = mode === 'increment';

  useEffect(() => {
    if (rollToken <= 0) return;
    setIsRolling(true);
  }, [rollToken]);

  useEffect(() => {
    if (!isRolling) return;
    const timeoutId = window.setTimeout(() => {
      setIsRolling(false);
    }, RUN_MODE_BADGE_ANIMATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isRolling]);

  if (!shouldShow) return null;

  return (
    <button
      type="button"
      onClick={() => onUpdate({ runMode: isFixed ? 'randomize' : 'fixed' })}
      aria-pressed={!isFixed}
      title={`${getNumericModeLabel(mode)}. Click to ${isFixed ? 'randomize on run' : 'fix value'}.`}
      aria-label={`${getNumericModeLabel(mode)}. Click to ${isFixed ? 'randomize on run' : 'fix value'}.`}
      style={
        {
          '--increment-icon-accent': 'rgb(var(--color-primary-200))',
        } as React.CSSProperties
      }
      className={`inline-flex h-5 w-5 items-center justify-center overflow-visible rounded border border-transparent focus-visible:outline-none focus-visible:ring-1 ${
        isFixed
          ? 'text-gray-500 hover:border-gray-500/70 hover:bg-white/[0.03] hover:text-gray-200 focus-visible:border-gray-500/70 focus-visible:ring-white/20'
          : 'bg-primary-300/10 text-primary-100 hover:border-primary-300/50 hover:bg-primary-300/14 focus-visible:border-primary-300/50 focus-visible:ring-primary-300/30'
      } ${
        isRolling && !isIncrementMode
          ? 'motion-safe:animate-[diceRoll_520ms_cubic-bezier(0.22,1,0.36,1)_1]'
          : ''
      }`}
    >
      {isIncrementMode ? (
        <IncrementRunModeIcon
          step={incrementStep}
          isAnimating={isRolling}
          className="h-5 w-5 scale-[1.18]"
        />
      ) : (
        <Icons.Dice className="h-5 w-5 scale-[1.35]" />
      )}
    </button>
  );
};
