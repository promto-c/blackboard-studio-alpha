import React, { useEffect, useState } from 'react';
import type { ComfyWorkflowControl } from '@blackboard/types';
import { Popover } from '@/components';
import * as Icons from '@blackboard/icons';
import { getComfyWorkflowControlRunMode } from '../comfyControls';
import {
  getIntegerRangeDefaults,
  getIntegerStepDefault,
  getNumericModeLabel,
  getNumericModeSelectorValue,
  parseFiniteIntegerInput,
} from '../utils/comfyControlValues';

interface WorkflowRunModeControlProps {
  control: ComfyWorkflowControl;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (updates: Partial<ComfyWorkflowControl>) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

export const WorkflowRunModeControl: React.FC<WorkflowRunModeControlProps> = ({
  control,
  isOpen,
  onOpenChange,
  onUpdate,
  onKeyDown,
}) => {
  const mode = getComfyWorkflowControlRunMode(control);
  const selectedMode = getNumericModeSelectorValue(mode);
  const rangeDefaults = getIntegerRangeDefaults(control);
  const incrementStep = getIntegerStepDefault(control);
  const [randomMinDraft, setRandomMinDraft] = useState(
    control.randomMin === undefined ? '' : String(control.randomMin),
  );
  const [randomMaxDraft, setRandomMaxDraft] = useState(
    control.randomMax === undefined ? '' : String(control.randomMax),
  );
  const [incrementDraft, setIncrementDraft] = useState(String(incrementStep));

  useEffect(() => {
    setRandomMinDraft(control.randomMin === undefined ? '' : String(control.randomMin));
  }, [control.randomMin]);

  useEffect(() => {
    setRandomMaxDraft(control.randomMax === undefined ? '' : String(control.randomMax));
  }, [control.randomMax]);

  useEffect(() => {
    setIncrementDraft(String(incrementStep));
  }, [incrementStep]);

  const setMode = (nextMode: 'fixed' | 'randomize' | 'increment') => {
    onUpdate({
      runMode: nextMode,
      incrementStep: nextMode === 'increment' ? incrementStep : control.incrementStep,
    });
  };

  const commitRandomBound = (field: 'randomMin' | 'randomMax', draft: string): boolean => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onUpdate({
        runMode: 'randomize',
        [field]: undefined,
      });
      return true;
    }

    const parsed = parseFiniteIntegerInput(trimmed);
    if (parsed === null) return false;

    onUpdate({
      runMode: 'randomize',
      [field]: parsed,
    });
    return true;
  };

  const commitIncrementStep = (draft: string): boolean => {
    const parsed = parseFiniteIntegerInput(draft.trim());
    if (parsed === null) return false;

    onUpdate({
      runMode: 'increment',
      incrementStep: parsed,
    });
    return true;
  };

  const handleDraftKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    resetDraft: () => void,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      resetDraft();
      event.currentTarget.blur();
    }
  };

  const modeItemClass = (candidate: 'fixed' | 'randomize' | 'increment') =>
    `rounded-md border px-2 py-1.5 transition ${
      selectedMode === candidate
        ? 'border-primary-300/25 bg-primary-300/10 text-primary-50'
        : 'border-transparent text-gray-300 hover:border-white/10 hover:bg-white/[0.04] hover:text-white'
    }`;

  const inlineInputClass =
    'h-6 w-full rounded-md border border-white/10 bg-black/30 px-2 text-right text-[11px] text-gray-100 outline-none transition placeholder:text-gray-500 focus:border-primary-300/60 focus:bg-gray-950';

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      align="end"
      widthClass="w-56"
      trigger={
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 transition hover:bg-white/[0.06] hover:text-gray-100"
          title="Run behavior"
          aria-label="Run behavior"
        >
          <Icons.EllipsisVertical className="h-4 w-4" />
        </button>
      }
    >
      <div className="space-y-1" onKeyDown={onKeyDown}>
        <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
          Run Behavior
        </p>
        <div className="space-y-1">
          {(['fixed', 'randomize', 'increment'] as const).map((candidate) => (
            <div key={candidate} className={modeItemClass(candidate)}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMode(candidate)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-[11px]"
                >
                  <span className="truncate">{getNumericModeLabel(candidate)}</span>
                </button>
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {selectedMode === candidate && <Icons.Check className="h-3.5 w-3.5" />}
                </span>
              </div>

              {candidate === 'randomize' && selectedMode === candidate && (
                <div className="mt-1 grid grid-cols-2 gap-1.5 pl-0">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={randomMinDraft}
                    placeholder="Min"
                    aria-label="Random minimum"
                    title={`Leave blank to use the detected minimum (${rangeDefaults.min}).`}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                      setMode('randomize');
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      const nextDraft = event.currentTarget.value;
                      setRandomMinDraft(nextDraft);
                      if (nextDraft.trim() === '' || parseFiniteIntegerInput(nextDraft) !== null) {
                        commitRandomBound('randomMin', nextDraft);
                      }
                    }}
                    onBlur={() => {
                      if (commitRandomBound('randomMin', randomMinDraft)) return;
                      setRandomMinDraft(
                        control.randomMin === undefined ? '' : String(control.randomMin),
                      );
                    }}
                    onKeyDown={(event) =>
                      handleDraftKeyDown(event, () =>
                        setRandomMinDraft(
                          control.randomMin === undefined ? '' : String(control.randomMin),
                        ),
                      )
                    }
                    className={inlineInputClass}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={randomMaxDraft}
                    placeholder="Max"
                    aria-label="Random maximum"
                    title={`Leave blank to use the detected maximum (${rangeDefaults.max}).`}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                      setMode('randomize');
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      const nextDraft = event.currentTarget.value;
                      setRandomMaxDraft(nextDraft);
                      if (nextDraft.trim() === '' || parseFiniteIntegerInput(nextDraft) !== null) {
                        commitRandomBound('randomMax', nextDraft);
                      }
                    }}
                    onBlur={() => {
                      if (commitRandomBound('randomMax', randomMaxDraft)) return;
                      setRandomMaxDraft(
                        control.randomMax === undefined ? '' : String(control.randomMax),
                      );
                    }}
                    onKeyDown={(event) =>
                      handleDraftKeyDown(event, () =>
                        setRandomMaxDraft(
                          control.randomMax === undefined ? '' : String(control.randomMax),
                        ),
                      )
                    }
                    className={inlineInputClass}
                  />
                </div>
              )}

              {candidate === 'increment' && selectedMode === candidate && (
                <div className="mt-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={incrementDraft}
                    placeholder="Step"
                    aria-label="Increment amount"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                      setMode('increment');
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      const nextDraft = event.currentTarget.value;
                      setIncrementDraft(nextDraft);
                      if (nextDraft.trim() !== '' && parseFiniteIntegerInput(nextDraft) !== null) {
                        commitIncrementStep(nextDraft);
                      }
                    }}
                    onBlur={() => {
                      if (commitIncrementStep(incrementDraft)) return;
                      setIncrementDraft(String(incrementStep));
                    }}
                    onKeyDown={(event) =>
                      handleDraftKeyDown(event, () => setIncrementDraft(String(incrementStep)))
                    }
                    className={inlineInputClass}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Popover>
  );
};
