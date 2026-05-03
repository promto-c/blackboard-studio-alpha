import React, { useState, useEffect, useMemo } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { ImageNode, NodeType } from '@blackboard/types';
import { getPromptSuggestions, enhancePrompt, hasGeminiApiKey } from '@/utils/ai';
import { getAiTaskRouteError, resolveAiTaskRoute } from '@/utils/aiRouting';
import { getAsset } from '@/state/assetStorage';
import AiVariantPreview from './AiVariantPreview';
import SourceImagePreview from './SourceImagePreview';
import { ScrollArea } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';

const Spinner: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg
    className={`animate-spin ${className} text-white`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const promptToolButtonClass =
  'inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 transition hover:bg-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

const AiAdjustments: React.FC<{ node: ImageNode }> = ({ node }) => {
  const aiEditingNodeId = useEditorSelector((s) => s.aiEditingNodeId);
  const allNodes = useEditorSelector((s) => s.nodes);
  const aiGenerationQueue = useEditorSelector((s) => s.aiGenerationQueue);
  const isAiCurrentlyGenerating = useEditorSelector((s) => s.isAiCurrentlyGenerating);
  const {
    startAiEditing,
    stopAiEditing,
    addAiTaskToQueue,
    setAiNodeError,
    setActiveVariant,
    setAiSourceNode,
  } = useEditorActions();
  const { geminiApiKey, openAiApiKey, openAiBaseUrl, ollamaEndpoint, aiTaskRoutes } =
    usePreferences();

  const sourceNode = allNodes.find(
    (candidate) => candidate.id === node.aiMetadata?.sourceNodeId,
  ) as ImageNode | undefined;
  const isTextToImage = !node.aiMetadata?.sourceNodeId;

  const potentialSourceNodes = useMemo(
    () =>
      allNodes.filter(
        (node) => node.type === NodeType.IMAGE && !(node as ImageNode).aiMetadata,
      ) as ImageNode[],
    [allNodes],
  );

  const queuePositions = useMemo(() => {
    const taskPositions: { [taskId: string]: number } = {};
    if (!node.aiMetadata) return taskPositions;

    aiGenerationQueue.forEach((task, index) => {
      if (task.nodeId === node.id) {
        taskPositions[task.taskId] = index + 1;
      }
    });
    return taskPositions;
  }, [aiGenerationQueue, node.id, node.aiMetadata]);

  const [prompt, setPrompt] = useState(node.aiMetadata?.prompt || '');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [outputSizeOption, setOutputSizeOption] = useState('1:1');
  const isEditing = aiEditingNodeId === node.id;

  const isQueueActive = aiGenerationQueue.length > 0 || isAiCurrentlyGenerating;
  const imagePromptRouteError = getAiTaskRouteError('imagePromptTools', {
    aiTaskRoutes,
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
  });
  const imagePromptRoute = imagePromptRouteError
    ? null
    : resolveAiTaskRoute('imagePromptTools', {
        aiTaskRoutes,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });

  const sizeOptions = useMemo(() => {
    return [
      { value: '1:1', label: 'Square (1:1)' },
      { value: '4:3', label: 'Landscape (4:3)' },
      { value: '3:4', label: 'Portrait (3:4)' },
      { value: '16:9', label: 'Widescreen (16:9)' },
      { value: '9:16', label: 'Tall (9:16)' },
    ];
  }, []);

  // When the selected variant changes, update the prompt in the text area
  useEffect(() => {
    setPrompt(node.aiMetadata?.prompt || '');
  }, [node.aiMetadata?.prompt]);

  const handleAddToQueue = async () => {
    setSuggestions([]);
    stopAiEditing();
    setAiNodeError(node.id, null);
    setIsPreparing(true);

    try {
      if (!hasGeminiApiKey(geminiApiKey)) {
        throw new Error('Set a Gemini API key in Preferences > Integrations before generating.');
      }

      if (isTextToImage) {
        if (!prompt) throw new Error('Prompt cannot be empty.');
        addAiTaskToQueue({
          nodeId: node.id,
          prompt,
          isTextToImage: true,
          aspectRatio: outputSizeOption as '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
        });
      } else {
        // Image-to-Image logic
        if (!sourceNode || !prompt) throw new Error('A source image and a prompt are required.');

        const imageBlob = await getAsset(sourceNode.src);
        if (!imageBlob) throw new Error('Source asset not found.');

        const sourceImageBase64 = await blobToBase64(imageBlob);

        addAiTaskToQueue({
          nodeId: node.id,
          prompt,
          maskedImageBase64: sourceImageBase64,
          outputWidth: sourceNode.width,
          outputHeight: sourceNode.height,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      setAiNodeError(node.id, message);
    } finally {
      setIsPreparing(false);
    }
  };

  const handleSuggest = async () => {
    if (!imagePromptRoute) return;
    setIsSuggesting(true);
    try {
      const suggestionResult = await getPromptSuggestions(imagePromptRoute);
      if (suggestionResult.length > 0) {
        setPrompt(suggestionResult[0]);
        setSuggestions(suggestionResult);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleEnhance = async () => {
    if (!imagePromptRoute) return;
    setIsEnhancing(true);
    setSuggestions([]); // Clear suggestions on enhance
    try {
      const enhanced = await enhancePrompt(prompt, imagePromptRoute);
      setPrompt(enhanced);
    } catch (error) {
      console.error(error);
    } finally {
      setIsEnhancing(false);
    }
  };

  if (!node.aiMetadata) return null;

  if (isEditing) {
    return (
      <div className="space-y-4">
        {!isTextToImage && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">Source Image</label>
            {!sourceNode && (
              <p className="text-xs text-yellow-400 p-2 bg-yellow-900/50 rounded-md">
                Please select a source image to generate from.
              </p>
            )}
            <ScrollArea className="flex items-center gap-2 overflow-x-auto pb-2 -mx-2 px-2">
              {potentialSourceNodes.map((source) => (
                <SourceImagePreview
                  key={source.id}
                  node={source}
                  isActive={source.id === node.aiMetadata?.sourceNodeId}
                  onClick={() => setAiSourceNode(node.id, source.id)}
                />
              ))}
              {potentialSourceNodes.length === 0 && (
                <p className="text-xs text-gray-500">
                  No available source image nodes in this project.
                </p>
              )}
            </ScrollArea>
          </div>
        )}

        <div>
          <label htmlFor="ai-prompt" className="text-xs font-medium text-gray-400">
            Prompt
          </label>
          <div className="relative">
            <textarea
              id="ai-prompt"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (suggestions.length > 0) {
                  setSuggestions([]); // Clear suggestions on user input
                }
              }}
              placeholder="e.g., a robot holding a skateboard"
              rows={3}
              className="mt-1 w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm rounded-md focus:ring-primary-500 focus:border-primary-500 block p-2 pr-16 pb-6 resize-none"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-1">
              <button
                type="button"
                onClick={handleSuggest}
                disabled={isSuggesting || isEnhancing || isPreparing || !imagePromptRoute}
                title={
                  imagePromptRoute
                    ? 'Suggest a prompt'
                    : (imagePromptRouteError ?? 'Prompt tools unavailable')
                }
                className={promptToolButtonClass}
              >
                {isSuggesting ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Icons.LightBulb className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={handleEnhance}
                disabled={
                  !prompt || isEnhancing || isSuggesting || isPreparing || !imagePromptRoute
                }
                title={
                  imagePromptRoute
                    ? 'Enhance prompt'
                    : (imagePromptRouteError ?? 'Prompt tools unavailable')
                }
                className={promptToolButtonClass}
              >
                {isEnhancing ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Icons.Sparkles className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 space-y-1 animate-[fadeIn_200ms_ease-out]">
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setPrompt(s);
                      setSuggestions([]);
                    }}
                    className="px-2 py-1 text-xs text-gray-200 bg-gray-600 hover:bg-gray-500 rounded-md transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {isTextToImage && (
          <div>
            <label htmlFor="ai-output-size" className="text-xs font-medium text-gray-400">
              Aspect Ratio
            </label>
            <select
              id="ai-output-size"
              value={outputSizeOption}
              onChange={(e) => setOutputSizeOption(e.target.value)}
              className="mt-1 w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm rounded-md focus:ring-primary-500 focus:border-primary-500 block p-2"
            >
              {sizeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={stopAiEditing}
            className="w-full px-4 py-2 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition"
          >
            Cancel
          </button>
          <button
            onClick={handleAddToQueue}
            disabled={isPreparing || !prompt || (!isTextToImage && !sourceNode)}
            className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 transition disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            {isPreparing && <Spinner />}
            <span className={isPreparing ? 'ml-2' : ''}>
              {isPreparing ? 'Preparing...' : isQueueActive ? 'Add to Queue' : 'Generate'}
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 italic truncate">
        Prompt: "{node.aiMetadata.prompt || 'N/A'}"
      </p>
      {node.aiMetadata.lastError && (
        <div className="p-2 my-1 bg-red-900/50 text-red-300 text-xs rounded-md">
          <p className="font-semibold">Generation Failed</p>
          <p>{node.aiMetadata.lastError}</p>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {node.aiMetadata.variants.map((variant, index) => {
          if (variant.deletedAt) return null;
          const queuePosition = variant.taskId ? queuePositions[variant.taskId] : undefined;
          return (
            <AiVariantPreview
              key={`${variant.src}-${variant.taskId || index}`}
              variant={{ ...variant, queuePosition }}
              isActive={index === node.aiMetadata.activeVariantIndex}
              onClick={() => setActiveVariant(node.id, index)}
            />
          );
        })}
        <button
          onClick={() => startAiEditing(node.id)}
          className="relative rounded-md aspect-square w-full h-auto flex items-center justify-center bg-gray-700/50 hover:bg-gray-700 border border-dashed border-gray-600 hover:border-gray-500 transition-colors"
          title="Generate new variant"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default AiAdjustments;
