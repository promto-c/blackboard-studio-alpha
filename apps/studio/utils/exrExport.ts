import * as THREE from 'three';
import type { WriteExrAttribute, WriteExrChannelInput } from '@bb-studio/exr';
import { readRenderTargetRgbaFloat as readFloatRgba } from '@blackboard/renderer';

export type OpenExrPrecision = 'half' | 'float';

export interface OpenExrImage {
  width: number;
  height: number;
  rgba: Float32Array;
  namedChannels?: readonly OpenExrNamedChannel[];
}

export interface OpenExrNamedChannel {
  name: string;
  data: Float32Array;
  precision?: OpenExrPrecision;
}

export interface EncodeOpenExrOptions {
  precision: OpenExrPrecision;
  includeAlpha: boolean;
  includeColorChannels?: boolean;
  attributes?: Readonly<Record<string, WriteExrAttribute>>;
}

export const readRenderTargetRgbaFloat = (
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
): OpenExrImage => ({
  width: target.width,
  height: target.height,
  rgba: readFloatRgba(renderer, target),
});

const extractChannel = (rgba: Float32Array, channelOffset: number): Float32Array => {
  const channel = new Float32Array(rgba.length / 4);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = rgba[index * 4 + channelOffset];
  }
  return channel;
};

const getExrPixelType = (precision: OpenExrPrecision): 1 | 2 => (precision === 'half' ? 1 : 2);

const appendNamedChannels = (channels: WriteExrChannelInput[], image: OpenExrImage): void => {
  const pixelCount = image.width * image.height;
  const channelNames = new Set(channels.map((channel) => channel.name));

  for (const namedChannel of image.namedChannels ?? []) {
    const name = namedChannel.name.trim();
    if (!name || name.includes('\0')) {
      throw new Error('OpenEXR named channels require a non-empty valid name.');
    }
    if (channelNames.has(name)) {
      throw new Error(`OpenEXR channel name "${name}" is duplicated.`);
    }
    if (namedChannel.data.length !== pixelCount) {
      throw new Error(`OpenEXR channel "${name}" data length does not match the image dimensions.`);
    }

    channelNames.add(name);
    channels.push({
      name,
      pixelType: getExrPixelType(namedChannel.precision ?? 'float'),
      data: namedChannel.data,
    });
  }
};

export const encodeOpenExr = async (
  image: OpenExrImage,
  options: EncodeOpenExrOptions,
): Promise<Blob> => {
  if (image.rgba.length !== image.width * image.height * 4) {
    throw new Error('OpenEXR RGBA data length does not match the image dimensions.');
  }

  const pixelType = getExrPixelType(options.precision);
  const channels: WriteExrChannelInput[] =
    options.includeColorChannels === false
      ? []
      : [
          { name: 'R', pixelType, data: extractChannel(image.rgba, 0) },
          { name: 'G', pixelType, data: extractChannel(image.rgba, 1) },
          { name: 'B', pixelType, data: extractChannel(image.rgba, 2) },
        ];
  if (options.includeAlpha) {
    channels.push({ name: 'A', pixelType, data: extractChannel(image.rgba, 3) });
  }
  appendNamedChannels(channels, image);
  if (channels.length === 0) {
    throw new Error('OpenEXR export requires at least one channel.');
  }

  const { writeExr } = await import('@bb-studio/exr');
  const encoded = writeExr({
    parts: [
      {
        compression: 3,
        dataWindow: {
          xMin: 0,
          yMin: 0,
          xMax: image.width - 1,
          yMax: image.height - 1,
        },
        channels,
        ...(options.attributes ? { attributes: options.attributes } : {}),
      },
    ],
  });
  const bytes = new Uint8Array(encoded);
  return new Blob([bytes.buffer], { type: 'image/x-exr' });
};

export const encodeRenderTargetOpenExr = (
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  options: EncodeOpenExrOptions & {
    technicalChannelName?: string;
    namedChannelTargets?: readonly {
      name: string;
      target: THREE.WebGLRenderTarget;
    }[];
  },
): Promise<Blob> => {
  const image: OpenExrImage = {
    width: target.width,
    height: target.height,
    rgba: readFloatRgba(renderer, target),
  };
  const namedChannels: OpenExrNamedChannel[] = [];

  if (options.technicalChannelName) {
    namedChannels.push({
      name: options.technicalChannelName,
      data: extractChannel(image.rgba, 0),
      precision: 'float',
    });
  }

  for (const channel of options.namedChannelTargets ?? []) {
    const channelImage: OpenExrImage = {
      width: channel.target.width,
      height: channel.target.height,
      rgba: readFloatRgba(renderer, channel.target),
    };
    if (channelImage.width !== image.width || channelImage.height !== image.height) {
      throw new Error(
        `OpenEXR channel "${channel.name}" dimensions do not match the primary output.`,
      );
    }
    namedChannels.push({
      name: channel.name,
      data: extractChannel(channelImage.rgba, 0),
      precision: 'float',
    });
  }

  return encodeOpenExr(
    {
      ...image,
      ...(namedChannels.length > 0 ? { namedChannels } : {}),
    },
    {
      precision: options.technicalChannelName ? 'float' : options.precision,
      includeAlpha: options.technicalChannelName ? false : options.includeAlpha,
      includeColorChannels: !options.technicalChannelName,
      ...(options.attributes ? { attributes: options.attributes } : {}),
    },
  );
};
