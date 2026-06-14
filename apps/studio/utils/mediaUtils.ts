/**
 * Reads video metadata (width, height, duration) from a File object by
 * loading it into a <video> element.
 */
export const readVideoMetadata = async (
  file: File,
): Promise<{ width: number; height: number; duration: number }> => {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<{ width: number; height: number; duration: number }>(
      (resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = objectUrl;
        video.onloadedmetadata = () =>
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
          });
        video.onerror = () => reject(new Error(`Could not decode video "${file.name}"`));
        video.load();
      },
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

/**
 * Triggers a file download in the browser by creating a temporary <a> element
 * with the given blob content.
 */
export const triggerDownload = (blob: Blob, filename: string) => {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
};
