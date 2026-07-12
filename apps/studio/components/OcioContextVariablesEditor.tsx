import { TextInput } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';

export interface OcioContextVariablesEditorProps {
  value: Readonly<Record<string, string>> | undefined;
  onChange: (value: Record<string, string> | undefined) => void;
  emptyLabel?: string;
}

const nextContextKey = (context: Readonly<Record<string, string>>): string => {
  let index = 1;
  while (`CONTEXT_${index}` in context) index += 1;
  return `CONTEXT_${index}`;
};

export function OcioContextVariablesEditor({
  value,
  onChange,
  emptyLabel = 'No OCIO context variables.',
}: OcioContextVariablesEditorProps) {
  const context = value ?? {};
  const setContext = (nextContext: Record<string, string>) =>
    onChange(Object.keys(nextContext).length ? nextContext : undefined);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          OCIO Context
        </div>
        <button
          type="button"
          onClick={() => {
            const nextContext = { ...context };
            nextContext[nextContextKey(nextContext)] = '';
            setContext(nextContext);
          }}
          title="Add OCIO context variable"
          aria-label="Add OCIO context variable"
          className="grid h-8 w-8 place-items-center rounded text-gray-400 transition hover:bg-white/10 hover:text-white"
        >
          <Icons.Plus className="h-4 w-4" />
        </button>
      </div>

      {Object.entries(context).length ? (
        Object.entries(context).map(([key, contextValue]) => (
          <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2">
            <TextInput
              value={key}
              aria-label="OCIO context variable name"
              onValueChange={(value) => {
                const nextKey = value.trim();
                if (!nextKey || nextKey === key || nextKey in context) return;
                const nextContext = { ...context };
                delete nextContext[key];
                nextContext[nextKey] = contextValue;
                setContext(nextContext);
              }}
              className="font-mono"
            />
            <TextInput
              value={contextValue}
              aria-label={`${key} value`}
              onValueChange={(value) =>
                setContext({
                  ...context,
                  [key]: value,
                })
              }
              className="font-mono"
            />
            <button
              type="button"
              onClick={() => {
                const nextContext = { ...context };
                delete nextContext[key];
                setContext(nextContext);
              }}
              title={`Remove ${key}`}
              aria-label={`Remove ${key}`}
              className="grid h-8 w-8 place-items-center rounded text-gray-500 transition hover:bg-red-500/10 hover:text-red-200"
            >
              <Icons.Trash className="h-4 w-4" />
            </button>
          </div>
        ))
      ) : (
        <div className="text-xs text-gray-500">{emptyLabel}</div>
      )}
    </section>
  );
}
