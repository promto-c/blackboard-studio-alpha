import React from 'react';
import * as Icons from '@blackboard/icons';
import {
  getMissingModelInstallDirBadge,
  getMissingModelSizeKey,
  getMissingModelSizeLabel,
  getModelSearchName,
  type MissingModelSizeStatus,
  type MissingWorkflowControlOption,
} from '../comfyMissingModels';

const MissingModelActions: React.FC<{
  missingOption: MissingWorkflowControlOption;
  onDownload: (missingOption: MissingWorkflowControlOption) => void;
  onCopyPath: (missingOption: MissingWorkflowControlOption) => void;
}> = ({ missingOption, onDownload, onCopyPath }) => {
  const downloadUrl = missingOption.downloadUrl;
  const searchName = getModelSearchName(missingOption.value);
  const actionLabel = downloadUrl ? 'Download' : 'Find';
  const ActionIcon = downloadUrl ? Icons.ArrowDownTray : Icons.MagnifyingGlass;
  const actionTitle = downloadUrl
    ? `Open download URL for ${missingOption.value}`
    : `Find ${searchName} on Hugging Face`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {downloadUrl ? (
        <div className="inline-flex overflow-hidden rounded-md border border-red-200/25 bg-black/20 text-red-50 transition hover:border-red-100/45">
          <button
            type="button"
            onClick={() => onDownload(missingOption)}
            className="inline-flex h-7 items-center gap-1.5 px-2 text-[11px] font-medium transition hover:bg-red-200/10"
            title={actionTitle}
          >
            <ActionIcon className="h-4 w-4" />
            {actionLabel}
          </button>
          <button
            type="button"
            onClick={() => onCopyPath(missingOption)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center border-l border-red-200/20 transition hover:bg-red-200/10"
            title={`Copy download URL for ${missingOption.value}`}
          >
            <Icons.Copy className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onDownload(missingOption)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-200/25 bg-black/20 px-2 text-[11px] font-medium text-red-50 transition hover:border-red-100/45 hover:bg-red-200/10"
          title={actionTitle}
        >
          <ActionIcon className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
};

const getMissingModelCountLabel = (count: number): string =>
  `${count} model${count === 1 ? '' : 's'}`;

export const MissingModelWarning: React.FC<{
  missingOptions: MissingWorkflowControlOption[];
  modelSizeStatuses: Record<string, MissingModelSizeStatus>;
  detailsVisible: boolean;
  onToggleDetails: () => void;
  onDownload: (missingOption: MissingWorkflowControlOption) => void;
  onCopyPath: (missingOption: MissingWorkflowControlOption) => void;
}> = ({
  missingOptions,
  modelSizeStatuses,
  detailsVisible,
  onToggleDetails,
  onDownload,
  onCopyPath,
}) => {
  const countLabel = getMissingModelCountLabel(missingOptions.length);
  const installTarget = missingOptions.length === 1 ? 'it' : 'them';
  const detailsAction = detailsVisible ? 'Hide details' : 'Show details';

  return (
    <div className="rounded-lg border border-red-300/25 bg-red-300/[0.07] p-2.5 text-xs text-red-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-red-50">{countLabel} missing from ComfyUI</p>
          <p className="mt-0.5 text-[11px] leading-4 text-red-100/75">
            Install {installTarget}, or choose available values before running.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleDetails}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-red-200/20 bg-black/15 px-2 text-[11px] font-medium text-red-50 transition hover:border-red-100/45 hover:bg-red-200/10"
          aria-expanded={detailsVisible}
          aria-label={detailsAction}
          title={detailsAction}
        >
          {detailsVisible ? (
            <Icons.ChevronDown className="h-3 w-3" />
          ) : (
            <Icons.ChevronRight className="h-3 w-3" />
          )}
          {detailsVisible ? 'Hide' : 'Show'}
        </button>
      </div>
      {detailsVisible ? (
        <div className="mt-2 divide-y divide-red-100/10 overflow-hidden rounded-md border border-red-100/10 bg-black/15">
          {missingOptions.map((missingOption) => {
            const dirBadge = getMissingModelInstallDirBadge(missingOption);
            const sizeLabel = missingOption.downloadUrl
              ? getMissingModelSizeLabel(modelSizeStatuses[getMissingModelSizeKey(missingOption)])
              : null;

            return (
              <div
                key={missingOption.control.id}
                className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-[11px] font-medium text-red-50">
                      {missingOption.control.label}
                    </p>
                    {dirBadge ? (
                      <span className="shrink-0 rounded-md border border-red-200/20 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-red-100/70">
                        {dirBadge}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-red-100/70">
                      {missingOption.value}
                    </span>
                    {sizeLabel ? (
                      <span className="shrink-0 text-[10px] font-medium text-red-100/45">
                        {sizeLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
                <MissingModelActions
                  missingOption={missingOption}
                  onDownload={onDownload}
                  onCopyPath={onCopyPath}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
