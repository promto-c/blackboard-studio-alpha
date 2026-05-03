import React, { useRef } from 'react';
import { useEditorActions } from '@/state/editorContext';
import { useDirectoryImportMode } from '@/hooks/useDirectoryImportMode';
import { getDirectoryPickerSupport } from '@/utils/directoryPickerSupport';
import { ToolButton } from '@/components';
import * as Icons from '@blackboard/icons';

const ImageSequenceToolButton = () => {
  const { loadImageSequence, loadImageSequenceFromDirectory } = useEditorActions();
  const { requestImportMode, importModeDialog } = useDirectoryImportMode();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenFolder = async () => {
    const pickerSupport = getDirectoryPickerSupport();

    const importMode = await requestImportMode({
      referenceEnabled: pickerSupport.canUseDirectoryPicker,
      referenceDisabledReason: pickerSupport.reason,
    });
    if (!importMode) return;

    if (!pickerSupport.canUseDirectoryPicker) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const directoryHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
      await loadImageSequenceFromDirectory(directoryHandle, importMode);
    } catch (error: any) {
      const isPickerBlocked =
        error?.name === 'SecurityError' ||
        String(error?.message || '').includes('Cross origin sub frames');
      if (isPickerBlocked) {
        fileInputRef.current?.click();
        return;
      }
      if (error?.name !== 'AbortError') {
        console.error('Failed to import directory:', error);
      }
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      loadImageSequence(Array.from(files));
    }
    if (event.target) {
      event.target.value = '';
    }
  };

  return (
    <>
      <ToolButton
        label="Sequence"
        icon={<Icons.FolderOpen className="h-6 w-6" />}
        onClick={handleOpenFolder}
        title="Import a folder of images as a sequence node."
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        {...({ webkitdirectory: 'true' } as any)}
        className="hidden"
      />
      {importModeDialog}
    </>
  );
};

export default ImageSequenceToolButton;
