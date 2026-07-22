import React, { useState } from 'react';
import * as Icons from '@blackboard/icons';
import { Badge } from '@blackboard/ui';
import type { ModelConsumer } from '@/services/models/modelUsageRegistry';
import ModelUsageChips from './ModelUsageChips';

interface ModelLibraryCardHeaderProps {
  name: string;
  originLabel: string;
  targetLabel?: string;
  badges: readonly string[];
  repoName: string;
  expanded: boolean;
  consumers: readonly ModelConsumer[];
  onToggle: () => void;
}

export function ModelMetadataBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge size="sm" shrink className="text-gray-500">
      {children}
    </Badge>
  );
}

export default function ModelLibraryCardHeader({
  name,
  originLabel,
  targetLabel,
  badges,
  repoName,
  expanded,
  consumers,
  onToggle,
}: ModelLibraryCardHeaderProps) {
  const [repoCopied, setRepoCopied] = useState(false);
  const repositoryUrl = `https://huggingface.co/${repoName}`;

  const copyRepositoryLink = async () => {
    await navigator.clipboard?.writeText(repositoryUrl);
    setRepoCopied(true);
    window.setTimeout(() => setRepoCopied(false), 1400);
  };

  return (
    <div className="p-3">
      <button type="button" onClick={onToggle} className="block w-full text-left">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="mr-0.5 min-w-0 truncate text-sm font-medium text-white">{name}</p>
              <ModelMetadataBadge>{originLabel}</ModelMetadataBadge>
              {targetLabel ? <ModelMetadataBadge>{targetLabel}</ModelMetadataBadge> : null}
              {badges.map((badge) => (
                <ModelMetadataBadge key={badge}>{badge}</ModelMetadataBadge>
              ))}
            </div>
          </div>
          <Icons.ChevronRight
            className={`mt-1 h-3.5 w-3.5 shrink-0 text-gray-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      <div className="mt-1 flex min-w-0 items-center gap-1">
        <a
          href={repositoryUrl}
          target="_blank"
          rel="noreferrer"
          title={`Open ${repoName} on Hugging Face`}
          className="min-w-0 truncate font-mono text-[10px] text-gray-600 transition-colors hover:text-gray-300"
        >
          {repoName}
        </a>
        <button
          type="button"
          onClick={() => void copyRepositoryLink()}
          title={repoCopied ? 'Copied' : 'Copy repository link'}
          aria-label={repoCopied ? 'Repository link copied' : 'Copy repository link'}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
        >
          {repoCopied ? (
            <Icons.Check className="h-3 w-3 text-emerald-300" />
          ) : (
            <Icons.Copy className="h-3 w-3" />
          )}
        </button>
      </div>

      {consumers.length > 0 ? (
        <div className="mt-2 flex items-start gap-2">
          <span className="shrink-0 pt-1 text-[9px] font-semibold uppercase tracking-wider text-gray-600">
            Used by
          </span>
          <ModelUsageChips consumers={consumers} />
        </div>
      ) : null}
    </div>
  );
}
