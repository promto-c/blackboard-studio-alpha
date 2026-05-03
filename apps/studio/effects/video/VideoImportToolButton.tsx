import React, { useRef } from 'react';
import { useEditorActions } from '@/state/editorContext';
import { ToolButton } from '@/components';
import { Video } from '@blackboard/icons';

const VideoImportToolButton = () => {
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
        label="Video"
        icon={<Video className="h-6 w-6" />}
        onClick={handleOpenFile}
        title="Adds a new video node to the current project."
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="video/mp4, video/webm"
        className="hidden"
      />
    </>
  );
};

export default VideoImportToolButton;
