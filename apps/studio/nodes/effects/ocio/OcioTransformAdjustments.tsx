import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  NodeType,
  OCIO_COMPOSITING_LOG_SPACE,
  OCIO_PROJECT_WORKING_SPACE,
  OCIO_TEXTURE_COLOR_SPACE,
  type AnyNode,
  type OcioColorSpaceTransformNode,
  type OcioFileTransformInterpolation,
  type OcioFileTransformNode,
  type OcioLookTransformNode,
  type OcioNamedTransformNode,
  type OcioTransformColorSpace,
  type OcioTransformDirection,
} from '@blackboard/types';
import { CollapsibleSection, StyledDropdown, TextInput } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { OcioColorSpaceDropdown } from '@/components/OcioColorSpaceDropdown';
import { SegmentedControl, SettingRow } from '@/components';
import { colorManagementService } from '@/color-management';
import { useOcio } from '@/state/ocioContext';
import { saveAsset } from '@/state/assetStorage';
import { useEditorActions } from '@/state/editorContext';
import {
  getFileTransformColorSpaces,
  getOcioColorSpaceProcessingDomain,
  getOcioRoleLabel,
} from './ocioTransformModel';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <SettingRow
      label={label}
      labelAccessory={hint ? <span className="text-[9px] text-gray-600">{hint}</span> : null}
    >
      {children}
    </SettingRow>
  );
}

function DirectionField({
  value,
  onChange,
  inverseHint,
}: {
  value: OcioTransformDirection;
  onChange: (value: OcioTransformDirection) => void;
  inverseHint?: string;
}) {
  return (
    <Field label="Direction" hint={value === 'inverse' ? inverseHint : undefined}>
      <SegmentedControl
        ariaLabel="Transform direction"
        value={value}
        options={[
          { value: 'forward', label: 'Forward' },
          { value: 'inverse', label: 'Inverse' },
        ]}
        onChange={(nextValue) => onChange(nextValue as OcioTransformDirection)}
      />
    </Field>
  );
}

function getResolvedColorSpaceLabel(
  value: OcioTransformColorSpace,
  ocio: ReturnType<typeof useOcio>,
): string {
  if (value === OCIO_PROJECT_WORKING_SPACE) return ocio.workingColorSpace;
  if (value === OCIO_TEXTURE_COLOR_SPACE) return ocio.textureColorSpace;
  if (value === OCIO_COMPOSITING_LOG_SPACE) return ocio.logColorSpace ?? 'Unavailable';
  return value;
}

function TransformPath({ segments }: { segments: Array<{ label: string; accent?: boolean }> }) {
  return (
    <div className="rounded-lg border border-cyan-300/10 bg-cyan-400/[0.04] px-2.5 py-2">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-200/60">
        Processing path
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[10px] leading-5">
        {segments.map((segment, index) => (
          <span key={`${segment.label}-${index}`} className="contents">
            {index > 0 ? <span className="text-gray-600">→</span> : null}
            <span className={segment.accent ? 'font-medium text-cyan-100' : 'text-gray-300'}>
              {segment.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SelectionIssue({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-300/15 bg-amber-400/[0.06] px-2.5 py-2 text-[10px] leading-4 text-amber-100/80">
      {children}
    </div>
  );
}

function OcioColorSpaceTransformAdjustments({ node }: { node: OcioColorSpaceTransformNode }) {
  const ocio = useOcio();
  const { updateNode } = useEditorActions();
  const sourceLabel = getResolvedColorSpaceLabel(node.sourceColorSpace, ocio);
  const destinationLabel = getResolvedColorSpaceLabel(node.destinationColorSpace, ocio);
  const sourceRoleLabel = getOcioRoleLabel(node.sourceColorSpace);
  const destinationRoleLabel = getOcioRoleLabel(node.destinationColorSpace);
  const outputDomain = getOcioColorSpaceProcessingDomain(node.destinationColorSpace, ocio);
  const isIdentity = sourceLabel === destinationLabel;

  const swapColorSpaces = () =>
    updateNode(
      node.id,
      {
        sourceColorSpace: node.destinationColorSpace,
        destinationColorSpace: node.sourceColorSpace,
      },
      true,
    );

  return (
    <>
      <CollapsibleSection title="Transform" defaultOpen>
        <div className="space-y-4">
          <TransformPath
            segments={[
              {
                label: sourceRoleLabel ? `${sourceRoleLabel} · ${sourceLabel}` : sourceLabel,
              },
              {
                label: destinationRoleLabel
                  ? `${destinationRoleLabel} · ${destinationLabel}`
                  : destinationLabel,
                accent: true,
              },
            ]}
          />
          <Field label="Source" hint="How upstream RGB is encoded">
            <OcioColorSpaceDropdown
              value={node.sourceColorSpace}
              includeData={false}
              includeRoles
              onChange={(sourceColorSpace) => updateNode(node.id, { sourceColorSpace }, true)}
            />
          </Field>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={swapColorSpaces}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] text-gray-400 transition hover:border-cyan-300/25 hover:bg-cyan-400/[0.06] hover:text-cyan-100"
              title="Swap source and destination color spaces"
            >
              <Icons.ArrowsRightLeft className="h-3.5 w-3.5" />
              Swap
            </button>
          </div>
          <Field label="Destination" hint="Encoding produced by this node">
            <OcioColorSpaceDropdown
              value={node.destinationColorSpace}
              includeData={false}
              includeRoles
              onChange={(destinationColorSpace) =>
                updateNode(node.id, { destinationColorSpace }, true)
              }
            />
          </Field>
          {isIdentity ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.025] px-2.5 py-2 text-[10px] leading-4 text-gray-400">
              Source and destination resolve to the same color space, so this node is currently a
              pass-through.
            </div>
          ) : outputDomain === 'scene_linear' ? (
            <div className="rounded-lg border border-emerald-300/15 bg-emerald-400/[0.05] px-2.5 py-2 text-[10px] leading-4 text-emerald-100/75">
              Scene-linear output · safe for normal compositing and grading.
            </div>
          ) : (
            <SelectionIssue>
              {outputDomain === 'log' ? 'Log-encoded' : 'Display/nonlinear'} output. Add another
              Color Space Transform back to Project Working before scene-linear effects or final
              compositing.
            </SelectionIssue>
          )}
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="About" defaultOpen={false}>
        <p className="text-[10px] leading-5 text-gray-500">
          Converts RGB between any two color spaces in the active OCIO config. Project-role choices
          remain portable when the config changes. Alpha, negative values, and HDR values are
          preserved.
        </p>
      </CollapsibleSection>
    </>
  );
}

function OcioNamedTransformAdjustments({ node }: { node: OcioNamedTransformNode }) {
  const ocio = useOcio();
  const { updateNode } = useEditorActions();
  const selected = ocio.namedTransforms.find(
    (candidate) =>
      candidate.name === node.namedTransform || candidate.aliases.includes(node.namedTransform),
  );
  const options = useMemo(
    () =>
      ocio.namedTransforms.map((transform) => ({
        value: transform.name,
        label: transform.name,
        secondaryLabel: transform.description || transform.family || transform.encoding,
        badges: [transform.family, transform.encoding].filter(Boolean),
        searchText: [
          transform.name,
          transform.family,
          transform.encoding,
          transform.description,
          ...transform.aliases,
          ...transform.categories,
        ].join(' '),
      })),
    [ocio.namedTransforms],
  );
  const processSpace = getResolvedColorSpaceLabel(node.processColorSpace, ocio);

  return (
    <>
      <CollapsibleSection title="Transform" defaultOpen>
        <div className="space-y-4">
          <TransformPath
            segments={[
              { label: ocio.workingColorSpace },
              { label: processSpace },
              { label: node.namedTransform || 'Choose transform', accent: true },
              { label: ocio.workingColorSpace },
            ]}
          />
          <Field label="Named Transform">
            <StyledDropdown
              value={node.namedTransform}
              options={options}
              onChange={(value) => updateNode(node.id, { namedTransform: String(value) }, true)}
              searchable
              popoverWidthClass="w-96"
            />
          </Field>
          {!node.namedTransform ? (
            <SelectionIssue>Select a transform from the active OCIO config.</SelectionIssue>
          ) : !selected ? (
            <SelectionIssue>
              “{node.namedTransform}” is not available in the active OCIO config.
            </SelectionIssue>
          ) : null}
          <DirectionField
            value={node.direction}
            inverseHint={
              selected && !selected.hasInverseTransform ? 'Inverse synthesized by OCIO' : undefined
            }
            onChange={(direction) => updateNode(node.id, { direction }, true)}
          />
          <Field label="Process Color Space" hint="Converted back after the transform">
            <OcioColorSpaceDropdown
              value={node.processColorSpace}
              includeData={false}
              includeRoles
              onChange={(processColorSpace) => updateNode(node.id, { processColorSpace }, true)}
            />
          </Field>
          {selected?.description ? (
            <p className="text-[10px] leading-5 text-gray-500">{selected.description}</p>
          ) : null}
        </div>
      </CollapsibleSection>
    </>
  );
}

function OcioLookTransformAdjustments({ node }: { node: OcioLookTransformNode }) {
  const ocio = useOcio();
  const { updateNode } = useEditorActions();
  const selected = ocio.looks.find((look) => look.name === node.looks);
  const options = useMemo(
    () =>
      ocio.looks.map((look) => ({
        value: look.name,
        label: look.name,
        secondaryLabel: look.description || `Process space: ${look.processSpace}`,
        badges: [look.processSpace],
        searchText: `${look.name} ${look.processSpace} ${look.description}`,
      })),
    [ocio.looks],
  );

  return (
    <CollapsibleSection title="Look" defaultOpen>
      <div className="space-y-4">
        <TransformPath
          segments={[
            { label: ocio.workingColorSpace },
            { label: node.looks || 'Choose look', accent: true },
            { label: ocio.workingColorSpace },
          ]}
        />
        <Field label="Look">
          <StyledDropdown
            value={node.looks}
            options={options}
            onChange={(value) => updateNode(node.id, { looks: String(value) }, true)}
            searchable
            popoverWidthClass="w-96"
          />
        </Field>
        {!node.looks ? (
          <SelectionIssue>Select a look from the active OCIO config.</SelectionIssue>
        ) : !selected ? (
          <SelectionIssue>
            “{node.looks}” is not available in the active OCIO config.
          </SelectionIssue>
        ) : null}
        <DirectionField
          value={node.direction}
          inverseHint={
            selected && !selected.hasInverseTransform ? 'Inverse synthesized by OCIO' : undefined
          }
          onChange={(direction) => updateNode(node.id, { direction }, true)}
        />
        {selected ? (
          <div className="rounded-lg border border-white/5 bg-black/10 px-2.5 py-2 text-[10px] text-gray-500">
            Process space: <span className="text-gray-300">{selected.processSpace}</span>
            {selected.description ? (
              <div className="mt-1 leading-4">{selected.description}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}

function OcioFileTransformAdjustments({ node }: { node: OcioFileTransformNode }) {
  const ocio = useOcio();
  const { updateNode } = useEditorActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const registered = Boolean(
    node.assetId && colorManagementService.isFileTransformAssetRegistered(node.assetId),
  );
  const assetError = node.assetId ? ocio.fileAssetErrors[node.assetId] : null;
  const supportedExtensions = useMemo(
    () =>
      new Set(
        ocio.fileTransformFormats.map((format) =>
          format.extension.toLowerCase().replace(/^\./, ''),
        ),
      ),
    [ocio.fileTransformFormats],
  );
  const accept = useMemo(
    () =>
      Array.from(supportedExtensions)
        .map((extension) => `.${extension}`)
        .join(','),
    [supportedExtensions],
  );
  const { entryColorSpace, exitColorSpace } = getFileTransformColorSpaces(node, {
    workingColorSpace: ocio.workingColorSpace,
    textureColorSpace: ocio.textureColorSpace,
    logColorSpace: ocio.logColorSpace,
  });

  const importFile = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!extension || !supportedExtensions.has(extension)) {
      setImportError(`.${extension || 'unknown'} is not supported by this OCIO build.`);
      return;
    }
    setImportError(null);
    setIsImporting(true);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const assetId = await saveAsset(file);
      colorManagementService.registerFileTransformAsset(assetId, file.name, data);
      updateNode(node.id, { assetId, fileName: file.name, fileSize: file.size }, true);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : 'Could not import the transform file.',
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <CollapsibleSection title="Transform File" defaultOpen>
        <div className="space-y-4">
          <TransformPath
            segments={[
              { label: ocio.workingColorSpace },
              { label: entryColorSpace },
              { label: node.fileName || 'Choose transform file', accent: true },
              { label: exitColorSpace },
              { label: ocio.workingColorSpace },
            ]}
          />
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importFile(file);
            }}
          />
          {node.assetId && node.fileName ? (
            <div className="rounded-lg border border-white/10 bg-black/15 p-2.5">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 rounded-md bg-cyan-400/10 p-1.5 text-cyan-200">
                  <Icons.DocumentPlus className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-gray-100">{node.fileName}</div>
                  <div className="mt-0.5 text-[9px] text-gray-500">
                    {node.fileSize ? `${Math.max(1, Math.round(node.fileSize / 1024))} KB · ` : ''}
                    {assetError ? 'Needs attention' : registered ? 'Ready' : 'Preparing…'}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-gray-500 transition hover:bg-white/10 hover:text-white"
                  title="Replace transform file"
                  onClick={() => inputRef.current?.click()}
                >
                  <Icons.ArrowsRightLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-gray-500 transition hover:bg-rose-400/10 hover:text-rose-200"
                  title="Remove transform file"
                  onClick={() =>
                    updateNode(
                      node.id,
                      { assetId: null, fileName: null, fileSize: undefined },
                      true,
                    )
                  }
                >
                  <Icons.Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={isImporting}
              onClick={() => inputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-300/20 bg-cyan-400/[0.04] px-3 py-5 text-xs text-cyan-100/80 transition hover:border-cyan-300/35 hover:bg-cyan-400/[0.07] disabled:opacity-50"
            >
              <Icons.ArrowDownTray className="h-4 w-4" />
              {isImporting ? 'Importing…' : 'Choose OCIO transform file'}
            </button>
          )}
          {importError ? <SelectionIssue>{importError}</SelectionIssue> : null}
          {assetError ? <SelectionIssue>{assetError}</SelectionIssue> : null}
          <DirectionField
            value={node.direction}
            onChange={(direction) => updateNode(node.id, { direction }, true)}
          />
          <Field label="Interpolation">
            <StyledDropdown
              value={node.interpolation}
              options={[
                { value: 'best', label: 'Best', secondaryLabel: 'Recommended for mixed LUT types' },
                { value: 'default', label: 'File Default' },
                {
                  value: 'tetrahedral',
                  label: 'Tetrahedral',
                  secondaryLabel: 'High-quality 3D LUT',
                },
                { value: 'linear', label: 'Linear' },
                { value: 'nearest', label: 'Nearest' },
              ]}
              onChange={(value) =>
                updateNode(
                  node.id,
                  { interpolation: String(value) as OcioFileTransformInterpolation },
                  true,
                )
              }
            />
          </Field>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="Color Encoding" defaultOpen>
        <div className="space-y-4">
          <Field label="LUT Input Space" hint="Working RGB is converted into this space">
            <OcioColorSpaceDropdown
              value={node.inputColorSpace}
              includeData={false}
              includeRoles
              onChange={(inputColorSpace) => updateNode(node.id, { inputColorSpace }, true)}
            />
          </Field>
          <Field label="LUT Output Space" hint="Converted back to project working space">
            <OcioColorSpaceDropdown
              value={node.outputColorSpace}
              includeData={false}
              includeRoles
              onChange={(outputColorSpace) => updateNode(node.id, { outputColorSpace }, true)}
            />
          </Field>
          <Field label="CCC / CDL ID" hint="Optional">
            <TextInput
              value={node.cccId ?? ''}
              onValueChange={(value) => updateNode(node.id, { cccId: value }, false)}
              onBlur={() => updateNode(node.id, { cccId: node.cccId ?? '' }, true)}
              placeholder="First correction in file"
            />
          </Field>
        </div>
      </CollapsibleSection>
    </>
  );
}

export function OcioTransformAdjustments({ node }: { node: AnyNode }) {
  if (node.type === NodeType.OCIO_COLOR_SPACE) {
    return <OcioColorSpaceTransformAdjustments node={node as OcioColorSpaceTransformNode} />;
  }
  if (node.type === NodeType.OCIO_NAMED_TRANSFORM) {
    return <OcioNamedTransformAdjustments node={node as OcioNamedTransformNode} />;
  }
  if (node.type === NodeType.OCIO_FILE_TRANSFORM) {
    return <OcioFileTransformAdjustments node={node as OcioFileTransformNode} />;
  }
  return <OcioLookTransformAdjustments node={node as OcioLookTransformNode} />;
}
