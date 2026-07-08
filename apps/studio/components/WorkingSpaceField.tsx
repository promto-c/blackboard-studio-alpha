import React, { useMemo } from 'react';
import { Badge, StyledDropdown } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { getSceneLinearWorkingSpaceCandidates, type ColorSpaceInfo } from '@/color-management';

interface WorkingSpaceFieldProps {
  colorSpaces: ColorSpaceInfo[];
  resolvedWorkingSpace: string;
  roleName?: string;
  override?: string | null;
  onOverrideChange?: (colorSpace: string | null) => void;
}

const getDisplayName = (colorSpace: Pick<ColorSpaceInfo, 'name' | 'canonicalName'>): string =>
  colorSpace.canonicalName || colorSpace.name;

export function WorkingSpaceField({
  colorSpaces,
  resolvedWorkingSpace,
  roleName = 'scene_linear',
  override = null,
  onOverrideChange,
}: WorkingSpaceFieldProps) {
  const candidates = useMemo(
    () => getSceneLinearWorkingSpaceCandidates(colorSpaces),
    [colorSpaces],
  );
  const candidateOptions = useMemo(
    () =>
      candidates.map((colorSpace) => ({
        value: getDisplayName(colorSpace),
        label: getDisplayName(colorSpace),
        secondaryLabel: colorSpace.family || colorSpace.encoding,
        badges: [colorSpace.encoding],
        searchText: `${colorSpace.name} ${colorSpace.canonicalName ?? ''} ${colorSpace.family} ${
          colorSpace.encoding
        }`,
      })),
    [candidates],
  );
  const activeOverride = override?.trim() || null;

  return (
    <div className="min-w-0 space-y-2">
      <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icons.LockClosed className="mt-0.5 h-4 w-4 shrink-0 text-primary-300" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="min-w-0 truncate font-mono text-sm font-medium text-gray-100">
                {resolvedWorkingSpace || 'Unavailable'}
              </div>
              <Badge variant="accent" size="sm" uppercase shrink className="font-semibold">
                {roleName}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-gray-500">Resolved from project role</div>
          </div>
        </div>
      </div>

      {onOverrideChange ? (
        <details className="group min-w-0 rounded-lg border border-white/10 bg-white/[0.03]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-gray-300">
            <span>Advanced</span>
            <Icons.ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-white/10 p-3">
            {activeOverride ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <Icons.ExclamationCircle className="h-4 w-4 shrink-0" />
                <span>Working-space override active</span>
              </div>
            ) : null}

            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                {candidateOptions.length > 0 ? (
                  <StyledDropdown
                    value={activeOverride ?? resolvedWorkingSpace}
                    options={candidateOptions}
                    onChange={(value) => onOverrideChange(String(value))}
                    searchable
                    showSelectedBadges
                  />
                ) : (
                  <div className="rounded bg-gray-700/40 px-3 py-2 text-xs text-gray-400">
                    No scene-linear spaces
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOverrideChange(null)}
                disabled={!activeOverride}
                aria-label="Reset working-space override"
                title="Reset working-space override"
                className={`grid h-9 w-9 shrink-0 place-items-center rounded border transition ${
                  activeOverride
                    ? 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'
                    : 'border-white/5 bg-white/[0.02] text-gray-600'
                }`}
              >
                <Icons.Reset className="h-4 w-4" />
              </button>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
