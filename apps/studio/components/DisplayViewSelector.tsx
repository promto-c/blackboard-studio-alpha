import { useMemo } from 'react';
import type { DisplayViewSelection } from '@blackboard/types';
import { StyledDropdown } from '@blackboard/ui';
import { useOcio } from '@/state/ocioContext';
import type { ColorManagementRuntimeSnapshot } from '@/color-management';
import { ColorManagementControlRow } from './ColorManagementControls';
import { InlineOptionList } from './InlineOptionList';

type DisplayViewSelectorRuntime = Pick<
  ColorManagementRuntimeSnapshot,
  'defaultDisplay' | 'defaultView' | 'defaultViewsByDisplay' | 'displays' | 'viewsByDisplay'
>;

export interface DisplayViewSelectorProps {
  value: DisplayViewSelection;
  onChange: (value: DisplayViewSelection) => void;
  runtime?: DisplayViewSelectorRuntime | null;
  disabled?: boolean;
  controlWidthClass?: string;
  popoverWidthClass?: string;
  variant?: 'dropdown' | 'inline-list' | 'control-rows';
}

export interface DisplayViewSelectorModel {
  displays: string[];
  views: Array<{ name: string; detail?: string }>;
  looks: string[];
  issue: string | null;
}

export const getDisplayViewSelectorModel = (
  displays: string[],
  viewsByDisplay: Record<
    string,
    Array<{ name: string; transform?: string; colorSpace?: string; looks?: string }>
  >,
  value: DisplayViewSelection,
): DisplayViewSelectorModel => {
  const views = (viewsByDisplay[value.display] ?? []).map((view) => ({
    name: view.name,
    detail: view.transform || view.colorSpace || undefined,
  }));
  const selectedView = (viewsByDisplay[value.display] ?? []).find(
    (view) => view.name === value.view,
  );
  const configuredLook = selectedView?.looks?.trim();
  const issue = !displays.includes(value.display)
    ? `Display "${value.display}" is not available in the active OCIO config.`
    : !selectedView
      ? `View "${value.view}" is not available for display "${value.display}".`
      : value.look && value.look !== configuredLook
        ? `Look "${value.look}" is not configured for this display/view.`
        : null;

  return {
    displays,
    views,
    looks: configuredLook ? [configuredLook] : [],
    issue,
  };
};

export function DisplayViewSelector({
  value,
  onChange,
  runtime,
  disabled = false,
  controlWidthClass = 'w-full',
  popoverWidthClass = 'w-80',
  variant = 'dropdown',
}: DisplayViewSelectorProps) {
  const ocio = useOcio();
  const resolvedRuntime = runtime === undefined ? ocio : runtime;
  const model = useMemo(
    () =>
      getDisplayViewSelectorModel(
        resolvedRuntime?.displays ?? [],
        resolvedRuntime?.viewsByDisplay ?? {},
        value,
      ),
    [resolvedRuntime?.displays, resolvedRuntime?.viewsByDisplay, value],
  );
  const displayOptions = model.displays.map((display) => ({ value: display, label: display }));
  const viewOptions = model.views.map((view) => ({
    value: view.name,
    label: view.name,
    secondaryLabel: view.detail,
  }));
  const lookOptions = [
    { value: '', label: 'None' },
    ...model.looks.map((look) => ({ value: look, label: look })),
  ];
  const defaultDisplay = resolvedRuntime?.defaultDisplay || model.displays[0] || value.display;
  const getDefaultView = (display: string) =>
    resolvedRuntime?.defaultViewsByDisplay[display] ||
    resolvedRuntime?.viewsByDisplay[display]?.[0]?.name ||
    resolvedRuntime?.defaultView ||
    value.view;
  const defaultView = getDefaultView(value.display);

  if (variant === 'inline-list') {
    return (
      <div className={`space-y-4 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
        <InlineOptionList
          label="Display"
          value={value.display}
          options={displayOptions}
          onChange={(display) =>
            onChange({
              display,
              view: getDefaultView(display),
            })
          }
          disabled={disabled}
        />
        <InlineOptionList
          label="View"
          value={value.view}
          options={viewOptions}
          onChange={(view) =>
            onChange({
              display: value.display,
              view,
            })
          }
          disabled={disabled}
        />
        {model.issue ? (
          <div className="mx-3 rounded border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100">
            {model.issue}
          </div>
        ) : null}
      </div>
    );
  }

  if (variant === 'control-rows') {
    return (
      <div className={disabled ? 'pointer-events-none opacity-60' : ''}>
        <div className="space-y-2">
          <ColorManagementControlRow
            label="Display"
            onReset={() =>
              onChange({
                display: defaultDisplay,
                view: getDefaultView(defaultDisplay),
              })
            }
            resetDisabled={value.display === defaultDisplay}
          >
            <StyledDropdown
              value={value.display}
              options={displayOptions}
              onChange={(nextValue) => {
                const display = String(nextValue);
                onChange({
                  display,
                  view: getDefaultView(display),
                });
              }}
              widthClass={controlWidthClass}
              popoverWidthClass={popoverWidthClass}
            />
          </ColorManagementControlRow>

          <ColorManagementControlRow
            label="View"
            onReset={() =>
              onChange({
                display: value.display,
                view: defaultView,
              })
            }
            resetDisabled={value.view === defaultView}
          >
            <StyledDropdown
              value={value.view}
              options={viewOptions}
              onChange={(nextValue) =>
                onChange({
                  display: value.display,
                  view: String(nextValue),
                })
              }
              widthClass={controlWidthClass}
              popoverWidthClass={popoverWidthClass}
            />
          </ColorManagementControlRow>

          <ColorManagementControlRow
            label="Look"
            onReset={() =>
              onChange({
                display: value.display,
                view: value.view,
              })
            }
            resetDisabled={!value.look}
          >
            <StyledDropdown
              value={value.look ?? ''}
              options={lookOptions}
              onChange={(nextValue) => {
                const look = String(nextValue).trim();
                onChange({
                  display: value.display,
                  view: value.view,
                  ...(look ? { look } : {}),
                });
              }}
              widthClass={controlWidthClass}
              popoverWidthClass={popoverWidthClass}
            />
          </ColorManagementControlRow>
        </div>
        {model.issue ? (
          <div className="mt-2 rounded border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100">
            {model.issue}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-400">Display</label>
        <StyledDropdown
          value={value.display}
          options={displayOptions}
          onChange={(nextValue) => {
            const display = String(nextValue);
            onChange({
              display,
              view: getDefaultView(display),
            });
          }}
          widthClass={controlWidthClass}
          popoverWidthClass={popoverWidthClass}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-400">View</label>
        <StyledDropdown
          value={value.view}
          options={viewOptions}
          onChange={(nextValue) =>
            onChange({
              display: value.display,
              view: String(nextValue),
            })
          }
          widthClass={controlWidthClass}
          popoverWidthClass={popoverWidthClass}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-400">Look</label>
        <StyledDropdown
          value={value.look ?? ''}
          options={lookOptions}
          onChange={(nextValue) => {
            const look = String(nextValue).trim();
            onChange({
              display: value.display,
              view: value.view,
              ...(look ? { look } : {}),
            });
          }}
          widthClass={controlWidthClass}
          popoverWidthClass={popoverWidthClass}
        />
      </div>
      {model.issue ? (
        <div className="rounded border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100">
          {model.issue}
        </div>
      ) : null}
    </div>
  );
}
