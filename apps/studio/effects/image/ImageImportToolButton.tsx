import React, { useRef } from 'react';
import { useEditorActions } from '@/state/editorContext';
import { ToolButton } from '@/components';
import { IMAGE_IMPORT_ACCEPT } from '@/utils/mediaFiles';
import * as Icons from '@blackboard/icons';

const ImageImportToolButton = () => {
  const { loadImage } = useEditorActions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      loadImage(file);
    }
    // Reset file input value to allow opening the same file again
    if (event.target) {
      event.target.value = '';
    }
  };

  return (
    <>
      <ToolButton
        label="Import"
        icon={<Icons.ArrowUpTray className="h-6 w-6" />}
        onClick={handleOpenFile}
        title="Adds a new image node to the current project."
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={IMAGE_IMPORT_ACCEPT}
        className="hidden"
      />
    </>
  );
};

export default ImageImportToolButton;
