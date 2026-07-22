import React from 'react';
import * as Icons from '@blackboard/icons';
import type { ModelConsumer } from '@/services/models/modelUsageRegistry';

export default function ModelUsageChips({ consumers }: { consumers: readonly ModelConsumer[] }) {
  if (consumers.length === 0) {
    return <span className="text-[10px] text-gray-600">Not currently referenced</span>;
  }

  const consumersByLabel = new Map<string, ModelConsumer>();
  consumers.forEach((consumer) => {
    const key = consumer.label.trim().toLocaleLowerCase();
    const current = consumersByLabel.get(key);
    if (!current || consumer.active) consumersByLabel.set(key, consumer);
  });
  const visibleConsumers = Array.from(consumersByLabel.values()).slice(0, 4);
  const hiddenCount = consumersByLabel.size - visibleConsumers.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleConsumers.map((consumer) => (
        <span
          key={`${consumer.kind}:${consumer.id}`}
          title={`${consumer.detail}${consumer.pluginName ? ` · ${consumer.pluginName}` : ''}`}
          className={`inline-flex min-w-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${
            consumer.active
              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
              : 'border-white/10 bg-white/[0.04] text-gray-300'
          }`}
        >
          {consumer.kind === 'plugin' || consumer.pluginId ? (
            <Icons.CodeBracket className="h-3 w-3 shrink-0" />
          ) : (
            <Icons.CubeTransparent className="h-3 w-3 shrink-0" />
          )}
          <span className="max-w-40 truncate">{consumer.label}</span>
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span className="inline-flex items-center rounded-md border border-white/10 px-2 py-1 text-[10px] text-gray-500">
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}
