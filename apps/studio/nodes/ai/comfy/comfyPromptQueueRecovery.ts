import {
  isComfyPromptInputValidationError,
  type ComfyPromptQueueResult,
} from '@/services/comfy/client';

export interface ComfyQueuedInputUpload {
  imageName: string;
  cacheHit: boolean;
}

export interface ComfyInputUploadRecoveryOptions {
  forceUploadImageNames?: ReadonlySet<string>;
}

export interface QueueComfyPromptWithInputRecoveryOptions<TInput extends ComfyQueuedInputUpload> {
  initialPromptId: string;
  uploadInputs: (options?: ComfyInputUploadRecoveryOptions) => Promise<TInput[]>;
  createPrompt: (inputImages: TInput[]) => Record<string, unknown>;
  queuePrompt: (
    prompt: Record<string, unknown>,
    promptId: string,
  ) => Promise<ComfyPromptQueueResult>;
  invalidateCachedImage: (imageName: string) => void;
  cancelAcceptedPrompt?: (promptId: string) => Promise<void>;
  createPromptId: () => string;
}

export interface QueueComfyPromptWithInputRecoveryResult<TInput extends ComfyQueuedInputUpload> {
  queued: ComfyPromptQueueResult;
  inputImages: TInput[];
}

const getRecoverableCachedImageNames = (
  inputImages: ComfyQueuedInputUpload[],
  invalidImageNames: ReadonlySet<string>,
): string[] => [
  ...new Set(
    inputImages
      .filter((inputImage) => inputImage.cacheHit && invalidImageNames.has(inputImage.imageName))
      .map((inputImage) => inputImage.imageName),
  ),
];

export const queueComfyPromptWithInputRecovery = async <TInput extends ComfyQueuedInputUpload>({
  initialPromptId,
  uploadInputs,
  createPrompt,
  queuePrompt,
  invalidateCachedImage,
  cancelAcceptedPrompt,
  createPromptId,
}: QueueComfyPromptWithInputRecoveryOptions<TInput>): Promise<
  QueueComfyPromptWithInputRecoveryResult<TInput>
> => {
  let activePromptId = initialPromptId;
  let inputImages = await uploadInputs();
  let prompt = createPrompt(inputImages);

  try {
    return {
      queued: await queuePrompt(prompt, activePromptId),
      inputImages,
    };
  } catch (error) {
    if (!isComfyPromptInputValidationError(error)) throw error;

    const staleCachedImageNames = getRecoverableCachedImageNames(
      inputImages,
      new Set(error.invalidImageNames),
    );
    if (staleCachedImageNames.length === 0) throw error;

    if (error.promptId) {
      await cancelAcceptedPrompt?.(error.promptId);
      activePromptId = createPromptId();
    }

    for (const imageName of staleCachedImageNames) {
      invalidateCachedImage(imageName);
    }
    inputImages = await uploadInputs({
      forceUploadImageNames: new Set(staleCachedImageNames),
    });
    prompt = createPrompt(inputImages);

    return {
      queued: await queuePrompt(prompt, activePromptId),
      inputImages,
    };
  }
};
