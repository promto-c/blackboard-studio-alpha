import React, { useRef } from 'react';
import { useEditorActions } from '@/state/editorContext';
import { ToolButton } from '@/components';
import { IMPORT_MEDIA_ACCEPT } from '@/utils/mediaFiles';
import { Photo } from '@blackboard/icons';

const MediaSourceImportToolButton = () => {
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
    if (event.target) {
      event.target.value = '';
    }
  };

  return (
    <>
      <ToolButton
        label="Import"
        icon={<Photo className="h-6 w-6" />}
        onClick={handleOpenFile}
        title="Import an image or video file as a media source node."
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={IMPORT_MEDIA_ACCEPT}
        className="hidden"
      />
    </>
  );
};

export default MediaSourceImportToolButton;
