import React, { useEffect, useId, useRef, useState } from 'react';
import * as Icons from '@blackboard/icons';
import Popover from './Popover';
import ResetIconButton from './ResetIconButton';
import ScrollArea from './ScrollArea';

export interface PromptTextFieldProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  rows?: number;
  minHeight?: number;
  maxHeightClassName?: string;
  canUsePromptTools?: boolean;
  promptToolsUnavailableReason?: string;
  isSuggesting?: boolean;
  isEnhancing?: boolean;
  suggestions?: string[];
  suggestionsVisible?: boolean;
  suggestionPageLabel?: string;
  canPreviousSuggestions?: boolean;
  canNextSuggestions?: boolean;
  suggestLabel?: string;
  enhanceLabel?: string;
  onSuggest?: () => void;
  onEnhance?: () => void;
  onToggleSuggestions?: () => void;
  onPreviousSuggestions?: () => void;
  onNextSuggestions?: () => void;
  onClearSuggestions?: () => void;
  onSuggestionSelect?: (suggestion: string) => void;
  onReset?: () => void;
  resetTooltip?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

const Spinner: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg
    aria-hidden="true"
    className={`animate-spin ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
  </svg>
);

const PromptTextField: React.FC<PromptTextFieldProps> = ({
  label,
  description,
  value,
  onValueChange,
  placeholder,
  disabled,
  id,
  rows = 1,
  minHeight = 36,
  maxHeightClassName = 'max-h-44',
  canUsePromptTools = true,
  promptToolsUnavailableReason = 'Configure prompt tools in Preferences > Integrations.',
  isSuggesting = false,
  isEnhancing = false,
  suggestions = [],
  suggestionsVisible = false,
  suggestionPageLabel,
  canPreviousSuggestions = false,
  canNextSuggestions = false,
  suggestLabel = 'New Suggestions',
  enhanceLabel = 'Enhance Prompt',
  onSuggest,
  onEnhance,
  onToggleSuggestions,
  onPreviousSuggestions,
  onNextSuggestions,
  onClearSuggestions,
  onSuggestionSelect,
  onReset,
  resetTooltip,
  onKeyDown,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generatedInputId = useId();
  const descriptionId = useId();
  const [isPromptMenuOpen, setIsPromptMenuOpen] = useState(false);
  const inputId = id ?? generatedInputId;
  const hasDescription = description !== undefined && description !== null;
  const descriptionTitle = typeof description === 'string' ? description : undefined;
  const isBusy = isSuggesting || isEnhancing;
  const hasPromptTools = Boolean(onSuggest || onEnhance || onToggleSuggestions);
  const canSuggest = canUsePromptTools && !isBusy && Boolean(onSuggest || onToggleSuggestions);
  const canEnhance = canUsePromptTools && !isBusy && value.trim().length > 0 && Boolean(onEnhance);
  const hasSuggestions = suggestionsVisible && suggestions.length > 0;
  const unavailableReason = canUsePromptTools ? '' : promptToolsUnavailableReason;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`;
  }, [minHeight, value]);

  const actionButtonClass =
    'inline-flex h-6 items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:opacity-50';
  const suggestionToggleButtonClass = `inline-flex h-5 w-5 items-center justify-center overflow-visible rounded border border-transparent transition focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 ${
    suggestionsVisible
      ? 'bg-primary-300/10 text-primary-100 hover:border-primary-300/50 hover:bg-primary-300/14 focus-visible:border-primary-300/50 focus-visible:ring-primary-300/30'
      : 'text-gray-500 hover:border-gray-500/70 hover:bg-white/[0.03] hover:text-gray-200 focus-visible:border-gray-500/70 focus-visible:ring-white/20'
  }`;
  const inlineIconButtonClass =
    'inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 transition hover:bg-white/[0.06] hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50';
  const navButtonClass =
    'inline-flex h-5 w-5 items-center justify-center rounded border border-gray-700 bg-gray-800 text-gray-400 transition hover:border-gray-600 hover:bg-gray-700 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-40';
  const compactIconClass = 'h-4 w-4';

  const handleSuggest = () => {
    if (!canSuggest) return;
    if (onToggleSuggestions) {
      onToggleSuggestions();
      return;
    }
    onSuggest?.();
  };

  const promptToolButtons = (closeMenu?: () => void) => (
    <>
      {onSuggest ? (
        <button
          type="button"
          onClick={() => {
            onSuggest();
            closeMenu?.();
          }}
          disabled={!canUsePromptTools || isBusy}
          title={canUsePromptTools ? suggestLabel : unavailableReason}
          className={actionButtonClass}
        >
          {isSuggesting ? (
            <Spinner className={compactIconClass} />
          ) : (
            <Icons.LightBulb className={compactIconClass} />
          )}
          {suggestLabel}
        </button>
      ) : null}
      {onEnhance ? (
        <button
          type="button"
          onClick={() => {
            onEnhance();
            closeMenu?.();
          }}
          disabled={!canEnhance}
          title={canUsePromptTools ? enhanceLabel : unavailableReason}
          className={actionButtonClass}
        >
          {isEnhancing ? (
            <Spinner className={compactIconClass} />
          ) : (
            <Icons.Sparkles className={compactIconClass} />
          )}
          {enhanceLabel}
        </button>
      ) : null}
    </>
  );

  return (
    <div className="space-y-1.5" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label
            htmlFor={inputId}
            className="max-w-[45%] shrink-0 truncate text-xs font-medium text-gray-400"
          >
            {label}
          </label>
          {hasDescription ? (
            <span
              id={descriptionId}
              title={descriptionTitle}
              className="min-w-0 flex-1 truncate text-[11px] leading-4 text-gray-500"
            >
              {description}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasPromptTools ? (
            <>
              <button
                type="button"
                onClick={handleSuggest}
                disabled={!canSuggest}
                title={
                  canUsePromptTools
                    ? suggestionsVisible
                      ? 'Hide suggested prompts'
                      : suggestions.length > 0
                        ? 'Show suggested prompts'
                        : 'Suggest a prompt'
                    : unavailableReason
                }
                aria-label={
                  suggestionsVisible ? 'Hide suggested prompts' : 'Show suggested prompts'
                }
                aria-pressed={suggestionsVisible}
                className={suggestionToggleButtonClass}
              >
                {isSuggesting ? (
                  <Spinner className={compactIconClass} />
                ) : (
                  <Icons.LightBulb className={compactIconClass} />
                )}
              </button>
              {onEnhance ? (
                <button
                  type="button"
                  onClick={onEnhance}
                  disabled={!canEnhance}
                  title={canUsePromptTools ? enhanceLabel : unavailableReason}
                  aria-label={enhanceLabel}
                  className={inlineIconButtonClass}
                >
                  {isEnhancing ? (
                    <Spinner className={compactIconClass} />
                  ) : (
                    <Icons.Sparkles className={compactIconClass} />
                  )}
                </button>
              ) : null}
            </>
          ) : null}
          {onReset ? <ResetIconButton onClick={onReset} tooltip={resetTooltip} /> : null}
          {hasPromptTools ? (
            <Popover
              isOpen={isPromptMenuOpen}
              onOpenChange={setIsPromptMenuOpen}
              align="end"
              widthClass="w-48"
              trigger={
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 transition hover:bg-white/[0.06] hover:text-gray-100"
                  title="Prompt tools"
                  aria-label="Prompt tools"
                >
                  <Icons.EllipsisVertical className="h-4 w-4" />
                </button>
              }
            >
              {(closePopover) => (
                <div className="space-y-1">
                  <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                    Prompt Tools
                  </p>
                  <div className="flex flex-col gap-1">{promptToolButtons(closePopover)}</div>
                  {!canUsePromptTools ? (
                    <p className="px-1 pt-1 text-[10px] leading-4 text-gray-500">
                      {unavailableReason}
                    </p>
                  ) : null}
                </div>
              )}
            </Popover>
          ) : null}
        </div>
      </div>
      <ScrollArea
        axis="y"
        rootClassName="rounded-lg border border-gray-700 bg-gray-900 transition focus-within:border-primary-400/70 focus-within:ring-2 focus-within:ring-primary-400/20"
        viewportClassName={maxHeightClassName}
      >
        <textarea
          ref={textareaRef}
          id={inputId}
          value={value}
          rows={rows}
          disabled={disabled}
          aria-describedby={hasDescription ? descriptionId : undefined}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          className="block min-h-9 w-full resize-none overflow-hidden border-0 bg-transparent px-3 py-2 text-xs leading-5 text-gray-100 outline-none placeholder:text-gray-600 disabled:cursor-not-allowed disabled:text-gray-500"
        />
      </ScrollArea>
      {hasSuggestions ? (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {onPreviousSuggestions ? (
                <button
                  type="button"
                  onClick={onPreviousSuggestions}
                  disabled={!canPreviousSuggestions}
                  title="Previous suggested prompts"
                  aria-label="Previous suggested prompts"
                  className={navButtonClass}
                >
                  <Icons.ChevronLeft className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {suggestionPageLabel ? (
                <span className="min-w-12 text-center text-[10px] leading-5 text-gray-500">
                  {suggestionPageLabel}
                </span>
              ) : null}
              {onNextSuggestions ? (
                <button
                  type="button"
                  onClick={onNextSuggestions}
                  disabled={!canNextSuggestions}
                  title="Next suggested prompts"
                  aria-label="Next suggested prompts"
                  className={navButtonClass}
                >
                  <Icons.ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {onSuggest ? (
                <button
                  type="button"
                  onClick={onSuggest}
                  disabled={!canUsePromptTools || isBusy}
                  title={canUsePromptTools ? suggestLabel : unavailableReason}
                  aria-label={suggestLabel}
                  className={navButtonClass}
                >
                  {isSuggesting ? (
                    <Spinner className={compactIconClass} />
                  ) : (
                    <Icons.LightBulb className={compactIconClass} />
                  )}
                </button>
              ) : null}
            </div>
            {onClearSuggestions ? (
              <button
                type="button"
                onClick={onClearSuggestions}
                title="Clear this page of suggested prompts"
                aria-label="Clear this page of suggested prompts"
                className={navButtonClass}
              >
                <Icons.Trash className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion}-${index}`}
                type="button"
                onClick={() => onSuggestionSelect?.(suggestion)}
                className="rounded-md border border-primary-300/15 bg-primary-300/[0.08] px-2 py-1 text-left text-[10px] leading-4 text-primary-50 transition hover:border-primary-300/30 hover:bg-primary-300/[0.14]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PromptTextField;
