import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { usePreferences } from '@/state/preferencesContext';
import { formatHotkeyCombo, isMacPlatform } from '@/hotkeys/strings';
import { getAiTaskRouteError, resolveAiTaskRoute } from '@/utils/aiRouting';
import {
  getAiChatCapabilityLabel,
  getAiChatComposerPlaceholder,
  getAiChatModeDescription,
  getAiChatScopeLabel,
  getAiChatScopeMode,
  isAiActionCapableNode,
} from '@/utils/aiChatScope';
import { supportsAiNodeTools } from '@/utils/aiNodeTools';
import * as Icons from '@blackboard/icons';
import { NodeType } from '@blackboard/types';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AiChatBranch,
  AiChatAttachment,
  AiChatMessage,
  AiChatThread,
  AnyNode,
  CustomShaderNode,
} from '@blackboard/types';
import { CodeBlock, ResizableScrollTextarea, ScrollArea } from '@blackboard/ui';
import SubPanelHeader from './SubPanelHeader';

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

const ScopeChip: React.FC<{
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success';
}> = ({ children, tone = 'neutral' }) => {
  const toneClassName =
    tone === 'accent'
      ? 'border-primary-400/25 bg-primary-500/10 text-primary-100'
      : tone === 'success'
        ? 'border-green-400/25 bg-green-500/10 text-green-100'
        : 'border-white/10 bg-white/[0.04] text-gray-300';

  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${toneClassName}`}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
};

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}> = ({ label, onClick, icon }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-gray-200 transition hover:bg-white/[0.08]"
  >
    {icon}
  </button>
);

const BubbleActionButton: React.FC<{
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}> = ({ label, onClick, icon, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.035] text-gray-400 transition hover:bg-white/[0.07] hover:text-gray-100 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-gray-600"
  >
    {icon}
  </button>
);

const KeyHint: React.FC<{ keys: string[]; label?: string }> = ({ keys, label = 'Send with' }) => (
  <span className="hidden shrink-0 items-center gap-1 text-[10px] text-gray-500 sm:inline-flex">
    <span>{label}</span>
    {keys.map((key) => (
      <span
        key={key}
        className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-medium leading-none text-gray-400"
      >
        {key}
      </span>
    ))}
  </span>
);

const MessageMetaChip: React.FC<{ children: React.ReactNode; mono?: boolean }> = ({
  children,
  mono = false,
}) => {
  const title = typeof children === 'string' ? children : undefined;

  return (
    <span
      title={title}
      className={`inline-flex min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-gray-300 ${
        mono ? 'font-mono' : ''
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
};

const BranchVariantControls: React.FC<{
  variants: AiChatBranch[];
  activeBranchId?: string;
  disabled?: boolean;
  onSelect: (branchId: string) => void;
}> = ({ variants, activeBranchId, disabled = false, onSelect }) => {
  if (variants.length <= 1) {
    return null;
  }

  const activeIndex = Math.max(
    0,
    variants.findIndex((branch) => branch.id === activeBranchId),
  );
  const activeVariant = variants[activeIndex];

  const selectOffset = (offset: number) => {
    const nextIndex = (activeIndex + offset + variants.length) % variants.length;
    onSelect(variants[nextIndex].id);
  };

  return (
    <div
      className="inline-flex h-6 shrink-0 items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.035] text-[10px] text-gray-300"
      title={activeVariant?.label}
    >
      <button
        type="button"
        onClick={() => selectOffset(-1)}
        disabled={disabled}
        aria-label="Previous chat variant"
        title="Previous variant"
        className="inline-flex h-6 w-6 items-center justify-center text-gray-400 transition hover:bg-white/[0.07] hover:text-gray-100 disabled:cursor-not-allowed disabled:text-gray-600"
      >
        <Icons.ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="inline-flex h-6 min-w-12 items-center justify-center gap-1 border-x border-white/10 px-1.5 font-medium tabular-nums">
        <Icons.Branch className="h-3 w-3 text-gray-500" />
        {activeIndex + 1}/{variants.length}
      </span>
      <button
        type="button"
        onClick={() => selectOffset(1)}
        disabled={disabled}
        aria-label="Next chat variant"
        title="Next variant"
        className="inline-flex h-6 w-6 items-center justify-center text-gray-400 transition hover:bg-white/[0.07] hover:text-gray-100 disabled:cursor-not-allowed disabled:text-gray-600"
      >
        <Icons.ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

const MessageSkeleton: React.FC = () => (
  <div className="mt-2 space-y-2" aria-hidden="true">
    <div className="h-2.5 w-11/12 animate-pulse rounded-full bg-white/10" />
    <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-white/10" />
  </div>
);

function PreviewArtifactPanel({
  color = 'gray',
  children,
}: {
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ '--c': color } as React.CSSProperties}
      className="
        -mx-3 mt-3 space-y-3 border-y px-3 py-3 transition-colors
        border-[color:color-mix(in_srgb,var(--c)_15%,transparent)]
        bg-[color:color-mix(in_srgb,var(--c)_2.5%,transparent)]
        hover:bg-[color:color-mix(in_srgb,var(--c)_5.5%,transparent)]
      "
    >
      {children}
    </div>
  );
}

const CompactDisclosure: React.FC<{
  title: React.ReactNode;
  children: React.ReactNode;
  preview?: string;
  indicator?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  contentLineClassName?: string;
  tone?: 'neutral' | 'cyan';
}> = ({
  title,
  children,
  preview,
  indicator,
  className = '',
  contentClassName = 'mt-1',
  contentLineClassName,
  tone = 'neutral',
}) => {
  const toneClassName =
    tone === 'cyan'
      ? 'text-cyan-100/65 hover:bg-cyan-100/[0.06] hover:text-cyan-50 focus-visible:ring-cyan-200/25'
      : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200 focus-visible:ring-white/15';
  const iconClassName = tone === 'cyan' ? 'text-cyan-100/45' : 'text-gray-500';
  const previewClassName = tone === 'cyan' ? 'text-cyan-50/70' : 'text-gray-400';

  return (
    <details className={`group min-w-0 ${className}`}>
      <summary
        className={`flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-1 text-left transition focus:outline-none focus-visible:ring-1 [&::-webkit-details-marker]:hidden ${toneClassName}`}
      >
        <Icons.ChevronDown
          className={`h-3 w-3 shrink-0 -rotate-90 transition-transform group-open:rotate-0 ${iconClassName}`}
        />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em]">
          {title}
        </span>
        {indicator}
        {preview ? (
          <span
            className={`min-w-0 flex-1 truncate text-[12px] font-normal normal-case leading-5 tracking-normal group-open:hidden ${previewClassName}`}
            title={preview}
          >
            {preview}
          </span>
        ) : null}
      </summary>
      <div
        className={`${contentClassName} ${
          contentLineClassName ??
          (tone === 'cyan' ? 'border-l border-cyan-200/20' : 'border-l border-white/[0.08]')
        }`}
      >
        {children}
      </div>
    </details>
  );
};

const isCustomShaderNode = (node: unknown): node is CustomShaderNode =>
  !!node && typeof node === 'object' && 'type' in node && node.type === NodeType.CUSTOM_SHADER;

const formatChatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);

const getProviderLabel = (provider: string) =>
  provider === 'ollama' ? 'Ollama' : provider === 'openai' ? 'OpenAI' : 'Gemini';

const getPendingMessagePhaseLabel = (message: AiChatMessage | null | undefined) => {
  if (!message) return 'Connecting';
  if (message.isThinking) return 'Thinking';
  return message.content.trim() ? 'Responding' : 'Connecting';
};

type QueuedDraft = {
  prompt: string;
  attachments: AiChatAttachment[];
};

type ChatPromptBranchPoints = {
  userBranchPointId?: string;
  assistantBranchPointId?: string;
};

type PreparedChatBranchPrompt = {
  prompt: string;
  attachments?: AiChatAttachment[];
  branchPoints: ChatPromptBranchPoints;
};

const MAX_CHAT_ATTACHMENTS = 6;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 256 * 1024;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'css',
  'csv',
  'frag',
  'glsl',
  'html',
  'js',
  'json',
  'md',
  'tsx',
  'ts',
  'txt',
  'vert',
  'xml',
  'yaml',
  'yml',
]);

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

const getFileExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() ?? '';

const isTextAttachmentFile = (file: File) =>
  file.type.startsWith('text/') || TEXT_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name));

const getAttachmentKind = (file: File): AiChatAttachment['kind'] => {
  if (file.type.startsWith('image/')) {
    return 'image';
  }

  return isTextAttachmentFile(file) ? 'text' : 'file';
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.readAsDataURL(file);
  });

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.readAsText(file);
  });

const createAttachmentId = () =>
  `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getAttachmentSummary = (attachments: AiChatAttachment[]) => {
  if (attachments.length === 0) {
    return '';
  }

  return attachments.length === 1 ? attachments[0].name : `${attachments.length} files`;
};

const getQueuedDraftPreview = (queuedDraft: QueuedDraft) => {
  const prompt = queuedDraft.prompt.trim();
  const attachmentSummary = getAttachmentSummary(queuedDraft.attachments);

  if (prompt && attachmentSummary) {
    return `${prompt} / ${attachmentSummary}`;
  }

  return prompt || attachmentSummary || 'Queued message';
};

const AttachmentList: React.FC<{
  attachments: AiChatAttachment[];
  onRemove?: (attachmentId: string) => void;
}> = ({ attachments, onRemove }) => {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-1 text-[11px] text-gray-300"
          title={`${attachment.name} (${attachment.mimeType || 'unknown type'}, ${formatAttachmentSize(attachment.size)})`}
        >
          {attachment.kind === 'image' && attachment.dataUrl ? (
            <img
              src={attachment.dataUrl}
              alt=""
              className="h-6 w-6 shrink-0 rounded border border-white/10 object-cover"
            />
          ) : attachment.kind === 'image' ? (
            <Icons.Photo className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          ) : (
            <Icons.DocumentPlus className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          )}
          <span className="min-w-0 max-w-36 truncate">{attachment.name}</span>
          <span className="shrink-0 text-gray-600">{formatAttachmentSize(attachment.size)}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
              title={`Remove ${attachment.name}`}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-gray-400 transition hover:bg-white/[0.08] hover:text-gray-100"
            >
              <Icons.XMark className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
};

type MarkdownCodeElementProps = {
  children?: React.ReactNode;
  className?: string;
};

const getMarkdownPlainText = (children: React.ReactNode): string =>
  React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child);
      }

      if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
        return getMarkdownPlainText(child.props.children);
      }

      return '';
    })
    .join('');

const markdownComponents: Components = {
  a({ children, href, ...props }) {
    const isAnchorLink = href?.startsWith('#') ?? false;

    return (
      <a
        {...props}
        href={href}
        target={isAnchorLink ? undefined : '_blank'}
        rel={isAnchorLink ? undefined : 'noreferrer'}
        className="font-medium text-primary-200 underline decoration-primary-300/40 underline-offset-2 transition hover:text-primary-100"
      >
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-primary-300/35 pl-3 text-gray-300">
        {children}
      </blockquote>
    );
  },
  code({ children, className, node: _node, ...props }) {
    return (
      <code
        {...props}
        className={`rounded border border-white/10 bg-black/25 px-1 py-0.5 font-mono text-[12px] text-gray-100 ${
          className ?? ''
        }`}
      >
        {children}
      </code>
    );
  },
  del({ children }) {
    return <del className="text-gray-400 decoration-gray-500">{children}</del>;
  },
  h1({ children }) {
    return <h1 className="mb-2 mt-3 text-base font-semibold leading-6 text-white">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-3 text-sm font-semibold leading-5 text-white">{children}</h2>;
  },
  h3({ children }) {
    return (
      <h3 className="mb-1.5 mt-2.5 text-[13px] font-semibold leading-5 text-white">{children}</h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="mb-1 mt-2 text-[13px] font-medium leading-5 text-gray-100">{children}</h4>
    );
  },
  h5({ children }) {
    return <h5 className="mb-1 mt-2 text-xs font-medium leading-5 text-gray-100">{children}</h5>;
  },
  h6({ children }) {
    return <h6 className="mb-1 mt-2 text-xs font-medium leading-5 text-gray-300">{children}</h6>;
  },
  hr() {
    return <hr className="my-3 border-white/10" />;
  },
  img({ alt, ...props }) {
    return (
      <img
        {...props}
        alt={alt ?? ''}
        className="my-2 max-h-64 max-w-full rounded-md border border-white/10 object-contain"
        loading="lazy"
      />
    );
  },
  input(props) {
    return (
      <input {...props} className="mr-1.5 h-3.5 w-3.5 align-[-2px] accent-primary-500" readOnly />
    );
  },
  li({ children }) {
    return <li className="pl-1 leading-5">{children}</li>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
  },
  p({ children }) {
    return <p className="my-2 whitespace-pre-wrap leading-5 first:mt-0 last:mb-0">{children}</p>;
  },
  pre({ children }) {
    const codeElement = React.Children.toArray(children).find((child) =>
      React.isValidElement<MarkdownCodeElementProps>(child),
    );

    if (React.isValidElement<MarkdownCodeElementProps>(codeElement)) {
      const language = /language-([A-Za-z0-9_+#.-]+)/.exec(codeElement.props.className ?? '')?.[1];

      return (
        <CodeBlock
          code={getMarkdownPlainText(codeElement.props.children).replace(/\n$/, '')}
          language={language}
          className="max-h-72 overflow-auto"
        />
      );
    }

    return (
      <pre className="my-2 overflow-auto rounded-md border border-white/10 bg-gray-950/80 p-3 text-[13px] text-gray-100">
        {children}
      </pre>
    );
  },
  strong({ children }) {
    return <strong className="font-semibold text-white">{children}</strong>;
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-auto rounded-md border border-white/10">
        <table className="min-w-full border-collapse text-left text-[12px]">{children}</table>
      </div>
    );
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-white/10">{children}</tbody>;
  },
  td({ children }) {
    return (
      <td className="border-r border-white/10 px-2 py-1.5 text-gray-200 last:border-r-0">
        {children}
      </td>
    );
  },
  th({ children }) {
    return (
      <th className="border-r border-white/10 bg-white/[0.04] px-2 py-1.5 font-semibold text-gray-100 last:border-r-0">
        {children}
      </th>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-white/10">{children}</thead>;
  },
  ul({ children }) {
    return <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
  },
};

const ChatMarkdown: React.FC<{ content: string; className?: string }> = ({
  content,
  className,
}) => (
  <div
    data-selectable-text
    className={`mt-2 min-w-0 text-[13px] leading-5 text-gray-100 ${className ?? ''}`}
  >
    <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
      {content}
    </ReactMarkdown>
  </div>
);

const getLatestShaderArtifactMessage = (chat: AiChatThread | null) => {
  if (!chat) return null;

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.artifact?.type === 'shader' && message.artifact.code.trim()) {
      return message;
    }
  }

  return null;
};

const getLatestPromptPreviewMessage = (chat: AiChatThread | null) => {
  if (!chat) return null;

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.artifact?.type === 'prompt-preview') {
      return message;
    }
  }

  return null;
};

const getChatNode = (chat: AiChatThread | null, nodes: AnyNode[]) => {
  if (!chat?.nodeId) return null;
  return nodes.find((entry) => entry.id === chat.nodeId) ?? null;
};

const getChatBranchVariants = (chat: AiChatThread, branchPointId?: string) => {
  if (!branchPointId || !chat.branches?.length) {
    return [];
  }

  const groupedVariants = chat.branches.filter((branch) =>
    branch.variantOfBranchPointIds?.includes(branchPointId),
  );
  const variants =
    groupedVariants.length > 0
      ? groupedVariants
      : chat.branches.filter((branch) =>
          branch.messages.some((message) => message.branchPointId === branchPointId),
        );

  return variants.sort((first, second) => first.createdAt - second.createdAt);
};

const getActiveChatBranchVariantId = (
  chat: AiChatThread,
  variants: AiChatBranch[],
  branchPointId?: string,
) => {
  if (!branchPointId || variants.length === 0) {
    return chat.activeBranchId;
  }

  const variantIds = new Set(variants.map((branch) => branch.id));
  let branchCursor = chat.activeBranchId
    ? chat.branches?.find((branch) => branch.id === chat.activeBranchId)
    : undefined;
  const visitedBranchIds = new Set<string>();
  while (branchCursor && !visitedBranchIds.has(branchCursor.id)) {
    if (variantIds.has(branchCursor.id)) {
      return branchCursor.id;
    }

    visitedBranchIds.add(branchCursor.id);
    branchCursor = branchCursor.parentBranchId
      ? chat.branches?.find((branch) => branch.id === branchCursor?.parentBranchId)
      : undefined;
  }

  const activeBranchPointMessage = chat.messages.find(
    (message) => message.branchPointId === branchPointId,
  );
  if (!activeBranchPointMessage) {
    return chat.activeBranchId;
  }

  const activeVariant = variants.find((branch) =>
    branch.messages.some((message) => message.id === activeBranchPointMessage.id),
  );
  return activeVariant?.id ?? chat.activeBranchId;
};

const ChatsTab: React.FC = () => {
  const aiChats = useEditorSelector((state) => state.aiChats);
  const activeAiChatId = useEditorSelector((state) => state.activeAiChatId);
  const nodes = useEditorSelector((state) => state.nodes);
  const selectedNode = useSelectedEditorNode();
  const { geminiApiKey, openAiApiKey, openAiBaseUrl, ollamaEndpoint, aiTaskRoutes } =
    usePreferences();
  const {
    applyAiChatGradePreview,
    applyAiChatPromptArtifact,
    applyAiChatShaderArtifact,
    clearAiChatGradePreview,
    continueAiChatPromptPreview,
    createAiChatRegenerationBranch,
    createAiChatUserEditBranch,
    regenerateAiChatPromptPreview,
    removeAiChat,
    selectNode,
    selectAiChatBranch,
    setActiveAiChat,
    setAiChatPromptArtifactDraft,
    setAiChatNodeContext,
    startAssistantChat,
    startShaderChat,
    stopAiChat,
  } = useEditorActions();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [queuedDrafts, setQueuedDrafts] = useState<Record<string, QueuedDraft>>({});
  const [composerAttachments, setComposerAttachments] = useState<
    Record<string, AiChatAttachment[]>
  >({});
  const [isThinkingModeEnabled, setIsThinkingModeEnabled] = useState(true);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [pendingContextNodeId, setPendingContextNodeId] = useState<string | null | undefined>(
    undefined,
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingQueuedChatIdsRef = useRef<Set<string>>(new Set());

  const activeChat = useMemo(
    () => aiChats.find((chat) => chat.id === activeAiChatId) ?? null,
    [activeAiChatId, aiChats],
  );
  const sortedAiChats = useMemo(
    () => [...aiChats].sort((first, second) => second.updatedAt - first.updatedAt),
    [aiChats],
  );
  const activeChatNode = useMemo(() => getChatNode(activeChat, nodes), [activeChat, nodes]);
  const pendingContextNode = useMemo(() => {
    if (activeChat) {
      return null;
    }

    const resolvedNodeId =
      pendingContextNodeId === undefined ? (selectedNode?.id ?? null) : pendingContextNodeId;
    return resolvedNodeId ? (nodes.find((node) => node.id === resolvedNodeId) ?? null) : null;
  }, [activeChat, nodes, pendingContextNodeId, selectedNode]);
  const currentScopeNode = activeChat ? activeChatNode : pendingContextNode;
  const rawMode = getAiChatScopeMode(activeChat?.feature, currentScopeNode);
  const currentMode =
    rawMode === 'action' &&
    currentScopeNode?.type === NodeType.GRADE &&
    aiTaskRoutes.assistantChat.provider !== 'ollama'
      ? 'context'
      : rawMode;
  const latestActiveChatShaderMessage = getLatestShaderArtifactMessage(activeChat);
  const latestActiveChatPromptPreviewMessage = getLatestPromptPreviewMessage(activeChat);
  const activeGradePreview =
    activeChat?.feature === 'assistant' ? (activeChat.toolState?.gradePreview ?? null) : null;
  const activeDraftKey = activeChat?.id ?? `draft:${pendingContextNode?.id ?? 'general'}`;
  const activeDraft = drafts[activeDraftKey] ?? '';
  const activeAttachments = composerAttachments[activeDraftKey] ?? [];
  const activeQueuedDraft = activeChat ? (queuedDrafts[activeChat.id] ?? null) : null;
  const usesShaderRoute = Boolean(
    (activeChat?.feature === 'shader' && isCustomShaderNode(activeChatNode)) ||
    (!activeChat &&
      isCustomShaderNode(pendingContextNode) &&
      isAiActionCapableNode(pendingContextNode)),
  );
  const usesPromptPreviewRoute = Boolean(activeChat && latestActiveChatPromptPreviewMessage);
  const activeRouteTask = usesShaderRoute
    ? 'shaderGeneration'
    : usesPromptPreviewRoute
      ? 'imagePromptTools'
      : 'assistantChat';
  const activeRouteError = getAiTaskRouteError(activeRouteTask, {
    aiTaskRoutes,
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
  });
  const activeRoute = activeRouteError
    ? null
    : resolveAiTaskRoute(activeRouteTask, {
        aiTaskRoutes,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });
  const canToggleThinkingMode = activeRoute?.provider === 'ollama';
  const canCreateNodeFromActiveChat = Boolean(
    activeChat?.feature === 'shader' &&
    activeChat &&
    !activeChatNode &&
    latestActiveChatShaderMessage,
  );
  const canClearContext = activeChat
    ? activeChat.feature === 'assistant' && Boolean(activeChat.nodeId)
    : Boolean(pendingContextNode);
  const canUseSelectedNodeAsContext = Boolean(
    selectedNode &&
    (activeChat?.feature === 'assistant'
      ? !isCustomShaderNode(selectedNode) && selectedNode.id !== activeChat.nodeId
      : !activeChat && selectedNode.id !== pendingContextNode?.id),
  );
  const activeChatScrollKey = activeChat
    ? `${activeChat.updatedAt}:${activeChat.messages.length}:${
        activeChat.messages[activeChat.messages.length - 1]?.status ?? ''
      }`
    : null;

  const submitPrompt = useCallback(
    async (
      prompt: string,
      chatForPrompt: AiChatThread | null = activeChat,
      attachments: AiChatAttachment[] = [],
      branchPoints?: ChatPromptBranchPoints,
    ) => {
      const nextPrompt = prompt.trim();
      if (!nextPrompt && attachments.length === 0) return;

      setComposerError(null);

      try {
        const chatNode = getChatNode(chatForPrompt, nodes);
        if (
          (chatForPrompt?.feature === 'shader' && isCustomShaderNode(chatNode)) ||
          (!chatForPrompt &&
            isCustomShaderNode(pendingContextNode) &&
            isAiActionCapableNode(pendingContextNode))
        ) {
          const targetNode = isCustomShaderNode(chatNode)
            ? chatNode
            : isCustomShaderNode(pendingContextNode)
              ? pendingContextNode
              : null;

          if (!targetNode) {
            throw new Error('Action mode requires a linked Shader node.');
          }

          const route = resolveAiTaskRoute('shaderGeneration', {
            aiTaskRoutes,
            geminiApiKey,
            openAiApiKey,
            openAiBaseUrl,
            ollamaEndpoint,
          });
          await startShaderChat(
            targetNode.id,
            nextPrompt,
            {
              provider: route.provider,
              geminiApiKey: route.geminiApiKey,
              geminiModel: route.geminiModel,
              openAiApiKey: route.openAiApiKey,
              openAiBaseUrl: route.openAiBaseUrl,
              openAiModel: route.openAiModel,
              ollamaEndpoint: route.ollamaEndpoint,
              ollamaModel: route.ollamaModel,
              attachments,
              enableThinking: canToggleThinkingMode ? isThinkingModeEnabled : false,
            },
            branchPoints,
          );
          return;
        }

        const latestPromptPreviewMessage = getLatestPromptPreviewMessage(chatForPrompt);
        if (chatForPrompt && latestPromptPreviewMessage && attachments.length === 0) {
          const route = resolveAiTaskRoute('imagePromptTools', {
            aiTaskRoutes,
            geminiApiKey,
            openAiApiKey,
            openAiBaseUrl,
            ollamaEndpoint,
          });

          await continueAiChatPromptPreview(chatForPrompt.id, nextPrompt, {
            provider: route.provider,
            geminiApiKey: route.geminiApiKey,
            geminiModel: route.geminiModel,
            openAiApiKey: route.openAiApiKey,
            openAiBaseUrl: route.openAiBaseUrl,
            openAiModel: route.openAiModel,
            ollamaEndpoint: route.ollamaEndpoint,
            ollamaModel: route.ollamaModel,
          });
          return;
        }

        const route = resolveAiTaskRoute('assistantChat', {
          aiTaskRoutes,
          geminiApiKey,
          openAiApiKey,
          openAiBaseUrl,
          ollamaEndpoint,
        });
        await startAssistantChat(
          nextPrompt,
          {
            provider: route.provider,
            geminiApiKey: route.geminiApiKey,
            geminiModel: route.geminiModel,
            openAiApiKey: route.openAiApiKey,
            openAiBaseUrl: route.openAiBaseUrl,
            openAiModel: route.openAiModel,
            ollamaEndpoint: route.ollamaEndpoint,
            ollamaModel: route.ollamaModel,
            attachments,
            enableThinking: canToggleThinkingMode ? isThinkingModeEnabled : false,
          },
          chatForPrompt?.feature === 'assistant' ? chatForPrompt.id : null,
          chatForPrompt ? null : (pendingContextNode?.id ?? null),
          branchPoints,
        );
      } catch (error) {
        setComposerError(error instanceof Error ? error.message : 'Chat failed unexpectedly.');
      }
    },
    [
      activeChat,
      aiTaskRoutes,
      geminiApiKey,
      nodes,
      openAiApiKey,
      openAiBaseUrl,
      ollamaEndpoint,
      pendingContextNode,
      canToggleThinkingMode,
      isThinkingModeEnabled,
      continueAiChatPromptPreview,
      startAssistantChat,
      startShaderChat,
    ],
  );

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [activeChat?.id, activeChatScrollKey]);

  useEffect(() => {
    if (!activeAiChatId) {
      return;
    }

    setPendingContextNodeId(undefined);
    setEditingMessageId(null);
    setEditingDraft('');
  }, [activeAiChatId]);

  useEffect(() => {
    if (!activeChat || activeChat.status === 'generating') {
      return;
    }

    if (!activeQueuedDraft || processingQueuedChatIdsRef.current.has(activeChat.id)) {
      return;
    }

    const queuedPrompt = activeQueuedDraft.prompt.trim();
    const queuedAttachments = activeQueuedDraft.attachments;
    if (!queuedPrompt && queuedAttachments.length === 0) {
      return;
    }

    processingQueuedChatIdsRef.current.add(activeChat.id);
    setQueuedDrafts((current) => {
      const next = { ...current };
      delete next[activeChat.id];
      return next;
    });

    void submitPrompt(queuedPrompt, activeChat, queuedAttachments).finally(() => {
      processingQueuedChatIdsRef.current.delete(activeChat.id);
    });
  }, [activeChat, activeQueuedDraft, submitPrompt]);

  const handleSelectChat = (chat: AiChatThread) => {
    const linkedNode = getChatNode(chat, nodes);

    setComposerError(null);
    if (linkedNode) {
      selectNode(linkedNode.id);
    }
    setActiveAiChat(chat.id);
  };

  const handleNewChat = () => {
    setComposerError(null);
    setPendingContextNodeId(undefined);
    setActiveAiChat(null);
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });
  };

  const handleBackToChats = () => {
    setComposerError(null);
    setActiveAiChat(null);
  };

  const handleRemoveChat = (chat: AiChatThread) => {
    const shouldRemove = window.confirm(`Remove "${chat.title}" from Chats?`);
    if (!shouldRemove) {
      return;
    }

    setComposerError(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[chat.id];
      return next;
    });
    setQueuedDrafts((current) => {
      const next = { ...current };
      delete next[chat.id];
      return next;
    });
    setComposerAttachments((current) => {
      const next = { ...current };
      delete next[chat.id];
      return next;
    });
    processingQueuedChatIdsRef.current.delete(chat.id);
    removeAiChat(chat.id);
  };

  const handleClearContext = () => {
    setComposerError(null);

    if (activeChat?.feature === 'assistant') {
      setAiChatNodeContext(activeChat.id, null);
      return;
    }

    setPendingContextNodeId(null);
  };

  const handleCopyMessage = async (message: AiChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = message.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

  const handleUseSelectedNodeAsContext = () => {
    if (!selectedNode) {
      return;
    }

    setComposerError(null);

    if (activeChat?.feature === 'assistant') {
      setAiChatNodeContext(activeChat.id, selectedNode.id);
      return;
    }

    setPendingContextNodeId(selectedNode.id);
  };

  const handleAttachFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    const existingAttachments = composerAttachments[activeDraftKey] ?? [];
    const remainingSlots = MAX_CHAT_ATTACHMENTS - existingAttachments.length;
    if (remainingSlots <= 0) {
      setComposerError(`Attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`);
      return;
    }

    const selectedFiles = files.slice(0, remainingSlots);
    const errors: string[] = [];
    if (files.length > remainingSlots) {
      errors.push(
        `Only ${remainingSlots} more file${remainingSlots === 1 ? '' : 's'} can be attached.`,
      );
    }

    const nextAttachments: AiChatAttachment[] = [];
    for (const file of selectedFiles) {
      const kind = getAttachmentKind(file);

      if (kind === 'image' && file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        errors.push(
          `${file.name} is larger than ${formatAttachmentSize(MAX_IMAGE_ATTACHMENT_BYTES)}.`,
        );
        continue;
      }

      if (kind === 'text' && file.size > MAX_TEXT_ATTACHMENT_BYTES) {
        errors.push(
          `${file.name} is larger than ${formatAttachmentSize(MAX_TEXT_ATTACHMENT_BYTES)} for text preview.`,
        );
        continue;
      }

      try {
        const baseAttachment = {
          id: createAttachmentId(),
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          kind,
        } satisfies AiChatAttachment;

        if (kind === 'image') {
          nextAttachments.push({
            ...baseAttachment,
            dataUrl: await readFileAsDataUrl(file),
          });
        } else if (kind === 'text') {
          nextAttachments.push({
            ...baseAttachment,
            text: await readFileAsText(file),
          });
        } else {
          nextAttachments.push(baseAttachment);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Failed to attach ${file.name}.`);
      }
    }

    if (nextAttachments.length > 0) {
      setComposerAttachments((current) => ({
        ...current,
        [activeDraftKey]: [...(current[activeDraftKey] ?? []), ...nextAttachments],
      }));
    }

    setComposerError(errors.length > 0 ? errors.join(' ') : null);
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setComposerAttachments((current) => ({
      ...current,
      [activeDraftKey]: (current[activeDraftKey] ?? []).filter(
        (attachment) => attachment.id !== attachmentId,
      ),
    }));
  };

  const clearActiveComposer = () => {
    setDrafts((current) => ({ ...current, [activeDraftKey]: '' }));
    setComposerAttachments((current) => {
      const next = { ...current };
      delete next[activeDraftKey];
      return next;
    });
  };

  const handleSend = async () => {
    const nextPrompt = activeDraft.trim();
    if (!nextPrompt && activeAttachments.length === 0) return;

    setComposerError(null);
    clearActiveComposer();

    if (activeChat?.status === 'generating') {
      setQueuedDrafts((current) => ({
        ...current,
        [activeChat.id]: {
          prompt: nextPrompt,
          attachments: activeAttachments,
        },
      }));
      return;
    }

    await submitPrompt(nextPrompt, activeChat, activeAttachments);
  };

  const handleStopActiveChat = () => {
    if (!activeChat) return;
    setComposerError(null);
    stopAiChat(activeChat.id);
  };

  const handleSendQueuedNow = () => {
    if (!activeChat || !activeQueuedDraft) return;

    const queuedPrompt = activeQueuedDraft.prompt.trim();
    const queuedAttachments = activeQueuedDraft.attachments;
    if (!queuedPrompt && queuedAttachments.length === 0) return;

    setComposerError(null);
    setQueuedDrafts((current) => {
      const next = { ...current };
      delete next[activeChat.id];
      return next;
    });
    stopAiChat(activeChat.id);
    void submitPrompt(queuedPrompt, activeChat, queuedAttachments);
  };

  const handleDiscardQueuedDraft = () => {
    if (!activeChat) return;

    setQueuedDrafts((current) => {
      const next = { ...current };
      delete next[activeChat.id];
      return next;
    });
  };

  const handleCreateNodeFromActiveChat = () => {
    if (!activeChat || !latestActiveChatShaderMessage) return;
    setComposerError(null);
    applyAiChatShaderArtifact(activeChat.id, latestActiveChatShaderMessage.id);
  };

  const handleStartEditingMessage = (message: AiChatMessage) => {
    setComposerError(null);
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  };

  const handleCancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingDraft('');
  };

  const handleSaveEditedMessage = async (chat: AiChatThread, message: AiChatMessage) => {
    const nextPrompt = editingDraft.trim();
    if (!nextPrompt || chat.status === 'generating' || activeRouteError) {
      return;
    }

    const branchPointId = createAiChatUserEditBranch(chat.id, message.id) as string | null;
    if (!branchPointId) {
      return;
    }

    setEditingMessageId(null);
    setEditingDraft('');
    await submitPrompt(nextPrompt, chat, message.attachments ?? [], {
      userBranchPointId: branchPointId,
    });
  };

  const handleRegenerateMessage = async (chat: AiChatThread, message: AiChatMessage) => {
    if (chat.status === 'generating') {
      return;
    }

    if (message.artifact?.type === 'prompt-preview') {
      const promptRouteError = getAiTaskRouteError('imagePromptTools', {
        aiTaskRoutes,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });
      if (promptRouteError) {
        setComposerError(promptRouteError);
        return;
      }

      const route = resolveAiTaskRoute('imagePromptTools', {
        aiTaskRoutes,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });

      setComposerError(null);
      await regenerateAiChatPromptPreview(chat.id, message.id, {
        provider: route.provider,
        geminiApiKey: route.geminiApiKey,
        geminiModel: route.geminiModel,
        openAiApiKey: route.openAiApiKey,
        openAiBaseUrl: route.openAiBaseUrl,
        openAiModel: route.openAiModel,
        ollamaEndpoint: route.ollamaEndpoint,
        ollamaModel: route.ollamaModel,
      });
      return;
    }

    if (activeRouteError) {
      return;
    }

    const prepared = createAiChatRegenerationBranch(
      chat.id,
      message.id,
    ) as PreparedChatBranchPrompt | null;
    if (!prepared) {
      return;
    }

    setComposerError(null);
    await submitPrompt(prepared.prompt, chat, prepared.attachments ?? [], prepared.branchPoints);
  };

  const handleSelectBranchVariant = (
    chat: AiChatThread,
    branchId: string,
    branchPointId?: string,
  ) => {
    if (chat.status === 'generating' || !branchPointId) {
      return;
    }

    setComposerError(null);
    setEditingMessageId(null);
    setEditingDraft('');
    selectAiChatBranch(chat.id, branchId, branchPointId);
  };

  const renderMessage = (chat: AiChatThread, message: AiChatMessage) => {
    const isAssistant = message.role === 'assistant';
    const isEditingMessage = editingMessageId === message.id;
    const artifact = message.artifact?.type === 'shader' ? message.artifact : null;
    const gradePreviewArtifact =
      message.artifact?.type === 'grade-preview' ? message.artifact : null;
    const promptPreviewArtifact =
      message.artifact?.type === 'prompt-preview' ? message.artifact : null;
    const thinking = message.thinking?.trim() ?? '';
    const hasThinking = Boolean(thinking);
    const linkedShaderNode = isCustomShaderNode(activeChatNode)
      ? activeChatNode
      : isCustomShaderNode(getChatNode(chat, nodes))
        ? (getChatNode(chat, nodes) as CustomShaderNode)
        : null;
    const canApplyArtifact = Boolean(artifact?.code.trim()) && message.status !== 'pending';
    const shaderSuggestions = message.status === 'complete' ? (artifact?.suggestions ?? []) : [];
    const promptPreviewSuggestions =
      message.status === 'complete' ? (promptPreviewArtifact?.suggestions ?? []) : [];
    const chatSuggestions =
      shaderSuggestions.length > 0 ? shaderSuggestions : promptPreviewSuggestions;
    const canApplyPromptArtifact =
      Boolean(promptPreviewArtifact?.draft.trim()) && message.status !== 'pending';
    const hasVisibleContent = Boolean(message.content.trim());
    const messageAttachments = message.attachments ?? [];
    const shouldRenderStandaloneContent =
      !isEditingMessage && hasVisibleContent && !gradePreviewArtifact && !promptPreviewArtifact;
    const shouldShowSkeleton =
      !isEditingMessage && isAssistant && message.status === 'pending' && !hasVisibleContent;
    const messageProvider =
      message.provider ??
      artifact?.provider ??
      gradePreviewArtifact?.provider ??
      (isAssistant ? aiTaskRoutes.assistantChat.provider : aiTaskRoutes.shaderGeneration.provider);
    const providerLabel = isAssistant ? getProviderLabel(messageProvider) : null;
    const modelLabel = isAssistant
      ? (message.model ??
        artifact?.model ??
        gradePreviewArtifact?.model ??
        (isAssistant ? aiTaskRoutes.assistantChat.model : aiTaskRoutes.shaderGeneration.model))
      : null;
    const pendingPhaseLabel =
      message.status === 'pending' ? getPendingMessagePhaseLabel(message) : null;
    const messageIndex = chat.messages.findIndex((entry) => entry.id === message.id);
    const hasPreviousUserMessage =
      messageIndex > 0 &&
      chat.messages.slice(0, messageIndex).some((entry) => entry.role === 'user');
    const canEditMessage =
      !isAssistant &&
      message.status !== 'pending' &&
      chat.status !== 'generating' &&
      !activeRouteError;
    const messageRegenerateRouteError =
      message.artifact?.type === 'prompt-preview'
        ? getAiTaskRouteError('imagePromptTools', {
            aiTaskRoutes,
            geminiApiKey,
            openAiApiKey,
            openAiBaseUrl,
            ollamaEndpoint,
          })
        : activeRouteError;
    const canRegenerateMessage =
      isAssistant &&
      message.status !== 'pending' &&
      chat.status !== 'generating' &&
      !messageRegenerateRouteError &&
      hasPreviousUserMessage;
    const branchVariants = getChatBranchVariants(chat, message.branchPointId);
    const activeBranchVariantId = getActiveChatBranchVariantId(
      chat,
      branchVariants,
      message.branchPointId,
    );
    const hasMessageActions =
      !isEditingMessage && (canEditMessage || canRegenerateMessage || branchVariants.length > 1);
    const messageActionControls = hasMessageActions ? (
      <div className="mt-2 flex items-center justify-end gap-1.5 opacity-50 transition-opacity group-hover/message:opacity-100">
        <BranchVariantControls
          variants={branchVariants}
          activeBranchId={activeBranchVariantId}
          disabled={chat.status === 'generating'}
          onSelect={(branchId) => handleSelectBranchVariant(chat, branchId, message.branchPointId)}
        />
        {canEditMessage ? (
          <BubbleActionButton
            label="Edit prompt"
            onClick={() => handleStartEditingMessage(message)}
            icon={<Icons.Pencil className="h-3.5 w-3.5" />}
          />
        ) : null}
        {canRegenerateMessage ? (
          <BubbleActionButton
            label="Regenerate response"
            onClick={() => {
              void handleRegenerateMessage(chat, message);
            }}
            icon={<Icons.RotateLoop className="h-3.5 w-3.5" />}
          />
        ) : null}
      </div>
    ) : null;

    return (
      <div
        key={message.id}
        className={`group/message overflow-hidden rounded-lg border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-colors ${
          isAssistant
            ? 'border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.035]'
            : 'border-primary-300/20 bg-primary-400/[0.08] hover:bg-primary-400/[0.1]'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
          <div
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${isAssistant ? 'bg-primary-500/15 text-primary-300' : 'bg-white/10 text-gray-300'}`}
          >
            {isAssistant ? (
              <Icons.Sparkles className="h-3 w-3" />
            ) : (
              <Icons.UserCircle className="h-3 w-3" />
            )}
          </div>
          <span className="shrink-0">{isAssistant ? 'Assistant' : 'You'}</span>
          {providerLabel ? <MessageMetaChip>{providerLabel}</MessageMetaChip> : null}
          {modelLabel ? (
            <span className="min-w-0 flex-1">
              <MessageMetaChip mono>{modelLabel}</MessageMetaChip>
            </span>
          ) : null}
          {pendingPhaseLabel ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-gray-500">
              <Spinner className="h-3 w-3 shrink-0" />
              <span>{pendingPhaseLabel}</span>
            </span>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover/message:opacity-100">
            <button
              type="button"
              onClick={() => handleCopyMessage(message)}
              aria-label="Copy message"
              title="Copy message"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 transition hover:bg-white/[0.07] hover:text-gray-200"
            >
              {copiedMessageId === message.id ? (
                <Icons.Check className="h-3 w-3 text-green-400" />
              ) : (
                <Icons.Copy className="h-3 w-3" />
              )}
            </button>
            <span className="text-gray-600">{formatChatTime(message.createdAt)}</span>
          </div>
        </div>

        {hasThinking ? (
          <CompactDisclosure
            title="Thinking"
            preview={thinking}
            className="mt-2"
            contentClassName="ml-[11px] mt-1 pl-4"
            indicator={
              message.isThinking ? (
                <span className="h-1.5 w-1.5 rounded-full bg-primary-300/80 shadow-[0_0_8px_rgba(var(--color-primary-300),0.45)] animate-pulse" />
              ) : null
            }
          >
            <ScrollArea axis="y" viewportClassName="max-h-40">
              <ChatMarkdown content={thinking} className="text-gray-400" />
            </ScrollArea>
          </CompactDisclosure>
        ) : null}

        {messageAttachments.length > 0 ? (
          <div className="mt-2">
            <AttachmentList attachments={messageAttachments} />
          </div>
        ) : null}

        {isEditingMessage ? (
          <div className="mt-2 space-y-2">
            <ResizableScrollTextarea
              value={editingDraft}
              onChange={(event) => setEditingDraft(event.currentTarget.value)}
              resizeLabel="Resize edited message"
            />
            <div className="flex items-center justify-end gap-1.5">
              <BubbleActionButton
                label="Cancel edit"
                onClick={handleCancelEditingMessage}
                icon={<Icons.XMark className="h-3.5 w-3.5" />}
              />
              <BubbleActionButton
                label="Save and regenerate"
                onClick={() => {
                  void handleSaveEditedMessage(chat, message);
                }}
                disabled={
                  !editingDraft.trim() || chat.status === 'generating' || Boolean(activeRouteError)
                }
                icon={<Icons.Check className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
        ) : null}

        {shouldRenderStandaloneContent ? (
          <ChatMarkdown content={message.content} />
        ) : shouldShowSkeleton ? (
          <MessageSkeleton />
        ) : null}

        {artifact ? (
          <div className="mt-3 space-y-2.5 rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
            <CodeBlock code={artifact.code} language="glsl" className="max-h-72 overflow-auto" />

            <div className="flex flex-wrap gap-2">
              {canApplyArtifact && (
                <button
                  type="button"
                  onClick={() => applyAiChatShaderArtifact(chat.id, message.id)}
                  className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-500"
                >
                  {linkedShaderNode ? 'Apply Shader' : 'Create Shader Node'}
                </button>
              )}
            </div>
          </div>
        ) : null}
        {gradePreviewArtifact ? (
          <PreviewArtifactPanel color="yellow">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-100">
              <span className="rounded-full border border-amber-300/20 bg-amber-200/10 px-2 py-1">
                Grade Preview
              </span>
              {activeChat?.id === chat.id && activeGradePreview ? (
                <span className="rounded-full border border-amber-300/20 bg-amber-200/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-50">
                  Staged
                </span>
              ) : null}
            </div>
            <p className="text-[13px] leading-5 text-amber-50">
              {gradePreviewArtifact.summary || 'A staged Grade preview is ready for review.'}
            </p>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-amber-50/90">
              <span className="rounded-full border border-amber-300/15 bg-black/10 px-2 py-1">
                Brightness {gradePreviewArtifact.values.brightness}
              </span>
              <span className="rounded-full border border-amber-300/15 bg-black/10 px-2 py-1">
                Contrast {gradePreviewArtifact.values.contrast}
              </span>
              <span className="rounded-full border border-amber-300/15 bg-black/10 px-2 py-1">
                Saturation {gradePreviewArtifact.values.saturation}
              </span>
            </div>
            {activeChat?.id === chat.id && activeGradePreview ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyAiChatGradePreview(chat.id)}
                  className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-500"
                >
                  Apply to Node
                </button>
                <button
                  type="button"
                  onClick={() => clearAiChatGradePreview(chat.id)}
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-white/10"
                >
                  Clear Preview
                </button>
              </div>
            ) : null}
          </PreviewArtifactPanel>
        ) : null}
        {promptPreviewArtifact ? (
          <PreviewArtifactPanel color="cyan">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-50">
              <span className="rounded-full border border-cyan-200/20 bg-cyan-100/[0.08] px-2 py-1">
                Prompt Draft
              </span>
              <span className="rounded-full border border-cyan-200/10 bg-black/10 px-2 py-1 text-cyan-100/85">
                {promptPreviewArtifact.target.controlLabel}
              </span>
            </div>
            <p className="text-[13px] leading-5 text-cyan-50">
              {promptPreviewArtifact.summary ||
                'Review the refined prompt, edit it if needed, then apply it to the field.'}
            </p>
            <CompactDisclosure
              title="Original"
              preview={promptPreviewArtifact.originalPrompt}
              contentClassName="ml-[11px] mt-1 pl-4"
              tone="cyan"
            >
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-cyan-50/85">
                {promptPreviewArtifact.originalPrompt}
              </p>
            </CompactDisclosure>
            {promptPreviewArtifact.options.length > 0 ? (
              <div className="space-y-1.5">
                {promptPreviewArtifact.options.map((option, index) => {
                  const isSelected = promptPreviewArtifact.draft === option;
                  return (
                    <button
                      key={`${message.id}-prompt-option-${index}`}
                      type="button"
                      onClick={() => setAiChatPromptArtifactDraft(chat.id, message.id, option)}
                      className={`w-full rounded-xl border px-2.5 py-2 text-left text-xs transition ${
                        isSelected
                          ? 'border-cyan-200/30 bg-cyan-200/[0.12] text-cyan-50'
                          : 'border-white/[0.07] bg-white/[0.035] text-gray-200 hover:bg-white/[0.065]'
                      }`}
                    >
                      <span
                        className={`block text-[10px] font-semibold uppercase tracking-[0.12em] ${
                          isSelected ? 'text-cyan-100/70' : 'text-gray-400'
                        }`}
                      >
                        Option {index + 1}
                      </span>
                      <span className="mt-1 block truncate text-[12px] normal-case tracking-normal text-inherit">
                        {option}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <ResizableScrollTextarea
              value={promptPreviewArtifact.draft}
              onChange={(event) =>
                setAiChatPromptArtifactDraft(chat.id, message.id, event.currentTarget.value)
              }
              resizeLabel="Resize prompt draft"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyAiChatPromptArtifact(chat.id, message.id)}
                disabled={!canApplyPromptArtifact}
                className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply to Field
              </button>
              <button
                type="button"
                onClick={() =>
                  setAiChatPromptArtifactDraft(
                    chat.id,
                    message.id,
                    promptPreviewArtifact.options[0] ?? promptPreviewArtifact.originalPrompt,
                  )
                }
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-gray-200 transition hover:bg-white/[0.07]"
              >
                Reset Draft
              </button>
            </div>
          </PreviewArtifactPanel>
        ) : null}
        {chatSuggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {chatSuggestions.map((suggestion) => (
              <button
                key={`${message.id}-${suggestion}`}
                type="button"
                onClick={() =>
                  setDrafts((current) => ({
                    ...current,
                    [chat.id]: suggestion,
                  }))
                }
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-xs text-gray-200 transition-all hover:bg-white/10 hover:border-white/15 hover:shadow-sm"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {messageActionControls}
      </div>
    );
  };

  const scopeLabel = getAiChatScopeLabel(currentScopeNode);
  const capabilityLabel = getAiChatCapabilityLabel(currentMode);
  const modeDescription = getAiChatModeDescription(currentMode);
  const scopeTone = currentMode === 'action' ? 'accent' : 'neutral';
  const capabilityTone = currentMode === 'action' ? 'success' : 'neutral';
  const title = activeChat ? (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={handleBackToChats}
        className="text-gray-400 transition hover:text-gray-100"
      >
        Chats
      </button>
      <span className="text-gray-600">/</span>
      <span className="min-w-0 truncate text-gray-200">{activeChat.title}</span>
    </div>
  ) : (
    <div className="flex items-center gap-1.5">
      <span>Chats</span>
    </div>
  );
  const headerMeta = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <ScopeChip tone={scopeTone}>{scopeLabel}</ScopeChip>
      {capabilityLabel && <ScopeChip tone={capabilityTone}>{capabilityLabel}</ScopeChip>}
    </div>
  );
  const headerActions = (
    <div className="flex items-center gap-1.5">
      {activeChat ? (
        <IconButton
          label="Remove Chat"
          onClick={() => handleRemoveChat(activeChat)}
          icon={<Icons.Trash className="h-3.5 w-3.5" />}
        />
      ) : null}
      <IconButton
        label="New Chat"
        onClick={handleNewChat}
        icon={<Icons.Plus className="h-3.5 w-3.5" />}
      />
    </div>
  );

  const composerStatusText = activeChat
    ? activeChat.feature === 'shader'
      ? activeChatNode
        ? `Linked to ${activeChatNode.name}. This thread can assist and apply shader-specific actions.`
        : 'This action thread is detached from its shader node.'
      : currentScopeNode
        ? supportsAiNodeTools(currentScopeNode) && aiTaskRoutes.assistantChat.provider === 'ollama'
          ? `${currentScopeNode.name} is attached with tool-backed actions. Changes stay staged until you apply the preview.`
          : `${currentScopeNode.name} is attached as visible context. The assistant can advise but will not change the node directly.`
        : 'This is a generic assistant thread without attached node context.'
    : currentMode === 'action' && currentScopeNode
      ? `${currentScopeNode.name} is selected. Sending will start a tool-backed action thread for this node.`
      : currentScopeNode
        ? `${currentScopeNode.name} is selected as optional context. You can clear it before sending.`
        : 'No node context is attached. Start a general assistant chat or select a node first.';

  const isActiveChatGenerating = activeChat?.status === 'generating';
  const isSendDisabled =
    (!activeDraft.trim() && activeAttachments.length === 0) ||
    (activeChat?.feature === 'shader' && !isCustomShaderNode(activeChatNode)) ||
    Boolean(activeRouteError);
  const sendButtonLabel = isActiveChatGenerating ? 'Queue Message' : 'Send';
  const sendHotkeyLabel = isActiveChatGenerating ? 'Queue with' : 'Send with';
  const contextButtonNodeName = canClearContext
    ? (currentScopeNode?.name ?? 'Missing Context')
    : canUseSelectedNodeAsContext
      ? (selectedNode?.name ?? null)
      : null;
  const contextButtonLabel = canClearContext
    ? `Remove ${contextButtonNodeName ?? 'Context'}`
    : `Add ${contextButtonNodeName ?? 'Context'}`;
  const handleContextButtonClick = canClearContext
    ? handleClearContext
    : handleUseSelectedNodeAsContext;
  const sendHotkeyKeys = formatHotkeyCombo('Mod+Enter');
  const isMac = isMacPlatform();

  return (
    <div data-text-selection-scope className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SubPanelHeader title={title} meta={headerMeta} actions={headerActions} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeChat ? (
          <ScrollArea ref={messagesRef} fill axis="y" contentClassName="space-y-2.5 px-2 py-2">
            <>
              {activeChat.lastError ? (
                <div
                  data-selectable-text
                  className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200"
                >
                  {activeChat.lastError}
                </div>
              ) : null}
              {activeChat.messages.map((message) => renderMessage(activeChat, message))}
            </>
          </ScrollArea>
        ) : (
          <ScrollArea fill axis="y" contentClassName="space-y-1.5 px-2 py-2">
            <>
              {sortedAiChats.length > 0 ? (
                sortedAiChats.map((chat) => {
                  const chatNode = getChatNode(chat, nodes);
                  const chatMode = getAiChatScopeMode(chat.feature, chatNode);
                  const latestMessage = chat.messages[chat.messages.length - 1];
                  const chatPreview =
                    chat.status === 'generating'
                      ? 'Generating...'
                      : chat.lastError
                        ? 'Needs attention'
                        : latestMessage?.content || 'Ready';

                  return (
                    <div
                      key={chat.id}
                      className="group flex w-full min-w-0 items-stretch gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-1.5 text-left text-gray-300 transition-all hover:border-white/[0.12] hover:bg-white/[0.055] hover:shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectChat(chat)}
                        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-white/[0.035]"
                      >
                        <div
                          className={`relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
                            chat.status === 'generating'
                              ? 'border-primary-400/30 bg-primary-500/15 text-primary-200'
                              : chat.lastError
                                ? 'border-red-400/30 bg-red-500/15 text-red-200'
                                : 'border-white/[0.07] bg-white/[0.035] text-gray-300'
                          }`}
                        >
                          {chat.feature === 'shader' ? (
                            <Icons.CodeBracket className="h-3.5 w-3.5" />
                          ) : (
                            <Icons.Sparkles className="h-3.5 w-3.5" />
                          )}
                          {chat.status === 'generating' && (
                            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-400 animate-pulse" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-100">
                              {chat.title}
                            </span>
                            <ScopeChip tone={chatMode === 'action' ? 'accent' : 'neutral'}>
                              {chatMode === 'action' ? 'Action' : chatNode ? 'Context' : 'General'}
                            </ScopeChip>
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-gray-500">
                            <span className="shrink-0">{formatChatTime(chat.updatedAt)}</span>
                            <span className="text-gray-700">/</span>
                            <span
                              className={`min-w-0 truncate ${
                                chat.lastError ? 'text-red-300/70' : 'text-gray-500'
                              }`}
                              title={chatPreview}
                            >
                              {chatPreview}
                            </span>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveChat(chat)}
                        aria-label={`Remove ${chat.title}`}
                        title="Remove chat"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-gray-500 opacity-0 transition-all hover:border-red-300/20 hover:bg-red-500/10 hover:text-red-100 group-hover:opacity-100"
                      >
                        <Icons.Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="flex min-h-40 items-center justify-center px-3 py-3 text-center">
                  <div className="max-w-xs">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-primary-500/30 bg-gradient-to-br from-primary-500/15 to-primary-600/5 text-primary-200 shadow-lg shadow-primary-500/10">
                      <Icons.Sparkles className="h-4 w-4" />
                    </div>
                    <h3 className="mt-3 text-sm font-medium text-white">Start a chat</h3>
                    <p className="mt-1.5 text-xs leading-5 text-gray-400">{modeDescription}</p>
                    {currentScopeNode && (
                      <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                        <p className="text-[10px] text-gray-500">Context</p>
                        <p className="text-xs font-medium text-gray-300">{currentScopeNode.name}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          </ScrollArea>
        )}

        {/* Composer */}
        <div className="shrink-0 border-t border-white/[0.07] bg-black/[0.08] p-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-gray-500">
            <div className="flex shrink-0 items-center gap-1.5">
              {contextButtonNodeName ? (
                <button
                  type="button"
                  onClick={handleContextButtonClick}
                  aria-label={contextButtonLabel}
                  title={contextButtonLabel}
                  className="inline-flex max-w-36 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-gray-200 transition-all hover:bg-white/[0.07] hover:border-white/[0.12]"
                >
                  {canClearContext ? (
                    <Icons.XMark className="h-3 w-3 shrink-0" />
                  ) : (
                    <Icons.Plus className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">{contextButtonNodeName}</span>
                </button>
              ) : null}
              {activeChat?.feature === 'shader' && !activeChatNode ? (
                <button
                  type="button"
                  onClick={handleCreateNodeFromActiveChat}
                  disabled={!canCreateNodeFromActiveChat}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-gray-200 transition-all hover:bg-white/[0.07] hover:border-white/[0.12] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-gray-500"
                >
                  Create Node
                </button>
              ) : null}
            </div>
            <span className="min-w-0 flex-1 truncate text-[10px]">{composerStatusText}</span>
          </div>

          {composerError ? (
            <div
              data-selectable-text
              className="mb-2 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-200"
            >
              {composerError}
            </div>
          ) : null}

          {activeRouteError ? (
            <div
              data-selectable-text
              className="mb-2 rounded-md border border-yellow-500/20 bg-yellow-500/10 p-2 text-xs text-yellow-100"
            >
              {activeRouteError}
            </div>
          ) : null}

          {isActiveChatGenerating || activeQueuedDraft ? (
            <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-[11px] text-gray-400">
              {isActiveChatGenerating ? <Spinner className="h-3 w-3 shrink-0" /> : null}
              {activeQueuedDraft ? (
                <span
                  className="min-w-0 flex-1 truncate text-gray-300"
                  title={getQueuedDraftPreview(activeQueuedDraft)}
                >
                  Queued: {getQueuedDraftPreview(activeQueuedDraft)}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate">New messages will queue.</span>
              )}
              {activeQueuedDraft ? (
                <button
                  type="button"
                  onClick={handleSendQueuedNow}
                  className="shrink-0 rounded-md border border-primary-400/25 bg-primary-500/10 px-2 py-1 text-primary-100 transition hover:bg-primary-500/15"
                >
                  Send now
                </button>
              ) : null}
              {isActiveChatGenerating ? (
                <button
                  type="button"
                  onClick={handleStopActiveChat}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-gray-200 transition hover:bg-white/[0.07]"
                >
                  <Icons.Pause className="h-3 w-3" />
                  Stop
                </button>
              ) : null}
              {activeQueuedDraft ? (
                <button
                  type="button"
                  onClick={handleDiscardQueuedDraft}
                  aria-label="Discard queued message"
                  title="Discard queued message"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-gray-300 transition hover:bg-white/[0.07]"
                >
                  <Icons.XMark className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-white/[0.12] focus-within:bg-white/[0.035]">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(event) => {
                void handleAttachFiles(event);
              }}
              className="hidden"
            />
            {activeAttachments.length > 0 ? (
              <div className="mb-1.5">
                <AttachmentList attachments={activeAttachments} onRemove={handleRemoveAttachment} />
              </div>
            ) : null}
            <textarea
              ref={composerInputRef}
              value={activeDraft}
              onChange={(event) => {
                setComposerError(null);
                setDrafts((current) => ({
                  ...current,
                  [activeDraftKey]: event.target.value,
                }));
              }}
              onKeyDown={(event) => {
                const isSendHotkey =
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.altKey &&
                  (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

                if (!isSendHotkey) {
                  return;
                }

                event.preventDefault();
                if (!isSendDisabled) {
                  void handleSend();
                }
              }}
              rows={2}
              placeholder={getAiChatComposerPlaceholder(currentMode)}
              className="w-full resize-none bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none"
            />
            <div className="mt-1 flex min-h-6 items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={activeAttachments.length >= MAX_CHAT_ATTACHMENTS}
                aria-label="Attach images or files"
                title="Attach images or files"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-gray-400 transition hover:bg-white/[0.06] hover:text-gray-200 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-gray-600"
              >
                <Icons.DocumentPlus className="h-3.5 w-3.5" />
              </button>
              {canToggleThinkingMode && (
                <button
                  type="button"
                  onClick={() => setIsThinkingModeEnabled((enabled) => !enabled)}
                  aria-pressed={isThinkingModeEnabled}
                  aria-label={
                    isThinkingModeEnabled
                      ? 'Disable thinking mode'
                      : 'Enable thinking mode for supported models'
                  }
                  title={
                    isThinkingModeEnabled
                      ? 'Thinking on'
                      : 'Thinking off - enable for supported models'
                  }
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition ${
                    isThinkingModeEnabled
                      ? 'border-primary-400/30 bg-primary-500/10 text-primary-100 hover:bg-primary-500/15'
                      : 'border-white/[0.08] bg-white/[0.03] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300'
                  }`}
                >
                  <Icons.LightBulb className="h-3.5 w-3.5" />
                </button>
              )}
              <p className="min-w-0 flex-1 truncate text-[11px] text-gray-500">
                {activeRouteError
                  ? activeRouteError
                  : activeRoute
                    ? `Using ${getProviderLabel(activeRoute.provider)}${activeRoute.model ? ` (${activeRoute.model})` : ''}.`
                    : 'Choose an AI route in Preferences > Integrations.'}
              </p>
              {!isSendDisabled ? <KeyHint keys={sendHotkeyKeys} label={sendHotkeyLabel} /> : null}
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isSendDisabled}
                aria-label={sendButtonLabel}
                title={sendButtonLabel}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-500/30 text-primary-100 transition hover:bg-primary-500/50 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-gray-500"
              >
                <Icons.ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatsTab;
