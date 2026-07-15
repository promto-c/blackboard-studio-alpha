import React, { useRef } from 'react';
import { useEditorActions } from '@/state/editorContext';
import { CollapsibleSection } from '@blackboard/ui';
import { ArrowDownTray, FolderOpen, Photo, Video } from '@blackboard/icons';
import { IMAGE_IMPORT_ACCEPT } from '@/utils/mediaFiles';

export type SourceSlotKind = 'image' | 'video' | 'image_sequence';

interface SourceSlotProps {
  nodeId: string;
  kind: SourceSlotKind;
  children?: React.ReactNode;
  sourceFileName?: string;
  width: number;
  height: number;
  frameCount?: number;
}

const KIND_ACCEPT: Record<SourceSlotKind, string> = {
  image: IMAGE_IMPORT_ACCEPT,
  video: 'video/mp4, video/webm',
  image_sequence: '',
};

const KIND_ICON: Record<SourceSlotKind, React.ComponentType<{ className?: string }>> = {
  image: Photo,
  video: Video,
  image_sequence: FolderOpen,
};

const formatDimensions = (w: number, h: number): string => (w > 0 && h > 0 ? `${w} × ${h}` : '—');

function SourceSlot({
  nodeId,
  kind,
  children,
  sourceFileName,
  width,
  height,
  frameCount,
}: SourceSlotProps) {
  const { replaceNodeSource, replaceNodeSourceSequence } = useEditorActions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seqInputRef = useRef<HTMLInputElement>(null);
  const Icon = KIND_ICON[kind];

  const handleReplace = () => {
    if (kind === 'image_sequence') {
      seqInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      replaceNodeSource(nodeId, file);
    }
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleSeqChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      replaceNodeSourceSequence(nodeId, Array.from(files));
    }
    if (event.target) {
      event.target.value = '';
    }
  };

  return (
    <CollapsibleSection title="Source" defaultOpen>
      <div className="space-y-3">
        {children}
        <div className="flex items-start gap-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
          <div className="shrink-0 mt-0.5">
            <Icon className="h-5 w-5 text-gray-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-200 truncate" title={sourceFileName}>
              {sourceFileName || 'No source selected'}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {formatDimensions(width, height)}
              {frameCount !== undefined ? ` · ${frameCount} frames` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={handleReplace}
            title={kind === 'image_sequence' ? 'Replace source folder' : 'Replace source file'}
            className="shrink-0 rounded-md p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            <ArrowDownTray className="h-4 w-4" />
          </button>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={KIND_ACCEPT[kind]}
        className="hidden"
      />

      {kind === 'image_sequence' && (
        <input
          type="file"
          ref={seqInputRef}
          onChange={handleSeqChange}
          {...({ webkitdirectory: 'true' } as React.HTMLAttributes<HTMLInputElement>)}
          className="hidden"
        />
      )}
    </CollapsibleSection>
  );
}

export default SourceSlot;
