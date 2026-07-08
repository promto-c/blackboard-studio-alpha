export interface InlineOptionListOption<T extends string> {
  value: T;
  label: string;
}

export interface InlineOptionListProps<T extends string> {
  label: string;
  value: T;
  options: readonly InlineOptionListOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function InlineOptionList<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: InlineOptionListProps<T>) {
  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 px-3 text-[10px] font-medium uppercase text-gray-500">
        {label}
      </legend>
      <div className="space-y-0.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`flex min-h-8 w-full items-center rounded-md border px-3 py-1.5 text-left text-sm transition ${
                selected
                  ? 'border-primary-300/60 bg-primary-400/20 text-white'
                  : 'border-transparent text-gray-300 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <span className="min-w-0 break-words">{option.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
