import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { Content, Part } from '@google/genai';
import type { AiChatAttachment, AiProvider } from '@blackboard/types';
import { DEFAULT_OPENAI_BASE_URL, normalizeOpenAiBaseUrl } from '@/utils/aiRouting';

let aiClient: { apiKey: string; client: GoogleGenAI } | null = null;

interface GeminiApiOptions {
  geminiApiKey?: string;
  geminiModel?: string;
}

interface OpenAiApiOptions {
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
}

interface RoutedTextAiOptions extends GeminiApiOptions, OpenAiApiOptions {
  provider?: AiProvider;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  signal?: AbortSignal;
}

export interface PromptEnhancementOptions extends RoutedTextAiOptions {
  followUpInstruction?: string;
}

export interface PromptEnhancementResult {
  message: string;
  options: string[];
  suggestions: string[];
  provider: AiProvider;
  model: string;
}

export interface GenerateShaderCodeOptions {
  provider?: AiProvider;
  geminiApiKey?: string;
  geminiModel?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  currentShader?: string;
  history?: ShaderChatTurn[];
  attachments?: AiChatAttachment[];
  nodeName?: string;
  onStreamUpdate?: (update: ShaderGenerationStreamUpdate) => void;
  signal?: AbortSignal;
  enableThinking?: boolean;
}

export interface GenerateAssistantChatOptions {
  provider?: AiProvider;
  geminiApiKey?: string;
  geminiModel?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  history?: AssistantChatTurn[];
  attachments?: AiChatAttachment[];
  contextSummary?: string;
  mode?: 'generic' | 'context' | 'action';
  onStreamUpdate?: (update: AssistantChatStreamUpdate) => void;
  signal?: AbortSignal;
  enableThinking?: boolean;
}

export interface AssistantChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantChatResult {
  message: string;
  provider: AiProvider;
  model: string;
  thinking?: string;
}

export interface AssistantChatStreamUpdate {
  stage: 'streaming' | 'complete';
  provider: 'ollama';
  model: string;
  content: string;
  thinking: string;
  isThinking?: boolean;
}

export interface ShaderChatTurn {
  role: 'user' | 'assistant';
  content: string;
  shaderCode?: string;
}

export interface ShaderGenerationResult {
  message: string;
  shaderCode: string;
  suggestions: string[];
  provider: AiProvider;
  model: string;
  validationErrors: string[];
  thinking?: string;
}

export interface ShaderGenerationStreamUpdate {
  stage: 'streaming' | 'repairing' | 'complete';
  provider: 'ollama';
  model: string;
  content: string;
  thinking: string;
  isThinking?: boolean;
  shaderCode: string;
  suggestions: string[];
}

const GEMINI_PROMPT_ENHANCEMENT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    message: { type: Type.STRING },
    options: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['message', 'options', 'suggestions'],
};

export interface OllamaModelSummary {
  name: string;
  model: string;
  modifiedAt?: string;
  size?: number;
  capabilities?: string[];
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

export class OllamaAuthenticationRequiredError extends Error {
  authUrl: string;

  constructor(authUrl: string, message?: string) {
    super(
      message?.trim() ||
        'Ollama endpoint requires authentication. Open the endpoint, sign in, then check again.',
    );
    this.name = 'OllamaAuthenticationRequiredError';
    this.authUrl = authUrl;
  }
}

export const isOllamaAuthenticationRequiredError = (
  error: unknown,
): error is OllamaAuthenticationRequiredError =>
  error instanceof OllamaAuthenticationRequiredError ||
  (typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'OllamaAuthenticationRequiredError' &&
    'authUrl' in error &&
    typeof (error as { authUrl?: unknown }).authUrl === 'string');

const getBundledGeminiApiKey = (): string =>
  (
    ((process.env.API_KEY as string | undefined) ||
      (process.env.GEMINI_API_KEY as string | undefined) ||
      '') as string
  ).trim();

const resolveGeminiApiKey = (apiKey: string | undefined): string =>
  apiKey?.trim() || getBundledGeminiApiKey();

export const hasGeminiApiKey = (apiKey?: string): boolean => Boolean(resolveGeminiApiKey(apiKey));
export const hasOpenAiApiKey = (apiKey?: string): boolean => Boolean(apiKey?.trim());

function getAiClient(apiKeyOverride?: string): GoogleGenAI {
  const apiKey = resolveGeminiApiKey(apiKeyOverride);

  if (!apiKey) {
    throw new Error(
      'Missing Gemini API key. Set it in Preferences > AI or define GEMINI_API_KEY before building.',
    );
  }

  if (!aiClient || aiClient.apiKey !== apiKey) {
    aiClient = {
      apiKey,
      client: new GoogleGenAI({ apiKey }),
    };
  }

  return aiClient.client;
}

const getOpenAiApiKey = (apiKey?: string): string => apiKey?.trim() || '';

const getOpenAiResponsesEndpoint = (baseUrl?: string): string =>
  `${normalizeOpenAiBaseUrl(baseUrl || DEFAULT_OPENAI_BASE_URL)}/responses`;

const buildOpenAiInput = (
  text: string,
  attachments: AiChatAttachment[] | undefined,
): Array<{
  role: 'user';
  content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }>;
}> => {
  const content: Array<
    { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }
  > = [{ type: 'input_text', text }];

  (attachments ?? []).forEach((attachment) => {
    if (attachment.kind !== 'image' || !attachment.dataUrl) return;
    content.push({
      type: 'input_image',
      image_url: attachment.dataUrl,
    });
  });

  return [{ role: 'user', content }];
};

const readOpenAiOutputText = (body: unknown): string => {
  if (!body || typeof body !== 'object') return '';

  const candidate = body as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        type?: unknown;
        text?: unknown;
      }>;
    }>;
  };

  if (typeof candidate.output_text === 'string') {
    return candidate.output_text.trim();
  }

  const contentParts = Array.isArray(candidate.output)
    ? candidate.output.flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    : [];

  return contentParts
    .filter(
      (part): part is { type?: unknown; text: string } =>
        typeof part === 'object' && part !== null && typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('\n')
    .trim();
};

const generateOpenAiResponseText = async (
  prompt: string,
  options: OpenAiApiOptions & {
    attachments?: AiChatAttachment[];
    signal?: AbortSignal;
  },
): Promise<{ text: string; model: string }> => {
  const apiKey = getOpenAiApiKey(options.openAiApiKey);
  const model = options.openAiModel?.trim();

  if (!model) {
    throw new Error('Missing OpenAI model. Set it in Preferences > Integrations.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(getOpenAiResponsesEndpoint(options.openAiBaseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input: buildOpenAiInput(prompt, options.attachments),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${await readErrorResponse(response)}`);
  }

  const body = await response.json();
  const text = readOpenAiOutputText(body);
  if (!text) {
    throw new Error('OpenAI returned an empty response.');
  }

  return {
    text,
    model,
  };
};

export const testOpenAiConnection = async (
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<void> => {
  const trimmedApiKey = apiKey.trim();
  const trimmedBaseUrl = normalizeOpenAiBaseUrl(baseUrl).trim();
  const trimmedModel = model.trim();

  if (!trimmedModel) {
    throw new Error('Missing OpenAI model. Set it in Preferences > Integrations.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (trimmedApiKey) {
    headers.Authorization = `Bearer ${trimmedApiKey}`;
  }

  const response = await fetch(`${trimmedBaseUrl}/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: trimmedModel,
      input: [{ type: 'input_text', text: 'ping' }],
    }),
    mode: 'cors',
  });

  // Handle CORS errors: when preflight fails, response.ok is false and status is 0
  if (!response.ok && response.status === 0) {
    // Try with 'no-cors' mode to detect connectivity even when preflight fails
    const fallbackResponse = await fetch(`${trimmedBaseUrl}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: trimmedModel,
        input: [{ type: 'input_text', text: 'ping' }],
      }),
      mode: 'no-cors',
    });

    if (fallbackResponse.ok) {
      return;
    }

    throw new Error(
      `Could not reach ${trimmedBaseUrl}. The server may not have CORS headers enabled. ` +
        'Check that your local server allows requests from the Studio origin.',
    );
  }

  if (!response.ok) {
    const errorBody = await readErrorResponse(response);
    throw new Error(`OpenAI connection failed: ${errorBody || `HTTP ${response.status}`}`);
  }

  // Success - response should be OK
};

function getAiErrorDetails(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const responseError = (
      error as {
        response?: { data?: { error?: { message?: string } } };
      }
    ).response?.data?.error?.message;

    if (typeof responseError === 'string' && responseError.trim()) {
      return responseError.trim();
    }
  }

  return error instanceof Error ? error.message : String(error);
}

const TEXT_ATTACHMENT_CHARACTER_LIMIT = 20000;

const formatAttachmentSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
};

const getBase64Payload = (dataUrl: string | undefined): string | null => {
  if (!dataUrl) {
    return null;
  }

  const commaIndex = dataUrl.indexOf(',');
  return commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
};

export const getAiAttachmentImagePayloads = (
  attachments: AiChatAttachment[] | undefined,
): string[] =>
  (attachments ?? []).flatMap((attachment) => {
    if (attachment.kind !== 'image') {
      return [];
    }

    const payload = getBase64Payload(attachment.dataUrl);
    return payload ? [payload] : [];
  });

const buildGeminiContents = (
  text: string,
  attachments: AiChatAttachment[] | undefined,
): string | Content => {
  const imageParts: Part[] = (attachments ?? []).flatMap((attachment) => {
    if (attachment.kind !== 'image') {
      return [];
    }

    const data = getBase64Payload(attachment.dataUrl);
    if (!data) {
      return [];
    }

    return [
      {
        inlineData: {
          mimeType: attachment.mimeType || 'image/png',
          data,
        },
      } satisfies Part,
    ];
  });

  if (imageParts.length === 0) {
    return text;
  }

  return {
    role: 'user',
    parts: [{ text }, ...imageParts],
  };
};

const buildOllamaUserMessage = (
  content: string,
  attachments: AiChatAttachment[] | undefined,
): { role: 'user'; content: string; images?: string[] } => {
  const images = getAiAttachmentImagePayloads(attachments);
  return images.length > 0
    ? {
        role: 'user',
        content,
        images,
      }
    : {
        role: 'user',
        content,
      };
};

export const getAiAttachmentTextContext = (attachments: AiChatAttachment[] | undefined): string => {
  if (!attachments?.length) {
    return '';
  }

  return attachments
    .map((attachment, index) => {
      const label = `${index + 1}. ${attachment.name} (${attachment.mimeType || 'unknown type'}, ${formatAttachmentSize(attachment.size)})`;
      if (attachment.kind === 'image') {
        return `${label}\nType: image attachment. If image payloads are available, inspect the image directly.`;
      }

      if (attachment.kind === 'text' && attachment.text?.trim()) {
        const text = attachment.text.trim();
        const truncatedText =
          text.length > TEXT_ATTACHMENT_CHARACTER_LIMIT
            ? `${text.slice(0, TEXT_ATTACHMENT_CHARACTER_LIMIT)}\n\n[Attachment truncated after ${TEXT_ATTACHMENT_CHARACTER_LIMIT} characters.]`
            : text;

        return `${label}\nText content:\n${truncatedText}`;
      }

      return `${label}\nType: file attachment. The app provided metadata only for this file.`;
    })
    .join('\n\n');
};

/**
 * Converts a base64 string to a Blob object.
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64.split(',')[1]);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Sends a masked image and a prompt to the Gemini API for inpainting.
 * @param base64MaskedImage The source image with a transparent area for inpainting, encoded as a base64 string.
 * @param prompt The text prompt describing the desired edit.
 * @returns A base64 string of the newly generated image.
 */
export async function generateInpainting(
  base64MaskedImage: string,
  prompt: string,
  options: GeminiApiOptions = {},
): Promise<string> {
  try {
    const ai = getAiClient(options.geminiApiKey);
    const imagePart = {
      inlineData: {
        mimeType: 'image/png',
        data: base64MaskedImage.split(',')[1],
      },
    };
    const textPart = { text: prompt };

    const response = await ai.models.generateContent({
      // FIX: Use the correct model for image editing.
      model: 'gemini-2.5-flash-image',
      contents: { parts: [imagePart, textPart] },
      config: {
        // FIX: responseModalities must be an array with a single Modality.IMAGE element for image editing.
        responseModalities: [Modality.IMAGE],
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const base64Data = part.inlineData.data;
        const mimeType = part.inlineData.mimeType || 'image/png';
        return `data:${mimeType};base64,${base64Data}`;
      }
    }

    throw new Error('No image was generated by the AI.');
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw new Error(`AI generation failed: ${getAiErrorDetails(error)}`);
  }
}

/**
 * Generates an image from a text prompt using the Imagen model.
 * @param prompt The text prompt describing the desired image.
 * @param aspectRatio The desired aspect ratio for the generated image.
 * @returns A base64 string of the newly generated image.
 */
export async function generateImageFromText(
  prompt: string,
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
  options: GeminiApiOptions = {},
): Promise<string> {
  try {
    const ai = getAiClient(options.geminiApiKey);
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/png',
        aspectRatio: aspectRatio,
      },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
      const base64ImageBytes: string = response.generatedImages[0].image.imageBytes;
      const mimeType = response.generatedImages[0].image.mimeType || 'image/png';
      return `data:${mimeType};base64,${base64ImageBytes}`;
    }

    throw new Error('No image was generated by the AI.');
  } catch (error) {
    console.error('Gemini API Error (Image Generation):', error);
    throw new Error(`AI image generation failed: ${getAiErrorDetails(error)}`);
  }
}

/**
 * Converts a base64 string into a File object.
 * @param base64 The base64 string of the image.
 * @param filename The desired filename for the new File object.
 * @returns A File object.
 */
export function base64ToFile(base64: string, filename: string): File {
  const mimeType = base64.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/png';
  const blob = base64ToBlob(base64, mimeType);
  return new File([blob], filename, { type: mimeType });
}

const generateTextResponseWithOllama = async (
  prompt: string,
  options: RoutedTextAiOptions,
): Promise<{ text: string; model: string }> => {
  const model = options.ollamaModel?.trim();
  if (!model) {
    throw new Error('Missing Ollama model. Set it in Preferences > Integrations.');
  }

  const response = await fetch(getOllamaApiEndpoint(options.ollamaEndpoint, 'chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.4,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${await readErrorResponse(response)}`);
  }

  const body = (await response.json()) as {
    model?: string;
    message?: { content?: string };
  };
  const text = body.message?.content?.trim() || '';
  if (!text) {
    throw new Error('Ollama returned an empty response.');
  }

  return {
    text,
    model: body.model?.trim() || model,
  };
};

/**
 * Calls Gemini to suggest creative inpainting prompts.
 * @returns An array of prompt suggestion strings.
 */
export async function getPromptSuggestions(options: RoutedTextAiOptions = {}): Promise<string[]> {
  try {
    const prompt =
      'Suggest 5 creative and short prompts for photo inpainting, where a part of the image is being replaced. Return only a JSON array of strings. Example: ["a majestic eagle", "a futuristic cityscape", "a portal to another dimension"].';
    const provider =
      options.provider === 'ollama'
        ? 'ollama'
        : options.provider === 'openai'
          ? 'openai'
          : 'gemini';
    const jsonStr =
      provider === 'ollama'
        ? (await generateTextResponseWithOllama(prompt, options)).text
        : provider === 'openai'
          ? (await generateOpenAiResponseText(prompt, options)).text
          : (
              await getAiClient(options.geminiApiKey).models.generateContent({
                model: options.geminiModel?.trim() || 'gemini-2.5-flash',
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.STRING,
                    },
                  },
                },
              })
            ).text.trim();
    const suggestions = JSON.parse(jsonStr) as string[];

    if (suggestions.length === 0) {
      // Fallback with more options
      return [
        'a beautiful sunset',
        'a field of wildflowers',
        'a distant galaxy',
        'a magical forest',
        'a hidden waterfall',
      ];
    }
    return suggestions;
  } catch (error) {
    console.error('Gemini Suggestion Error:', error);
    // Fallback prompts
    return [
      'a beautiful sunset',
      'a field of wildflowers',
      'a distant galaxy',
      'a magical forest',
      'a hidden waterfall',
    ];
  }
}

/**
 * Calls Gemini to enhance a user's prompt to be more descriptive.
 * @param currentPrompt The user-written prompt.
 * @returns An enhanced prompt string.
 */
export async function enhancePrompt(
  currentPrompt: string,
  options: RoutedTextAiOptions = {},
): Promise<string> {
  if (!currentPrompt.trim()) {
    return '';
  }
  try {
    const prompt = `You are a prompt enhancer for an AI image generator. Take the following user's prompt and make it more descriptive, vivid, and detailed to produce a better image. Keep the core subject but add artistic details. Return only the enhanced prompt. User prompt: "${currentPrompt}"`;
    const provider =
      options.provider === 'ollama'
        ? 'ollama'
        : options.provider === 'openai'
          ? 'openai'
          : 'gemini';
    if (provider === 'ollama') {
      return (await generateTextResponseWithOllama(prompt, options)).text;
    }
    if (provider === 'openai') {
      return (await generateOpenAiResponseText(prompt, options)).text;
    }
    const ai = getAiClient(options.geminiApiKey);
    const response = await ai.models.generateContent({
      model: options.geminiModel?.trim() || 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text.trim();
  } catch (error) {
    console.error('Gemini Enhance Error:', error);
    return currentPrompt; // Return original on error
  }
}

const parsePromptEnhancementResponse = (
  rawContent: string,
  currentPrompt: string,
): {
  message: string;
  options: string[];
  suggestions: string[];
} => {
  const normalizeSuggestionLabel = (value: string) => {
    const words = value
      .replace(/[.!?]+$/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return words.slice(0, 3).join(' ');
  };
  const normalizeStringList = (value: unknown, limit: number): string[] =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim())
          .slice(0, limit)
      : [];
  const normalizeSuggestionList = (value: unknown, limit: number): string[] =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => normalizeSuggestionLabel(entry))
          .filter(Boolean)
          .slice(0, limit)
      : [];

  try {
    const jsonValue = JSON.parse(extractJsonObject(rawContent)) as {
      message?: unknown;
      options?: unknown;
      suggestions?: unknown;
    };
    const options = normalizeStringList(jsonValue.options, 3);
    const suggestions = normalizeSuggestionList(jsonValue.suggestions, 3);
    if (options.length > 0) {
      return {
        message:
          typeof jsonValue.message === 'string' && jsonValue.message.trim().length > 0
            ? jsonValue.message.trim()
            : 'Choose an enhanced prompt, then tweak it if needed before applying it.',
        options,
        suggestions,
      };
    }
  } catch {
    // Fall back to line parsing below when the model returns prose instead of JSON.
  }

  const options = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => !/^message\s*:/i.test(line))
    .slice(0, 3);

  if (options.length > 0) {
    return {
      message: 'Choose an enhanced prompt, then tweak it if needed before applying it.',
      options,
      suggestions: [],
    };
  }

  const fallback = rawContent.trim() || currentPrompt;
  return {
    message: 'Review the enhanced prompt, adjust it if needed, then apply it when it feels right.',
    options: [fallback],
    suggestions: [],
  };
};

export async function generatePromptEnhancementResult(
  currentPrompt: string,
  options: PromptEnhancementOptions = {},
): Promise<PromptEnhancementResult> {
  const trimmedPrompt = currentPrompt.trim();
  if (!trimmedPrompt) {
    return {
      message: 'Add a prompt first, then ask the assistant to refine it.',
      options: [],
      suggestions: [],
      provider:
        options.provider === 'ollama'
          ? 'ollama'
          : options.provider === 'openai'
            ? 'openai'
            : 'gemini',
      model:
        options.provider === 'ollama'
          ? options.ollamaModel?.trim() || ''
          : options.provider === 'openai'
            ? options.openAiModel?.trim() || ''
            : options.geminiModel?.trim() || 'gemini-2.5-flash',
    };
  }

  const request =
    'You improve image-generation prompts. Return JSON with keys "message", "options", and "suggestions". ' +
    '"message" should be 1 or 2 short sentences that explain how the options differ and remind the user they can edit before applying. ' +
    '"options" should contain 1 to 3 enhanced prompt variants that preserve the original intent while improving specificity, composition, mood, and visual detail. ' +
    '"suggestions" should contain 2 or 3 compact keyword labels, each 2 or 3 words only, for follow-up directions. ' +
    (options.followUpInstruction?.trim()
      ? `Use the current prompt as the source and apply this follow-up request: "${options.followUpInstruction.trim()}". ` +
        `Current prompt: "${trimmedPrompt}"`
      : `Original prompt: "${trimmedPrompt}"`);
  const provider =
    options.provider === 'ollama' ? 'ollama' : options.provider === 'openai' ? 'openai' : 'gemini';

  try {
    if (provider === 'ollama') {
      const response = await generateTextResponseWithOllama(request, options);
      const parsed = parsePromptEnhancementResponse(response.text, trimmedPrompt);
      return {
        ...parsed,
        provider,
        model: response.model,
      };
    }

    if (provider === 'openai') {
      const response = await generateOpenAiResponseText(request, options);
      const parsed = parsePromptEnhancementResponse(response.text, trimmedPrompt);
      return {
        ...parsed,
        provider,
        model: response.model,
      };
    }

    const response = await getAiClient(options.geminiApiKey).models.generateContent({
      model: options.geminiModel?.trim() || 'gemini-2.5-flash',
      contents: request,
      config: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_PROMPT_ENHANCEMENT_RESPONSE_SCHEMA,
      },
    });
    const parsed = parsePromptEnhancementResponse(response.text.trim(), trimmedPrompt);
    return {
      ...parsed,
      provider,
      model: options.geminiModel?.trim() || 'gemini-2.5-flash',
    };
  } catch (error) {
    console.error('Prompt Enhancement Error:', error);
    const fallback = await enhancePrompt(trimmedPrompt, options);
    return {
      message:
        'Review the enhanced prompt, adjust it if needed, then apply it when it feels right.',
      options: [fallback || trimmedPrompt],
      suggestions: [],
      provider,
      model:
        provider === 'ollama'
          ? options.ollamaModel?.trim() || ''
          : provider === 'openai'
            ? options.openAiModel?.trim() || ''
            : options.geminiModel?.trim() || 'gemini-2.5-flash',
    };
  }
}

/**
 * Calls Gemini to suggest creative GLSL shader ideas.
 * @returns An array of prompt suggestion strings.
 */
export async function suggestShaderIdeas(options: RoutedTextAiOptions = {}): Promise<string[]> {
  try {
    const prompt =
      'Suggest 5 creative and short ideas for a GLSL fragment shader that processes an image. Return only a JSON array of strings. Example: ["a trippy watercolor effect", "old film grain and scratches", "a glowing neon edge detector"].';
    const provider =
      options.provider === 'ollama'
        ? 'ollama'
        : options.provider === 'openai'
          ? 'openai'
          : 'gemini';
    const jsonStr =
      provider === 'ollama'
        ? (await generateTextResponseWithOllama(prompt, options)).text
        : provider === 'openai'
          ? (await generateOpenAiResponseText(prompt, options)).text
          : (
              await getAiClient(options.geminiApiKey).models.generateContent({
                model: options.geminiModel?.trim() || 'gemini-2.5-flash',
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.STRING,
                    },
                  },
                },
              })
            ).text.trim();
    const suggestions = JSON.parse(jsonStr) as string[];

    if (suggestions.length === 0) {
      // Fallback with more options
      return [
        'a glitchy digital distortion',
        'a painterly oil effect',
        'a cinematic bloom',
        'a halftone dot pattern',
        'a dreamy, soft focus look',
      ];
    }
    return suggestions;
  } catch (error) {
    console.error('Gemini Shader Suggestion Error:', error);
    // Fallback prompts
    return [
      'a glitchy digital distortion',
      'a painterly oil effect',
      'a cinematic bloom',
      'a halftone dot pattern',
      'a dreamy, soft focus look',
    ];
  }
}

/**
 * Calls Gemini to enhance a user's shader prompt to be more descriptive.
 * @param currentPrompt The user-written prompt.
 * @returns An enhanced prompt string.
 */
export async function enhanceShaderPrompt(
  currentPrompt: string,
  options: RoutedTextAiOptions = {},
): Promise<string> {
  if (!currentPrompt.trim()) {
    return '';
  }
  try {
    const prompt = `You are a prompt enhancer for an AI shader generator. Take the following user's idea and make it more descriptive, vivid, and detailed to produce a better GLSL shader. Keep the core idea but add artistic and technical details. Return only the enhanced prompt. User prompt: "${currentPrompt}"`;
    const provider =
      options.provider === 'ollama'
        ? 'ollama'
        : options.provider === 'openai'
          ? 'openai'
          : 'gemini';
    if (provider === 'ollama') {
      return (await generateTextResponseWithOllama(prompt, options)).text;
    }
    if (provider === 'openai') {
      return (await generateOpenAiResponseText(prompt, options)).text;
    }
    const ai = getAiClient(options.geminiApiKey);
    const response = await ai.models.generateContent({
      model: options.geminiModel?.trim() || 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text.trim();
  } catch (error) {
    console.error('Gemini Enhance Shader Prompt Error:', error);
    return currentPrompt; // Return original on error
  }
}

const buildShaderGenerationPrompt = (
  prompt: string,
  options: GenerateShaderCodeOptions,
  repairContext?: {
    candidateShader?: string;
    validationErrors?: string[];
  },
) => {
  const history = options.history ?? [];
  const attachmentContext = getAiAttachmentTextContext(options.attachments);
  const serializedHistory = history
    .map((entry) => {
      const lines = [`${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`];
      if (entry.shaderCode?.trim()) {
        lines.push(`Shader snapshot:\n${entry.shaderCode}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return `You are Blackboard Studio's shader assistant.
You generate and revise fragment shaders for the app's Shader node.
Return a JSON object with these fields:
- "message": short assistant reply describing what changed
- "shaderCode": the full fragment shader code
- "suggestions": 2 or 3 short follow-up ideas for the next edit

The shader must be compatible with Blackboard Studio's WebGL2 fragment pipeline.
Follow these rules exactly:
- Write fragment shader code for GLSL 300 ES.
- Do NOT include a #version line.
- Include this boilerplate in the shader:
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_tDiffuse;
  out vec4 fragColor;
- Built-in optional temporal uniforms are available without JSON metadata:
  uniform float u_frame;
  uniform float u_time;
  uniform float u_fps;
- Built-in optional temporal texture ports are available when connected in the graph:
  uniform sampler2D u_tPreviousFrame;
  uniform sampler2D u_tNextFrame;
- Additional temporal texture ports can be declared with frame metadata:
  uniform sampler2D u_tFrameA; // {"label": "Frame -2", "type": "temporal", "mode": "relative", "frame": -2}
  uniform sampler2D u_tFrame100; // {"label": "Frame 100", "type": "temporal", "mode": "absolute", "frame": 100}
- Temporal texture ports can also use a user-editable numeric frame uniform:
  uniform sampler2D u_tRelativeFrame; // {"label": "Relative Frame", "type": "temporal", "mode": "relative", "frameUniform": "u_relativeFrame"}
  uniform int u_relativeFrame; // {"label": "Relative Frame", "type": "number", "step": 1, "value": -1}
- Use texture(...) instead of texture2D(...).
- Assign the final pixel color to fragColor, never gl_FragColor.
- Do not redeclare unrelated pipeline variables or invent extra entry points.
- Avoid helper/function names like luminance and variable names like half because they can collide with the renderer.
- Supported custom uniform types are only float, int, bool, vec2, and vec3.
- Every custom uniform MUST have inline JSON metadata on the same line for UI generation.
- vec3 uniforms are for color controls and should use metadata like:
  uniform vec3 u_tintColor; // {"label": "Tint Color", "type": "color", "value": [1.0, 0.8, 0.6]}
- bool uniforms are toggle controls and should use metadata like:
  uniform bool u_enabled; // {"label": "Enabled", "value": true}
- int/float uniforms can use segmented controls when they have options; string options map to numeric indexes, like:
  uniform int u_mode; // {"label": "Mode", "type": "segment", "value": 0, "options": [{"label": "Soft", "value": 0}, {"label": "Hard", "value": 1}]}
- int/float uniforms can use direct number input controls, like:
  uniform int u_relativeFrame; // {"label": "Relative Frame", "type": "number", "step": 1, "value": -1}
- float/int uniforms should use metadata like:
  uniform float u_intensity; // {"label": "Intensity", "min": 0.0, "max": 1.0, "step": 0.01, "value": 0.5}
- vec2 uniforms only work when label/min/max/step/value are arrays, like:
  uniform vec2 u_offset; // {"label": ["Offset X", "Offset Y"], "min": [-1.0, -1.0], "max": [1.0, 1.0], "step": [0.01, 0.01], "value": [0.0, 0.0]}
- Preserve useful uniforms and behavior from the current shader when the user is asking for an update instead of a fresh shader.

Node name: "${options.nodeName?.trim() || 'Shader'}"

Current shader:
${options.currentShader?.trim() ? options.currentShader : '(none yet)'}

${
  attachmentContext
    ? `Attached files:
${attachmentContext}`
    : 'Attached files: (none)'
}

${
  serializedHistory
    ? `Previous conversation:
${serializedHistory}`
    : 'Previous conversation: (none yet)'
}

${
  repairContext?.candidateShader?.trim()
    ? `Previous candidate that failed validation:
${repairContext.candidateShader}`
    : ''
}

${
  repairContext?.validationErrors?.length
    ? `Validation errors that must be fixed:
${repairContext.validationErrors.map((error) => `- ${error}`).join('\n')}`
    : ''
}

Latest user request: "${prompt}"

Return ONLY valid JSON. Do not wrap the JSON in markdown.`;
};

const buildAssistantChatPrompt = (prompt: string, options: GenerateAssistantChatOptions) => {
  const history = options.history ?? [];
  const attachmentContext = getAiAttachmentTextContext(options.attachments);
  const serializedHistory = history
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
    .join('\n\n');
  const modeInstruction =
    options.mode === 'action'
      ? 'A tool-enabled node is in focus. You can discuss safe action-oriented next steps, but never claim to have executed app tools or committed changes unless the app explicitly confirms it.'
      : options.mode === 'context'
        ? 'A node is in focus. Use that context when it helps, but keep the conversation assistive.'
        : 'No specific node is in focus. Answer as a general Blackboard Studio assistant.';

  return `You are Blackboard Studio's in-app assistant.
You help users understand nodes, suggest settings, troubleshoot workflows, and explain editing choices.

${modeInstruction}

Rules:
- Be concise, practical, and collaborative.
- If context is provided, reference it directly instead of speaking in generic terms.
- Clearly separate advice from actions the app could perform.
- Never claim that you changed the project, rendered a preview, inspected an image, or executed tools unless the app explicitly says that happened.
- If the request is ambiguous, explain the most likely interpretation instead of inventing hidden state.

Current context:
${options.contextSummary?.trim() || '(no node context attached)'}

${
  attachmentContext
    ? `Attached files:
${attachmentContext}`
    : 'Attached files: (none)'
}

${
  serializedHistory
    ? `Previous conversation:
${serializedHistory}`
    : 'Previous conversation: (none yet)'
}

Latest user request: "${prompt}"

Reply as plain text.`;
};

const buildStreamingShaderGenerationPrompt = (
  prompt: string,
  options: GenerateShaderCodeOptions,
) => {
  const history = options.history ?? [];
  const attachmentContext = getAiAttachmentTextContext(options.attachments);
  const serializedHistory = history
    .map((entry) => {
      const lines = [`${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`];
      if (entry.shaderCode?.trim()) {
        lines.push(`Shader snapshot:\n${entry.shaderCode}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return `You are Blackboard Studio's shader assistant.
You generate and revise fragment shaders for the app's Shader node.

The shader must be compatible with Blackboard Studio's WebGL2 fragment pipeline.
Follow these rules exactly:
- Write fragment shader code for GLSL 300 ES.
- Do NOT include a #version line.
- Include this boilerplate in the shader:
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_tDiffuse;
  out vec4 fragColor;
- Built-in optional temporal uniforms are available without JSON metadata:
  uniform float u_frame;
  uniform float u_time;
  uniform float u_fps;
- Built-in optional temporal texture ports are available when connected in the graph:
  uniform sampler2D u_tPreviousFrame;
  uniform sampler2D u_tNextFrame;
- Additional temporal texture ports can be declared with frame metadata:
  uniform sampler2D u_tFrameA; // {"label": "Frame -2", "type": "temporal", "mode": "relative", "frame": -2}
  uniform sampler2D u_tFrame100; // {"label": "Frame 100", "type": "temporal", "mode": "absolute", "frame": 100}
- Temporal texture ports can also use a user-editable numeric frame uniform:
  uniform sampler2D u_tRelativeFrame; // {"label": "Relative Frame", "type": "temporal", "mode": "relative", "frameUniform": "u_relativeFrame"}
  uniform int u_relativeFrame; // {"label": "Relative Frame", "type": "number", "step": 1, "value": -1}
- Use texture(...) instead of texture2D(...).
- Assign the final pixel color to fragColor, never gl_FragColor.
- Do not redeclare unrelated pipeline variables or invent extra entry points.
- Avoid helper/function names like luminance and variable names like half because they can collide with the renderer.
- Supported custom uniform types are only float, int, bool, vec2, and vec3.
- Every custom uniform MUST have inline JSON metadata on the same line for UI generation.
- vec3 uniforms are for color controls and should use metadata like:
  uniform vec3 u_tintColor; // {"label": "Tint Color", "type": "color", "value": [1.0, 0.8, 0.6]}
- bool uniforms are toggle controls and should use metadata like:
  uniform bool u_enabled; // {"label": "Enabled", "value": true}
- int/float uniforms can use segmented controls when they have options; string options map to numeric indexes, like:
  uniform int u_mode; // {"label": "Mode", "type": "segment", "value": 0, "options": [{"label": "Soft", "value": 0}, {"label": "Hard", "value": 1}]}
- int/float uniforms can use direct number input controls, like:
  uniform int u_relativeFrame; // {"label": "Relative Frame", "type": "number", "step": 1, "value": -1}
- float/int uniforms should use metadata like:
  uniform float u_intensity; // {"label": "Intensity", "min": 0.0, "max": 1.0, "step": 0.01, "value": 0.5}
- vec2 uniforms only work when label/min/max/step/value are arrays, like:
  uniform vec2 u_offset; // {"label": ["Offset X", "Offset Y"], "min": [-1.0, -1.0], "max": [1.0, 1.0], "step": [0.01, 0.01], "value": [0.0, 0.0]}
- Preserve useful uniforms and behavior from the current shader when the user is asking for an update instead of a fresh shader.

Node name: "${options.nodeName?.trim() || 'Shader'}"

Current shader:
${options.currentShader?.trim() ? options.currentShader : '(none yet)'}

${
  attachmentContext
    ? `Attached files:
${attachmentContext}`
    : 'Attached files: (none)'
}

${
  serializedHistory
    ? `Previous conversation:
${serializedHistory}`
    : 'Previous conversation: (none yet)'
}

Latest user request: "${prompt}"

Return plain text with exactly these sections and in this order:
MESSAGE:
<one short explanation of what you changed>

SHADER:
\`\`\`glsl
<full shader code>
\`\`\`

SUGGESTIONS:
- <short follow-up idea>
- <short follow-up idea>

Do not return JSON.
Do not add extra section headings.
Do not omit the SHADER section.`;
};

const cleanGeneratedShaderCode = (code: string): string => {
  let normalizedCode = code.trim();

  if (normalizedCode.startsWith('```')) {
    normalizedCode = normalizedCode.replace(/^```[a-zA-Z0-9_-]*\s*/, '');
  }
  if (normalizedCode.endsWith('```')) {
    normalizedCode = normalizedCode.replace(/\s*```$/, '');
  }

  normalizedCode = normalizedCode.replace(/^\s*#version\s+300\s+es\s*\n+/i, '');
  normalizedCode = normalizedCode.replace(/^\s*#version\s+[^\n]*\n+/i, '');

  return normalizedCode.trim();
};

export const validateGeneratedShaderCode = (code: string): { valid: boolean; errors: string[] } => {
  const normalizedCode = cleanGeneratedShaderCode(code);
  const errors: string[] = [];
  const builtInSamplerUniforms = new Set(['u_tDiffuse', 'u_tPreviousFrame', 'u_tNextFrame']);
  const builtInScalarUniformTypes: Record<string, string> = {
    u_frame: 'float',
    u_time: 'float',
    u_fps: 'float',
  };

  if (!normalizedCode.trim()) {
    errors.push('The shader code is empty.');
  }
  if (normalizedCode.includes('```')) {
    errors.push('Do not wrap the shader in markdown fences.');
  }
  if (/#version\b/i.test(normalizedCode)) {
    errors.push('Do not include a #version line.');
  }
  if (!/precision\s+highp\s+float\s*;/i.test(normalizedCode)) {
    errors.push('Include `precision highp float;`.');
  }
  if (!/\bin\s+vec2\s+v_uv\s*;/i.test(normalizedCode)) {
    errors.push('Include `in vec2 v_uv;`.');
  }
  if (!/\buniform\s+sampler2D\s+u_tDiffuse\s*;/i.test(normalizedCode)) {
    errors.push('Include `uniform sampler2D u_tDiffuse;`.');
  }
  if (!/\bout\s+vec4\s+fragColor\s*;/i.test(normalizedCode)) {
    errors.push('Include `out vec4 fragColor;`.');
  }
  if (!/\bvoid\s+main\s*\(/i.test(normalizedCode)) {
    errors.push('Include a `void main()` entry point.');
  }
  if (!/\bfragColor\s*=/.test(normalizedCode)) {
    errors.push('Assign the final color to `fragColor`.');
  }
  if (/\bgl_FragColor\b/.test(normalizedCode)) {
    errors.push('Use `fragColor`, not `gl_FragColor`.');
  }
  if (/\btexture2D\s*\(/.test(normalizedCode)) {
    errors.push('Use `texture(...)`, not `texture2D(...)`.');
  }

  const uniformRegex =
    /^\s*uniform\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*(\[\s*\d+\s*\])?\s*;\s*(?:\/\/\s*(\{.*\})\s*)?$/gm;
  let uniformMatch: RegExpExecArray | null;
  while ((uniformMatch = uniformRegex.exec(normalizedCode)) !== null) {
    const [, uniformType, uniformName, , metadataText] = uniformMatch;

    if (uniformType === 'sampler2D') {
      if (builtInSamplerUniforms.has(uniformName)) {
        continue;
      }

      if (!metadataText) {
        errors.push(
          `Sampler uniform \`${uniformName}\` must use temporal frame metadata or one of the built-in sampler names.`,
        );
        continue;
      }

      try {
        const metadata = JSON.parse(metadataText) as Record<string, unknown>;
        if (metadata.type !== 'temporal' && metadata.type !== 'frame') {
          errors.push(`Sampler uniform \`${uniformName}\` must use temporal frame metadata.`);
        }
        if (
          metadata.mode !== undefined &&
          metadata.mode !== 'relative' &&
          metadata.mode !== 'absolute'
        ) {
          errors.push(`Sampler uniform \`${uniformName}\` mode must be "relative" or "absolute".`);
        }
        const hasNumericFrame =
          typeof metadata.frame === 'number' && Number.isFinite(metadata.frame);
        const hasFrameUniform =
          typeof metadata.frameUniform === 'string' ||
          typeof metadata.frameOffsetUniform === 'string' ||
          typeof metadata.absoluteFrameUniform === 'string';
        if (!hasNumericFrame && !hasFrameUniform) {
          errors.push(
            `Sampler uniform \`${uniformName}\` must include a numeric frame value or frameUniform.`,
          );
        }
      } catch {
        errors.push(`Sampler uniform \`${uniformName}\` has invalid JSON metadata.`);
      }
      continue;
    }

    const builtInScalarType = builtInScalarUniformTypes[uniformName];
    if (builtInScalarType) {
      if (uniformType !== builtInScalarType) {
        errors.push(
          `Built-in uniform \`${uniformName}\` must be declared as ${builtInScalarType}.`,
        );
      }
      continue;
    }

    if (!['float', 'int', 'bool', 'vec2', 'vec3'].includes(uniformType)) {
      errors.push(
        `Unsupported uniform type \`${uniformType}\` on \`${uniformName}\`. Use float, int, bool, vec2, or vec3.`,
      );
      continue;
    }

    if (!metadataText) {
      errors.push(`Uniform \`${uniformName}\` is missing inline JSON metadata.`);
      continue;
    }

    try {
      const metadata = JSON.parse(metadataText) as Record<string, unknown>;
      if (uniformType === 'vec3' && metadata.type !== 'color') {
        errors.push(`vec3 uniform \`${uniformName}\` must use color metadata.`);
      }
      if (
        uniformType === 'bool' &&
        metadata.value !== undefined &&
        typeof metadata.value !== 'boolean'
      ) {
        errors.push(`bool uniform \`${uniformName}\` must use a boolean value.`);
      }
      if (
        (uniformType === 'float' || uniformType === 'int') &&
        (metadata.type === 'segment' || metadata.type === 'segmented')
      ) {
        const options = metadata.options;
        if (!Array.isArray(options) || options.length < 2) {
          errors.push(`Segment uniform \`${uniformName}\` must include at least two options.`);
        } else {
          const hasValidOptions = options.every((option) => {
            if (typeof option === 'string' || typeof option === 'number') {
              return true;
            }
            if (!option || typeof option !== 'object') {
              return false;
            }
            const value = (option as Record<string, unknown>).value;
            return value === undefined || typeof value === 'number';
          });
          if (!hasValidOptions) {
            errors.push(
              `Segment uniform \`${uniformName}\` options must be strings, numbers, or objects with numeric value fields.`,
            );
          }
        }
      }
      if (uniformType === 'vec2') {
        const vectorKeys = ['label', 'min', 'max', 'step', 'value'] as const;
        const hasVectorMetadata = vectorKeys.every(
          (key) => Array.isArray(metadata[key]) && (metadata[key] as unknown[]).length === 2,
        );
        if (!hasVectorMetadata) {
          errors.push(
            `vec2 uniform \`${uniformName}\` must use 2-item array metadata for label/min/max/step/value.`,
          );
        }
      }
    } catch {
      errors.push(`Uniform \`${uniformName}\` has invalid JSON metadata.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
  };
};

const getOllamaApiBase = (endpoint: string | undefined): string => {
  const normalizedEndpoint = (endpoint || 'http://localhost:11434').trim().replace(/\/+$/, '');

  if (!normalizedEndpoint) {
    throw new Error('Missing Ollama endpoint. Configure it in Preferences > AI.');
  }
  if (
    normalizedEndpoint.endsWith('/api/chat') ||
    normalizedEndpoint.endsWith('/api/tags') ||
    normalizedEndpoint.endsWith('/api/show')
  ) {
    return normalizedEndpoint.replace(/\/[^/]+$/, '');
  }
  if (normalizedEndpoint.endsWith('/api')) {
    return normalizedEndpoint;
  }
  return `${normalizedEndpoint}/api`;
};

const getOllamaApiEndpoint = (
  endpoint: string | undefined,
  path: 'chat' | 'tags' | 'show',
): string => `${getOllamaApiBase(endpoint)}/${path}`;

const getResponseHeader = (response: Response, headerName: string): string => {
  const headers = response.headers as Headers | undefined;
  return typeof headers?.get === 'function' ? (headers.get(headerName) ?? '') : '';
};

const getOllamaBrowserEndpoint = (endpoint: string | undefined): string => {
  const normalizedEndpoint = (endpoint || 'http://localhost:11434').trim().replace(/\/+$/, '');
  if (!normalizedEndpoint) {
    return 'http://localhost:11434';
  }

  return normalizedEndpoint.replace(/\/api(?:\/(?:chat|tags|show))?$/, '') || normalizedEndpoint;
};

const getOllamaAuthenticationUrl = (endpoint: string | undefined, response?: Response): string => {
  if (typeof response?.url === 'string' && response.url.trim()) {
    return response.url.trim();
  }

  return getOllamaBrowserEndpoint(endpoint);
};

const normalizeUrlPath = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
};

const isLikelyOllamaAuthRedirect = (requestedUrl: string, response: Response): boolean => {
  if (!response.redirected || typeof response.url !== 'string' || !response.url.trim()) {
    return false;
  }

  const requestedPath = normalizeUrlPath(requestedUrl);
  const responsePath = normalizeUrlPath(response.url);

  return !!requestedPath && !!responsePath && requestedPath !== responsePath;
};

const throwOllamaAuthenticationRequired = (
  endpoint: string | undefined,
  response?: Response,
  message?: string,
): never => {
  throw new OllamaAuthenticationRequiredError(
    getOllamaAuthenticationUrl(endpoint, response),
    message,
  );
};

const OLLAMA_SHADER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    shaderCode: { type: 'string' },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['message', 'shaderCode'],
};

const GEMINI_SHADER_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    message: { type: Type.STRING },
    shaderCode: { type: Type.STRING },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['message', 'shaderCode'],
};

const extractJsonObject = (value: string): string => {
  const trimmedValue = value.trim();
  const fencedMatch = trimmedValue.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmedValue.indexOf('{');
  const lastBrace = trimmedValue.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmedValue.slice(firstBrace, lastBrace + 1);
  }

  return trimmedValue;
};

const parseStructuredShaderResponse = (
  rawContent: string,
): {
  message: string;
  shaderCode: string;
  suggestions: string[];
} => {
  let jsonValue: {
    message?: unknown;
    shaderCode?: unknown;
    suggestions?: unknown;
  };

  try {
    jsonValue = JSON.parse(rawContent.trim()) as {
      message?: unknown;
      shaderCode?: unknown;
      suggestions?: unknown;
    };
  } catch {
    jsonValue = JSON.parse(extractJsonObject(rawContent)) as {
      message?: unknown;
      shaderCode?: unknown;
      suggestions?: unknown;
    };
  }

  const message =
    typeof jsonValue.message === 'string' && jsonValue.message.trim()
      ? jsonValue.message.trim()
      : 'Updated the shader.';
  const shaderCode =
    typeof jsonValue.shaderCode === 'string' && jsonValue.shaderCode.trim()
      ? jsonValue.shaderCode
      : '';
  const suggestions = Array.isArray(jsonValue.suggestions)
    ? jsonValue.suggestions
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
        .slice(0, 3)
    : [];

  if (!shaderCode.trim()) {
    throw new Error('The AI response did not include shaderCode.');
  }

  return { message, shaderCode, suggestions };
};

const parseStreamedShaderResponse = (
  rawContent: string,
): {
  message: string;
  shaderCode: string;
  suggestions: string[];
} => {
  const normalizedContent = rawContent.replace(/\r\n/g, '\n');
  const upperContent = normalizedContent.toUpperCase();
  const messageMarkerIndex = upperContent.indexOf('MESSAGE:');
  const shaderMarkerIndex = upperContent.indexOf('SHADER:');
  const suggestionsMarkerIndex = upperContent.indexOf('SUGGESTIONS:');

  const rawMessage =
    shaderMarkerIndex !== -1
      ? normalizedContent
          .slice(
            messageMarkerIndex !== -1 ? messageMarkerIndex + 'MESSAGE:'.length : 0,
            shaderMarkerIndex,
          )
          .trim()
      : messageMarkerIndex !== -1
        ? normalizedContent.slice(messageMarkerIndex + 'MESSAGE:'.length).trim()
        : normalizedContent.trim();

  const rawShader =
    shaderMarkerIndex !== -1
      ? normalizedContent
          .slice(
            shaderMarkerIndex + 'SHADER:'.length,
            suggestionsMarkerIndex !== -1 ? suggestionsMarkerIndex : normalizedContent.length,
          )
          .trim()
      : '';

  const shaderCode = cleanGeneratedShaderCode(rawShader);
  const suggestionsSection =
    suggestionsMarkerIndex !== -1
      ? normalizedContent.slice(suggestionsMarkerIndex + 'SUGGESTIONS:'.length).trim()
      : '';
  const suggestions = suggestionsSection
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);

  return {
    message: rawMessage,
    shaderCode,
    suggestions,
  };
};

type OllamaChatChunk = {
  model?: string;
  done?: boolean;
  error?: string;
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
      function?: {
        name?: string;
        arguments?: Record<string, unknown> | string;
      };
    }>;
  };
};

export const readOllamaNdjsonStream = async (
  response: Response,
  onChunk: (chunk: OllamaChatChunk) => void,
): Promise<void> => {
  if (!response.body) {
    throw new Error('AI shader generation failed: Ollama returned no response stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        onChunk(JSON.parse(line) as OllamaChatChunk);
      }

      newlineIndex = buffer.indexOf('\n');
    }

    if (done) {
      break;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    onChunk(JSON.parse(tail) as OllamaChatChunk);
  }
};

export const readErrorResponse = async (response: Response): Promise<string> => {
  try {
    const errorBody = (await response.json()) as { error?: string; message?: string };
    if (typeof errorBody.error === 'string' && errorBody.error.trim()) {
      return errorBody.error.trim();
    }
    if (typeof errorBody.message === 'string' && errorBody.message.trim()) {
      return errorBody.message.trim();
    }
  } catch {
    // Ignore JSON parsing errors and fall through to response.text().
  }

  try {
    const text = await response.text();
    if (text.trim()) {
      return text.trim();
    }
  } catch {
    // Ignore body read errors and fall back to status text.
  }

  return `${response.status} ${response.statusText}`.trim();
};

const normalizeOllamaCapabilities = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seen = new Set<string>();
  const capabilities = value.flatMap((entry) => {
    if (typeof entry !== 'string') {
      return [];
    }

    const normalized = entry.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [normalized];
  });

  return capabilities.length > 0 ? capabilities : undefined;
};

const loadOllamaModelCapabilities = async (
  endpoint: string | undefined,
  model: string,
  options: { signal?: AbortSignal } = {},
): Promise<string[] | undefined> => {
  const response = await fetch(getOllamaApiEndpoint(endpoint, 'show'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  const body = (await response.json()) as { capabilities?: unknown };
  return normalizeOllamaCapabilities(body.capabilities);
};

export async function listOllamaModels(
  endpoint: string | undefined,
  options: { signal?: AbortSignal } = {},
): Promise<OllamaModelSummary[]> {
  const requestUrl = getOllamaApiEndpoint(endpoint, 'tags');
  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  });

  if (response.status === 401 || response.status === 403) {
    throwOllamaAuthenticationRequired(
      endpoint,
      response,
      'Ollama endpoint requires authentication. Open the endpoint, sign in, then check again.',
    );
  }

  if (isLikelyOllamaAuthRedirect(requestUrl, response)) {
    throwOllamaAuthenticationRequired(
      endpoint,
      response,
      'Ollama endpoint redirected to an authentication page. Open it, sign in, then check again.',
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to load Ollama models: ${await readErrorResponse(response)}`);
  }

  const responseContentType = getResponseHeader(response, 'content-type').toLowerCase();
  if (
    responseContentType &&
    !responseContentType.includes('application/json') &&
    !responseContentType.includes('+json') &&
    responseContentType.includes('text/html')
  ) {
    throwOllamaAuthenticationRequired(
      endpoint,
      response,
      'Ollama endpoint returned a browser page instead of the model list. Open it, sign in if prompted, then check again.',
    );
  }

  let body: {
    models?: Array<{
      name?: string;
      model?: string;
      modified_at?: string;
      size?: number;
      capabilities?: unknown;
      details?: OllamaModelSummary['details'];
    }>;
  };

  try {
    body = (await response.json()) as typeof body;
  } catch (error) {
    if (responseContentType.includes('text/html')) {
      throwOllamaAuthenticationRequired(
        endpoint,
        response,
        'Ollama endpoint returned a browser page instead of the model list. Open it, sign in if prompted, then check again.',
      );
    }

    throw error;
  }

  if (!Array.isArray(body.models)) {
    return [];
  }

  const models = body.models.flatMap((model) => {
    const modelId =
      typeof model.model === 'string' && model.model.trim()
        ? model.model.trim()
        : typeof model.name === 'string' && model.name.trim()
          ? model.name.trim()
          : '';

    if (!modelId) {
      return [];
    }

    return [
      {
        name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : modelId,
        model: modelId,
        modifiedAt:
          typeof model.modified_at === 'string' && model.modified_at.trim()
            ? model.modified_at
            : undefined,
        size: typeof model.size === 'number' ? model.size : undefined,
        capabilities: normalizeOllamaCapabilities(model.capabilities),
        details: model.details,
      } satisfies OllamaModelSummary,
    ];
  });

  return Promise.all(
    models.map(async (model) => {
      if (model.capabilities?.length) {
        return model;
      }

      try {
        const capabilities = await loadOllamaModelCapabilities(endpoint, model.model, options);
        return capabilities?.length ? { ...model, capabilities } : model;
      } catch {
        return model;
      }
    }),
  );
}

const generateShaderResponseWithOllama = async (
  prompt: string,
  options: GenerateShaderCodeOptions,
  repairContext?: {
    candidateShader?: string;
    validationErrors?: string[];
  },
): Promise<{
  message: string;
  shaderCode: string;
  suggestions: string[];
  model: string;
}> => {
  const model = options.ollamaModel?.trim();
  if (!model) {
    throw new Error(
      'Missing Ollama model for shader generation. Configure it in Preferences > AI.',
    );
  }

  const response = await fetch(getOllamaApiEndpoint(options.ollamaEndpoint, 'chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: OLLAMA_SHADER_RESPONSE_SCHEMA,
      messages: [
        {
          role: 'system',
          content:
            "You are Blackboard Studio's shader assistant. Always return valid JSON that matches the provided schema.",
        },
        ...((options.history ?? []).map((entry) => ({
          role: entry.role,
          content: [
            entry.content.trim(),
            entry.shaderCode?.trim() ? `Shader snapshot:\n${entry.shaderCode}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        })) as Array<{ role: 'user' | 'assistant'; content: string }>),
        buildOllamaUserMessage(
          buildShaderGenerationPrompt(prompt, options, repairContext),
          options.attachments,
        ),
      ],
      options: {
        temperature: 0.2,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`AI shader generation failed: ${await readErrorResponse(response)}`);
  }

  const body = (await response.json()) as {
    message?: { content?: string };
    response?: string;
  };
  const content =
    typeof body.message?.content === 'string'
      ? body.message.content
      : typeof body.response === 'string'
        ? body.response
        : '';

  if (!content.trim()) {
    throw new Error('AI shader generation failed: Ollama returned no shader code.');
  }

  return {
    ...parseStructuredShaderResponse(content),
    model,
  };
};

const streamShaderResponseWithOllama = async (
  prompt: string,
  options: GenerateShaderCodeOptions,
): Promise<{
  message: string;
  shaderCode: string;
  suggestions: string[];
  model: string;
  thinking: string;
}> => {
  const model = options.ollamaModel?.trim();
  if (!model) {
    throw new Error(
      'Missing Ollama model for shader generation. Configure it in Preferences > AI.',
    );
  }

  const response = await fetch(getOllamaApiEndpoint(options.ollamaEndpoint, 'chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: true,
      think: options.enableThinking ?? true,
      messages: [
        {
          role: 'system',
          content:
            "You are Blackboard Studio's shader assistant. Follow the requested section format exactly.",
        },
        ...((options.history ?? []).map((entry) => ({
          role: entry.role,
          content: [
            entry.content.trim(),
            entry.shaderCode?.trim() ? `Shader snapshot:\n${entry.shaderCode}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        })) as Array<{ role: 'user' | 'assistant'; content: string }>),
        buildOllamaUserMessage(
          buildStreamingShaderGenerationPrompt(prompt, options),
          options.attachments,
        ),
      ],
      options: {
        temperature: 0.2,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`AI shader generation failed: ${await readErrorResponse(response)}`);
  }

  let accumulatedThinking = '';
  let accumulatedContent = '';
  let isThinking = false;

  await readOllamaNdjsonStream(response, (chunk) => {
    if (chunk.error) {
      throw new Error(chunk.error);
    }

    const thinkingChunk = chunk.message?.thinking ?? '';
    const contentChunk = chunk.message?.content ?? '';
    accumulatedThinking += thinkingChunk;
    accumulatedContent += contentChunk;
    if (thinkingChunk) {
      isThinking = true;
    } else if (contentChunk) {
      isThinking = false;
    }

    const parsedPreview = parseStreamedShaderResponse(accumulatedContent);
    options.onStreamUpdate?.({
      stage: 'streaming',
      provider: 'ollama',
      model: chunk.model?.trim() || model,
      content: parsedPreview.message,
      thinking: accumulatedThinking,
      isThinking,
      shaderCode: parsedPreview.shaderCode,
      suggestions: parsedPreview.suggestions,
    });
  });

  const parsedResponse = parseStreamedShaderResponse(accumulatedContent);
  if (!parsedResponse.shaderCode.trim()) {
    throw new Error('AI shader generation failed: Ollama returned no shader code.');
  }

  return {
    ...parsedResponse,
    model,
    thinking: accumulatedThinking,
  };
};

const streamAssistantResponseWithOllama = async (
  prompt: string,
  options: GenerateAssistantChatOptions,
): Promise<AssistantChatResult> => {
  const model = options.ollamaModel?.trim();
  if (!model) {
    throw new Error('Missing Ollama model for assistant chat. Configure it in Preferences > AI.');
  }

  const response = await fetch(getOllamaApiEndpoint(options.ollamaEndpoint, 'chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: true,
      think: options.enableThinking ?? true,
      messages: [
        buildOllamaUserMessage(buildAssistantChatPrompt(prompt, options), options.attachments),
      ],
      options: {
        temperature: 0.3,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`AI assistant chat failed: ${await readErrorResponse(response)}`);
  }

  let accumulatedThinking = '';
  let accumulatedContent = '';
  let responseModel = model;
  let isThinking = false;

  await readOllamaNdjsonStream(response, (chunk) => {
    if (chunk.error) {
      throw new Error(chunk.error);
    }

    responseModel = chunk.model?.trim() || responseModel;
    const thinkingChunk = chunk.message?.thinking ?? '';
    const contentChunk = chunk.message?.content ?? '';
    accumulatedThinking += thinkingChunk;
    accumulatedContent += contentChunk;
    if (thinkingChunk) {
      isThinking = true;
    } else if (contentChunk) {
      isThinking = false;
    }

    options.onStreamUpdate?.({
      stage: 'streaming',
      provider: 'ollama',
      model: responseModel,
      content: accumulatedContent.trim(),
      thinking: accumulatedThinking,
      isThinking,
    });
  });

  const content = accumulatedContent.trim();
  if (!content) {
    throw new Error('AI assistant chat failed: Ollama returned an empty response.');
  }

  options.onStreamUpdate?.({
    stage: 'complete',
    provider: 'ollama',
    model: responseModel,
    content,
    thinking: accumulatedThinking,
    isThinking: false,
  });

  return {
    message: content,
    provider: 'ollama',
    model: responseModel,
    thinking: accumulatedThinking.trim() || undefined,
  };
};

const generateShaderResponseWithGemini = async (
  prompt: string,
  options: GenerateShaderCodeOptions,
  repairContext?: {
    candidateShader?: string;
    validationErrors?: string[];
  },
): Promise<{
  message: string;
  shaderCode: string;
  suggestions: string[];
  model: string;
}> => {
  const model = options.geminiModel?.trim() || 'gemini-2.5-flash';
  const ai = getAiClient(options.geminiApiKey);
  const response = await ai.models.generateContent({
    model,
    contents: buildGeminiContents(
      buildShaderGenerationPrompt(prompt, options, repairContext),
      options.attachments,
    ),
    config: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_SHADER_RESPONSE_SCHEMA,
    },
  });

  return {
    ...parseStructuredShaderResponse(response.text),
    model,
  };
};

const generateShaderResponseWithOpenAi = async (
  prompt: string,
  options: GenerateShaderCodeOptions,
  repairContext?: {
    candidateShader?: string;
    validationErrors?: string[];
  },
): Promise<{
  message: string;
  shaderCode: string;
  suggestions: string[];
  model: string;
}> => {
  const response = await generateOpenAiResponseText(
    buildShaderGenerationPrompt(prompt, options, repairContext),
    {
      openAiApiKey: options.openAiApiKey,
      openAiBaseUrl: options.openAiBaseUrl,
      openAiModel: options.openAiModel,
      attachments: options.attachments,
      signal: options.signal,
    },
  );

  return {
    ...parseStructuredShaderResponse(response.text),
    model: response.model,
  };
};

export async function generateShaderChatTurn(
  prompt: string,
  options: GenerateShaderCodeOptions = {},
): Promise<ShaderGenerationResult> {
  let repairErrors: string[] = [];
  let repairCandidate: string | undefined;
  const provider =
    options.provider === 'ollama' ? 'ollama' : options.provider === 'openai' ? 'openai' : 'gemini';
  let streamedThinking = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const shouldUseStreamingOllama =
      provider === 'ollama' && typeof options.onStreamUpdate === 'function' && attempt === 0;
    const response = shouldUseStreamingOllama
      ? await streamShaderResponseWithOllama(prompt, options)
      : provider === 'ollama'
        ? await generateShaderResponseWithOllama(prompt, options, {
            candidateShader: repairCandidate,
            validationErrors: repairErrors,
          })
        : provider === 'openai'
          ? await generateShaderResponseWithOpenAi(prompt, options, {
              candidateShader: repairCandidate,
              validationErrors: repairErrors,
            })
          : await generateShaderResponseWithGemini(prompt, options, {
              candidateShader: repairCandidate,
              validationErrors: repairErrors,
            });

    const shaderCode = cleanGeneratedShaderCode(response.shaderCode);
    const validation = validateGeneratedShaderCode(shaderCode);
    const nextThinking =
      'thinking' in response && typeof response.thinking === 'string' ? response.thinking : '';
    streamedThinking = nextThinking || streamedThinking;
    if (validation.valid) {
      const result: ShaderGenerationResult = {
        message: response.message,
        shaderCode,
        suggestions: response.suggestions,
        provider,
        model: response.model,
        validationErrors: [],
      };

      if (streamedThinking.trim()) {
        result.thinking = streamedThinking;
      }

      if (provider === 'ollama') {
        options.onStreamUpdate?.({
          stage: 'complete',
          provider: 'ollama',
          model: response.model,
          content: result.message,
          thinking: streamedThinking,
          isThinking: false,
          shaderCode,
          suggestions: response.suggestions,
        });
      }

      return result;
    }

    repairErrors = validation.errors;
    repairCandidate = shaderCode;

    if (provider === 'ollama') {
      options.onStreamUpdate?.({
        stage: 'repairing',
        provider: 'ollama',
        model: response.model,
        content: 'Repairing the shader to match Blackboard Studio’s pipeline rules...',
        thinking: streamedThinking,
        isThinking: false,
        shaderCode,
        suggestions: response.suggestions,
      });
    }
  }

  throw new Error(
    `AI shader generation failed validation: ${repairErrors.join(' ') || 'Unknown shader issue.'}`,
  );
}

/**
 * Generates GLSL fragment shader code from a text prompt.
 * @param prompt The text prompt describing the desired shader effect.
 * @returns A string containing the GLSL code.
 */
export async function generateShaderCode(
  prompt: string,
  options: GenerateShaderCodeOptions = {},
): Promise<string> {
  try {
    const result = await generateShaderChatTurn(prompt, options);
    return result.shaderCode;
  } catch (error) {
    console.error('Shader Generation Error:', error);
    throw new Error(`AI shader generation failed: ${getAiErrorDetails(error)}`);
  }
}

export async function generateAssistantChatTurn(
  prompt: string,
  options: GenerateAssistantChatOptions = {},
): Promise<AssistantChatResult> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt && !options.attachments?.length) {
    throw new Error('Missing assistant prompt.');
  }
  const requestPrompt = trimmedPrompt || 'Please review the attached file(s).';

  const provider =
    options.provider === 'ollama' ? 'ollama' : options.provider === 'openai' ? 'openai' : 'gemini';

  try {
    if (provider === 'ollama') {
      const model = options.ollamaModel?.trim();
      if (!model) {
        throw new Error(
          'Missing Ollama model for assistant chat. Configure it in Preferences > AI.',
        );
      }

      if (typeof options.onStreamUpdate === 'function') {
        return streamAssistantResponseWithOllama(requestPrompt, options);
      }

      const response = await fetch(getOllamaApiEndpoint(options.ollamaEndpoint, 'chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            buildOllamaUserMessage(
              buildAssistantChatPrompt(requestPrompt, options),
              options.attachments,
            ),
          ],
          options: {
            temperature: 0.3,
          },
        }),
        signal: options.signal,
      });

      if (!response.ok) {
        throw new Error(`AI assistant chat failed: ${await readErrorResponse(response)}`);
      }

      const body = (await response.json()) as {
        model?: string;
        message?: {
          content?: string;
          thinking?: string;
        };
      };

      const content = body.message?.content?.trim();
      if (!content) {
        throw new Error('AI assistant chat failed: Ollama returned an empty response.');
      }

      return {
        message: content,
        provider: 'ollama',
        model: body.model?.trim() || model,
        thinking: body.message?.thinking?.trim() || undefined,
      };
    }

    if (provider === 'openai') {
      const response = await generateOpenAiResponseText(
        buildAssistantChatPrompt(requestPrompt, options),
        {
          openAiApiKey: options.openAiApiKey,
          openAiBaseUrl: options.openAiBaseUrl,
          openAiModel: options.openAiModel,
          attachments: options.attachments,
          signal: options.signal,
        },
      );

      return {
        message: response.text,
        provider: 'openai',
        model: response.model,
      };
    }

    const model = options.geminiModel?.trim() || 'gemini-2.5-flash';
    const ai = getAiClient(options.geminiApiKey);
    const response = await ai.models.generateContent({
      model,
      contents: buildGeminiContents(
        buildAssistantChatPrompt(requestPrompt, options),
        options.attachments,
      ),
    });

    const content = response.text.trim();
    if (!content) {
      throw new Error('AI assistant chat failed: Gemini returned an empty response.');
    }

    return {
      message: content,
      provider: 'gemini',
      model,
    };
  } catch (error) {
    console.error('Assistant Chat Error:', error);
    throw new Error(`AI assistant chat failed: ${getAiErrorDetails(error)}`);
  }
}
