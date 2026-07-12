import { describe, expect, it } from 'vitest';
import {
  createInAppMediaDragPayload,
  hasInAppMediaDrag,
  IN_APP_MEDIA_DRAG_TYPE,
  readInAppMediaDrag,
  writeInAppMediaDrag,
} from './inAppMediaDrag';

const createDataTransfer = () => {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'none',
    get types() {
      return Array.from(values.keys());
    },
    setData(type: string, value: string) {
      values.set(type, value);
    },
    getData(type: string) {
      return values.get(type) ?? '';
    },
  } as unknown as DataTransfer;
};

describe('in-app media drag payload', () => {
  it('round-trips existing media asset metadata through DataTransfer', () => {
    const payload = createInAppMediaDragPayload({
      assetId: 'asset:image-1',
      mediaKind: 'image',
      label: 'Generated plate',
      width: 1920,
      height: 1080,
      colorSpace: 'ACEScg',
    });
    expect(payload).not.toBeNull();

    const dataTransfer = createDataTransfer();
    writeInAppMediaDrag(dataTransfer, payload!);

    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(hasInAppMediaDrag(dataTransfer)).toBe(true);
    expect(readInAppMediaDrag(dataTransfer)).toMatchObject({
      assetId: 'asset:image-1',
      mediaKind: 'image',
      label: 'Generated plate',
      width: 1920,
      height: 1080,
      colorSpace: 'ACEScg',
    });
  });

  it('rejects malformed and incomplete sequence payloads', () => {
    const dataTransfer = createDataTransfer();
    dataTransfer.setData(IN_APP_MEDIA_DRAG_TYPE, '{invalid');
    expect(readInAppMediaDrag(dataTransfer)).toBeNull();

    dataTransfer.setData(
      IN_APP_MEDIA_DRAG_TYPE,
      JSON.stringify({
        version: 1,
        assetId: '',
        mediaKind: 'image_sequence',
        width: 64,
        height: 64,
        frames: [],
      }),
    );
    expect(readInAppMediaDrag(dataTransfer)).toBeNull();
  });
});
