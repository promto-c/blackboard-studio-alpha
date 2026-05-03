import React from 'react';
import { AnyNode, PaintNode, type PaintLifetimePresetMode } from '@blackboard/types';
import { CollapsibleSection, SegmentedControl } from '@/components';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  DEFAULT_NEW_STROKE_LIFETIME,
  clampPaintFrame,
  getPaintLifetimePresetLabel,
  normalizePaintLifetimePreset,
} from './paintLifetime';

const FRAME_INPUT_CLASS =
  'bg-gray-700/50 text-gray-200 text-xs rounded focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block p-2 font-mono w-full border-0';

const LIFETIME_MODE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'current_frame', label: 'Current' },
  { value: 'range', label: 'Range' },
] as const;

const PaintAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as PaintNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const maxFrames = useEditorSelector((state) => state.maxFrames);
  const { updateNode } = useEditorActions();

  const updateDefaultLifetimeMode = (mode: PaintLifetimePresetMode) => {
    if (mode === 'all') {
      updateNode(node.id, { defaultLifetime: { mode: 'all' } }, true);
      return;
    }

    if (mode === 'current_frame') {
      updateNode(node.id, { defaultLifetime: { mode: 'current_frame' } }, true);
      return;
    }

    const normalizedLifetime = normalizePaintLifetimePreset(node.defaultLifetime);
    updateNode(
      node.id,
      {
        defaultLifetime:
          normalizedLifetime.mode === 'range'
            ? normalizedLifetime
            : {
                mode: 'range',
                startFrame: clampPaintFrame(currentFrame, maxFrames),
                endFrame: clampPaintFrame(currentFrame, maxFrames),
              },
      },
      true,
    );
  };

  const updateDefaultLifetimeRange = (key: 'startFrame' | 'endFrame', value: number) => {
    if (!Number.isFinite(value)) return;

    const normalizedLifetime = normalizePaintLifetimePreset(node.defaultLifetime);
    const baseRange =
      normalizedLifetime.mode === 'range'
        ? normalizedLifetime
        : {
            mode: 'range' as const,
            startFrame: clampPaintFrame(currentFrame, maxFrames),
            endFrame: clampPaintFrame(currentFrame, maxFrames),
          };

    updateNode(
      node.id,
      {
        defaultLifetime: {
          ...baseRange,
          [key]: clampPaintFrame(value, maxFrames),
        },
      },
      true,
    );
  };

  const normalizedDefaultLifetime = normalizePaintLifetimePreset(node.defaultLifetime);
  const defaultLifetimeSummary = getPaintLifetimePresetLabel(node.defaultLifetime);
  const rangeLifetime =
    normalizedDefaultLifetime.mode === 'range'
      ? normalizedDefaultLifetime
      : {
          mode: 'range' as const,
          startFrame: clampPaintFrame(currentFrame, maxFrames),
          endFrame: clampPaintFrame(currentFrame, maxFrames),
        };

  return (
    <div className="space-y-3">
      <CollapsibleSection title="Lifetime" defaultOpen>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-medium text-gray-200">
              <span>Default for New Strokes</span>
              <span className="text-gray-400">{defaultLifetimeSummary}</span>
            </div>
            <SegmentedControl
              options={LIFETIME_MODE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={normalizedDefaultLifetime.mode}
              onChange={(value) => updateDefaultLifetimeMode(value as PaintLifetimePresetMode)}
            />
          </div>

          {normalizedDefaultLifetime.mode === 'range' ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">
                  Start
                </span>
                <input
                  type="number"
                  value={rangeLifetime.startFrame}
                  min={0}
                  max={maxFrames}
                  step={1}
                  onChange={(event) =>
                    updateDefaultLifetimeRange('startFrame', Number(event.target.value))
                  }
                  className={FRAME_INPUT_CLASS}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">
                  End
                </span>
                <input
                  type="number"
                  value={rangeLifetime.endFrame}
                  min={0}
                  max={maxFrames}
                  step={1}
                  onChange={(event) =>
                    updateDefaultLifetimeRange('endFrame', Number(event.target.value))
                  }
                  className={FRAME_INPUT_CLASS}
                />
              </label>
            </div>
          ) : null}

          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-gray-300">
            <div className="font-medium text-gray-100">Playhead: {currentFrame}</div>
            <div className="mt-1 text-gray-400">
              {normalizedDefaultLifetime.mode === 'current_frame'
                ? 'Each new stroke resolves to the current playhead frame when you paint.'
                : normalizedDefaultLifetime.mode === 'range'
                  ? 'Range lifetimes are inclusive and apply to each new stroke you commit.'
                  : 'New strokes stay active across the full timeline until you trim them.'}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Node" defaultOpen={false}>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
          {(node.layers?.length ?? 0) > 0
            ? `${node.layers?.length ?? 0} ${node.layers?.length === 1 ? 'layer' : 'layers'} / `
            : ''}
          {node.strokes.length} committed {node.strokes.length === 1 ? 'stroke' : 'strokes'}
          <span className="mx-1 text-gray-600">•</span>
          New strokes:{' '}
          {getPaintLifetimePresetLabel(node.defaultLifetime ?? DEFAULT_NEW_STROKE_LIFETIME)}
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default PaintAdjustments;
