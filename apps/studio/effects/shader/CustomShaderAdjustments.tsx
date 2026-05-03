import React, { useEffect, useMemo, useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { AnyNode, CustomShaderNode, UniformUIType, AnyUniform } from '@blackboard/types';
import { DEFAULT_CUSTOM_SHADER, parseUniformsFromGLSL } from '@/utils/glsl';
import {
  AttentionPulse,
  CollapsibleSection,
  CodeBlock,
  Slider,
  ColorPicker,
  PromptTextField,
  PropertyField,
  ToggleSwitch,
  SegmentedControl,
} from '@/components';
import { suggestShaderIdeas, enhanceShaderPrompt } from '@/utils/ai';
import { getAiTaskRouteError, resolveAiTaskRoute } from '@/utils/aiRouting';
import * as Icons from '@blackboard/icons';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

interface SpinnerProps {
  className?: string;
}

interface InlineCodeProps {
  children: React.ReactNode;
  variant?: 'default' | 'warning' | 'danger' | 'accent';
  className?: string;
}

const Spinner = ({ className = 'h-4 w-4' }: SpinnerProps): React.JSX.Element => (
  <svg
    className={`animate-spin ${className} text-white`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const InlineCode = ({
  children,
  variant = 'default',
  className = '',
}: InlineCodeProps): React.JSX.Element => {
  const variantClassName =
    {
      default: 'bg-white/10 text-gray-100',
      warning: 'bg-yellow-800/50 text-yellow-100',
      danger: 'bg-red-800/50 text-red-100',
      accent: 'bg-purple-800/50 text-purple-100',
    }[variant] ?? 'bg-white/10 text-gray-100';

  return (
    <code
      className={`rounded px-1 py-0.5 font-mono text-[0.95em] ${variantClassName} ${className}`}
    >
      {children}
    </code>
  );
};

const renderInlineCodeText = (
  text: string,
  variant: InlineCodeProps['variant'] = 'default',
): React.ReactNode[] =>
  text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <React.Fragment key={`${part}-${index}`}>
          <InlineCode variant={variant}>{part.slice(1, -1)}</InlineCode>
        </React.Fragment>
      );
    }

    return part;
  });

interface CustomShaderAdjustmentsProps {
  node: AnyNode;
}

const CustomShaderAdjustments = ({
  node: anyNode,
}: CustomShaderAdjustmentsProps): React.JSX.Element => {
  const node = anyNode as CustomShaderNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const aiChats = useEditorSelector((s) => s.aiChats);
  const aiApplyNotice = useEditorSelector((s) => s.aiApplyNotice);
  const { updateNode, setKeyframe, openShaderChat, startShaderChat } = useEditorActions();
  const { geminiApiKey, openAiApiKey, openAiBaseUrl, ollamaEndpoint, aiTaskRoutes } =
    usePreferences();
  const [code, setCode] = useState(node.fragmentShader);
  const [showWarning, setShowWarning] = useState(true);

  // Generation state
  const [aiPrompt, setAiPrompt] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Derived suggestion state from node
  const suggestionPages = useMemo(
    () => node.promptSuggestionPages ?? [],
    [node.promptSuggestionPages],
  );
  const suggestionPageIndex = node.promptSuggestionPageIndex ?? 0;
  const currentSuggestions = suggestionPages[suggestionPageIndex] ?? [];
  const areSuggestionsVisible = Boolean(node.promptSuggestionsVisible);
  const shaderApplyNotice =
    aiApplyNotice?.nodeId === node.id && aiApplyNotice.field === 'shader' ? aiApplyNotice : null;

  // Helper to persist suggestion state to node
  const updateShaderSuggestions = (updates: {
    promptSuggestionPages?: string[][];
    promptSuggestionPageIndex?: number;
    promptSuggestionsVisible?: boolean;
  }) => {
    updateNode(node.id, updates, false);
  };

  const nodeChat = useMemo(
    () => aiChats.find((chat) => chat.feature === 'shader' && chat.nodeId === node.id) ?? null,
    [aiChats, node.id],
  );

  const isGenerating = nodeChat?.status === 'generating';
  const chatError = aiError || nodeChat?.lastError || null;
  const chatTitle = nodeChat?.title ?? 'Shader Chat';
  const latestChatMessage = nodeChat?.messages[nodeChat.messages.length - 1]?.content;
  const chatStatusTone = chatError ? 'error' : 'neutral';
  const chatStatusBadge = chatError ? 'Error' : isGenerating ? 'Generating' : null;
  const chatStatusMessage =
    chatError ??
    (isGenerating
      ? 'Generating a new shader response now.'
      : latestChatMessage || (nodeChat ? 'Ready for another prompt.' : 'Create shader chat.'));
  const hasDraftCode = code.trim().length > 0;
  const isExampleDraft = code.trim() === DEFAULT_CUSTOM_SHADER.trim();
  const shaderPromptRouteError = getAiTaskRouteError('shaderPromptTools', {
    aiTaskRoutes,
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
  });
  const shaderPromptRoute = shaderPromptRouteError
    ? null
    : resolveAiTaskRoute('shaderPromptTools', {
        aiTaskRoutes,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });
  const shaderGenerationRouteError = getAiTaskRouteError('shaderGeneration', {
    aiTaskRoutes,
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
  });
  const shaderGenerationRoute = shaderGenerationRouteError
    ? null
    : resolveAiTaskRoute('shaderGeneration', {
        aiTaskRoutes,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });
  const isAiGenerationMissingConfig = Boolean(shaderGenerationRouteError);

  useEffect(() => {
    setCode(node.fragmentShader);
  }, [node.fragmentShader]);

  const handleApplyShader = () => {
    // This action updates the shader code and re-derives uniforms in the store
    updateNode(node.id, { fragmentShader: code }, true);
  };

  const handleLoadExample = () => {
    setCode(DEFAULT_CUSTOM_SHADER);
  };

  const handleUniformChange = (name: string, value: number) => {
    setKeyframe(node.id, `uniforms.${name}.value`, value);
  };

  const handleColorUniformChange = (name: string, value: [number, number, number]) => {
    const newUniforms = {
      ...node.uniforms,
      [name]: { ...node.uniforms[name], value },
    };
    updateNode(node.id, { uniforms: newUniforms }, true); // Color is not animated, so push history directly
  };

  const handleStaticUniformChange = (name: string, value: boolean | number) => {
    const newUniforms = {
      ...node.uniforms,
      [name]: { ...node.uniforms[name], value },
    };
    updateNode(node.id, { uniforms: newUniforms }, true);
  };

  // Generation handlers
  const handleSuggest = async () => {
    setIsSuggesting(true);
    setAiError(null);

    try {
      if (!shaderPromptRoute) {
        throw new Error(shaderPromptRouteError ?? 'Configure shader prompt tools in Preferences.');
      }

      const suggestionResult = await suggestShaderIdeas(shaderPromptRoute);
      if (suggestionResult.length > 0) {
        const nextPages = [...suggestionPages, suggestionResult];
        updateShaderSuggestions({
          promptSuggestionPages: nextPages,
          promptSuggestionPageIndex: nextPages.length - 1,
          promptSuggestionsVisible: true,
        });
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Failed to get suggestions.');
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleEnhance = async () => {
    if (!aiPrompt) {
      return;
    }

    setIsEnhancing(true);
    setAiError(null);

    try {
      if (!shaderPromptRoute) {
        throw new Error(shaderPromptRouteError ?? 'Configure shader prompt tools in Preferences.');
      }

      const enhanced = await enhanceShaderPrompt(aiPrompt, shaderPromptRoute);
      setAiPrompt(enhanced);
      updateShaderSuggestions({
        promptSuggestionPages: [],
        promptSuggestionsVisible: false,
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Failed to enhance prompt.');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleGenerate = async () => {
    if (!aiPrompt) {
      return;
    }

    if (!shaderGenerationRoute) {
      setAiError(shaderGenerationRouteError ?? 'Configure shader generation in Preferences.');
      return;
    }

    setAiError(null);
    updateShaderSuggestions({
      promptSuggestionPages: [],
      promptSuggestionsVisible: false,
    });

    try {
      await startShaderChat(node.id, aiPrompt, {
        provider: shaderGenerationRoute.provider,
        geminiApiKey: shaderGenerationRoute.geminiApiKey,
        geminiModel: shaderGenerationRoute.geminiModel,
        openAiApiKey: shaderGenerationRoute.openAiApiKey,
        openAiBaseUrl: shaderGenerationRoute.openAiBaseUrl,
        openAiModel: shaderGenerationRoute.openAiModel,
        ollamaEndpoint: shaderGenerationRoute.ollamaEndpoint,
        ollamaModel: shaderGenerationRoute.ollamaModel,
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Shader generation failed.');
    }
  };

  const handleOpenChat = () => {
    setAiError(null);
    openShaderChat(node.id);
  };

  const handleToggleSuggestions = () => {
    if (areSuggestionsVisible) {
      updateShaderSuggestions({ promptSuggestionsVisible: false });
      return;
    }

    if (suggestionPages.length === 0) {
      void handleSuggest();
      return;
    }

    updateShaderSuggestions({ promptSuggestionsVisible: true });
  };

  const clearCurrentSuggestionPage = () => {
    const nextPages = suggestionPages.filter((_, index) => index !== suggestionPageIndex);
    updateShaderSuggestions({
      promptSuggestionPages: nextPages,
      promptSuggestionPageIndex: Math.min(suggestionPageIndex, Math.max(0, nextPages.length - 1)),
      promptSuggestionsVisible: nextPages.length > 0,
    });
  };

  const handlePromptChange = (value: string) => {
    setAiPrompt(value);

    if (aiError) {
      setAiError(null);
    }
  };

  const renderUniformControl = (name: string, uniform: AnyUniform): React.JSX.Element | null => {
    if (uniform.ui === UniformUIType.SLIDER) {
      const valueAtFrame = getValueAtFrame(uniform.value, currentFrame);

      return (
        <PropertyField key={name}>
          <Slider
            label={uniform.label}
            value={valueAtFrame}
            min={uniform.min}
            max={uniform.max}
            step={uniform.step}
            onChange={(value) => handleUniformChange(name, value)}
            onReset={() => {
              const defaultUniforms = parseUniformsFromGLSL(node.fragmentShader);
              const defaultUniform = defaultUniforms[name];

              if (defaultUniform?.ui === UniformUIType.SLIDER) {
                setKeyframe(node.id, `uniforms.${name}.value`, defaultUniform.value, true);
              }
            }}
            displayFormatter={(value) => value.toFixed(2)}
            isKeyframed={hasKeyframeAt(uniform.value, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, `uniforms.${name}.value`)}
          />
        </PropertyField>
      );
    }

    if (uniform.ui === UniformUIType.COLOR) {
      return (
        <PropertyField key={name}>
          <ColorPicker
            label={uniform.label}
            value={uniform.value as [number, number, number]}
            onChange={(value) => handleColorUniformChange(name, value)}
          />
        </PropertyField>
      );
    }

    if (uniform.ui === UniformUIType.TOGGLE) {
      return (
        <PropertyField key={name}>
          <ToggleSwitch
            label={uniform.label}
            checked={uniform.value}
            onCheckedChange={(checked) => handleStaticUniformChange(name, checked)}
            size="sm"
          />
        </PropertyField>
      );
    }

    if (uniform.ui === UniformUIType.SEGMENTED) {
      return (
        <PropertyField key={name} label={uniform.label}>
          <SegmentedControl
            options={uniform.options}
            value={uniform.value}
            onChange={(value) => {
              const numericValue = typeof value === 'number' ? value : Number(value);
              if (Number.isFinite(numericValue)) {
                handleStaticUniformChange(name, numericValue);
              }
            }}
          />
        </PropertyField>
      );
    }

    if (uniform.ui === UniformUIType.NUMBER) {
      return (
        <PropertyField key={name} label={uniform.label}>
          <input
            type="number"
            aria-label={uniform.label}
            value={uniform.value}
            step={uniform.step}
            onChange={(event) => {
              if (event.target.value === '') return;
              const numericValue = Number(event.target.value);
              if (Number.isFinite(numericValue)) {
                handleStaticUniformChange(name, numericValue);
              }
            }}
            className="block w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-100 outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
          />
        </PropertyField>
      );
    }

    return null;
  };

  return (
    <div>
      <CollapsibleSection title="Shader Generation">
        <div className="space-y-4">
          <PromptTextField
            id="ai-shader-prompt"
            label="Prompt"
            description="Describe the shader result"
            value={aiPrompt}
            onValueChange={handlePromptChange}
            placeholder="e.g., a vintage film effect with dust and scratches"
            rows={3}
            minHeight={78}
            canUsePromptTools={Boolean(shaderPromptRoute)}
            promptToolsUnavailableReason={
              shaderPromptRouteError ?? 'Configure shader prompt tools in Preferences.'
            }
            isSuggesting={isSuggesting}
            isEnhancing={isEnhancing}
            suggestions={currentSuggestions}
            suggestionsVisible={areSuggestionsVisible}
            suggestionPageLabel={
              suggestionPages.length > 0
                ? `${suggestionPageIndex + 1}/${suggestionPages.length}`
                : undefined
            }
            canPreviousSuggestions={suggestionPageIndex > 0}
            canNextSuggestions={suggestionPageIndex < suggestionPages.length - 1}
            suggestLabel="New Shader Ideas"
            enhanceLabel="Enhance Prompt"
            onSuggest={() => void handleSuggest()}
            onEnhance={() => void handleEnhance()}
            onToggleSuggestions={handleToggleSuggestions}
            onPreviousSuggestions={() =>
              updateShaderSuggestions({
                promptSuggestionPageIndex: Math.max(0, suggestionPageIndex - 1),
                promptSuggestionsVisible: true,
              })
            }
            onNextSuggestions={() =>
              updateShaderSuggestions({
                promptSuggestionPageIndex: Math.min(
                  suggestionPages.length - 1,
                  suggestionPageIndex + 1,
                ),
                promptSuggestionsVisible: true,
              })
            }
            onClearSuggestions={clearCurrentSuggestionPage}
            onSuggestionSelect={(suggestion) => {
              setAiPrompt(suggestion);
              setAiError(null);
            }}
          />

          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={handleOpenChat}
              className={`flex min-w-0 flex-1 rounded-md px-3 py-2 text-left transition ${
                chatStatusTone === 'error'
                  ? 'bg-red-500/10 text-red-100 hover:bg-red-500/15'
                  : 'bg-white/5 text-gray-300 hover:bg-white/[0.07] hover:text-gray-100'
              }`}
              title={nodeChat ? 'Open Shader Chat' : 'Create Shader Chat'}
              aria-label={nodeChat ? 'Open Shader Chat' : 'Create Shader Chat'}
            >
              <span className="min-w-0 flex-1">
                <span className="mb-1 flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-xs font-medium text-current">
                    {chatTitle}
                  </span>
                  {chatStatusBadge ? (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                        chatStatusTone === 'error'
                          ? 'bg-red-300/15 text-red-100'
                          : 'bg-white/10 text-gray-200'
                      }`}
                    >
                      {chatStatusBadge}
                    </span>
                  ) : null}
                </span>
                <span
                  className="block overflow-hidden text-[11px] leading-4 text-current opacity-70"
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                  }}
                >
                  {renderInlineCodeText(
                    chatStatusMessage,
                    chatStatusTone === 'error' ? 'danger' : 'default',
                  )}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!aiPrompt || isGenerating || isAiGenerationMissingConfig}
              title="Execute prompt and generate shader code"
              className="inline-flex min-h-16 w-32 shrink-0 items-center justify-center gap-2 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/30 disabled:cursor-not-allowed disabled:border-cyan-300/10 disabled:bg-cyan-300/[0.04] disabled:text-cyan-100/35"
            >
              {isGenerating ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Icons.Play className="h-4 w-4" />
              )}
              <span className="truncate">{isGenerating ? 'Generating' : 'Generate'}</span>
            </button>
          </div>

          {shaderGenerationRouteError && (
            <div className="rounded-md bg-yellow-900/40 p-2 text-xs text-yellow-200">
              {shaderGenerationRouteError}
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Props" defaultOpen>
        <div className="space-y-2">
          {Object.entries(node.uniforms).length > 0 ? (
            Object.entries(node.uniforms).map(([name, uniform]) =>
              renderUniformControl(name, uniform as AnyUniform),
            )
          ) : (
            <p className="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 p-3 text-xs leading-5 text-gray-400">
              No adjustable parameters (uniforms) detected in the shader.
            </p>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="GLSL Code">
        <div className="space-y-4">
          {showWarning && (
            <div className="relative rounded-md bg-yellow-900/50 p-3 text-xs text-yellow-300 animate-[fadeIn_200ms_ease-out]">
              <button
                type="button"
                onClick={() => setShowWarning(false)}
                className="absolute top-1 right-1 rounded p-1 text-yellow-400 transition hover:bg-yellow-300/10 hover:text-white"
                aria-label="Dismiss warning"
              >
                <Icons.XMark className="h-3 w-3" />
              </button>
              <p className="mb-1 font-semibold">GLSL Tip:</p>
              <p>
                This editor targets <InlineCode variant="warning">WebGL2 / GLSL ES 3.00</InlineCode>
                . Use <InlineCode variant="warning">in</InlineCode>/
                <InlineCode variant="warning">out</InlineCode> instead of{' '}
                <InlineCode variant="warning">attribute</InlineCode>/
                <InlineCode variant="warning">varying</InlineCode>, and write fragment output via a
                custom <InlineCode variant="warning">out</InlineCode> variable.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleLoadExample}
              disabled={isExampleDraft}
              className="inline-flex items-center gap-2 rounded-md bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
              title="Load example shader"
            >
              <Icons.DocumentPlus className="h-4 w-4" />
              Load Example
            </button>

            {hasDraftCode && (
              <button
                type="button"
                onClick={() => setCode('')}
                className="inline-flex items-center gap-2 rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white"
                title="Clear shader code"
              >
                <Icons.XMark className="h-4 w-4" />
                Clear
              </button>
            )}
          </div>

          <AttentionPulse activeKey={shaderApplyNotice?.id} className="rounded-lg">
            <CodeBlock code={code} onChange={setCode} language="glsl" className="max-h-72" />
          </AttentionPulse>

          <button
            type="button"
            onClick={handleApplyShader}
            className="w-full rounded-md border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/30"
          >
            Apply Shader
          </button>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default CustomShaderAdjustments;
