import { useMemo, useState, type ReactNode } from 'react';
import * as Icons from '@blackboard/icons';
import { Popover, ScrollArea, TextInput } from '@blackboard/ui';
import { CheckboxIndicator } from './CheckboxIndicator';

export interface ExplicitFieldPickerField {
  id: string;
  label: string;
  selectedLabel?: string;
  group?: string;
  detail?: ReactNode;
  searchText?: string;
}

export interface ExplicitFieldPickerProps {
  fields: ExplicitFieldPickerField[];
  selectedFieldIds: ReadonlySet<string>;
  onToggleField: (fieldId: string) => void;
  triggerLabel?: string;
  searchPlaceholder?: string;
  totalLabel?: string;
  emptyMessage?: string;
  className?: string;
}

const matchesQuery = (field: ExplicitFieldPickerField, query: string): boolean =>
  [field.label, field.selectedLabel, field.group, field.searchText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);

const groupFields = (fields: ExplicitFieldPickerField[]) => {
  const groups = new Map<string, ExplicitFieldPickerField[]>();
  fields.forEach((field) => {
    const group = field.group?.trim() || 'Available fields';
    const existing = groups.get(group);
    if (existing) existing.push(field);
    else groups.set(group, [field]);
  });
  return Array.from(groups.entries());
};

export function ExplicitFieldPicker({
  fields,
  selectedFieldIds,
  onToggleField,
  triggerLabel = 'Fields',
  searchPlaceholder = 'Search fields...',
  totalLabel = `${fields.length} available`,
  emptyMessage = 'No fields are available.',
  className = '',
}: ExplicitFieldPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFields = useMemo(
    () =>
      normalizedQuery ? fields.filter((field) => matchesQuery(field, normalizedQuery)) : fields,
    [fields, normalizedQuery],
  );
  const availableFields = visibleFields.filter((field) => !selectedFieldIds.has(field.id));
  const shownFields = visibleFields.filter((field) => selectedFieldIds.has(field.id));
  const availableGroups = groupFields(availableFields);
  const selectedCount = fields.filter((field) => selectedFieldIds.has(field.id)).length;

  const handleOpenChange = (open: boolean) => {
    if (!open) setQuery('');
    setIsOpen(open);
  };

  const renderFieldDetail = (field: ExplicitFieldPickerField) =>
    field.detail !== undefined ? (
      <span className="max-w-24 shrink-0 truncate font-mono text-[10px] text-gray-600">
        {field.detail}
      </span>
    ) : null;

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      align="end"
      sideOffset={4}
      widthClass="w-80"
      trigger={
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/30 ${className}`}
          aria-label={`${triggerLabel}, ${selectedCount} of ${fields.length} shown`}
        >
          <Icons.Plus className="h-3.5 w-3.5" />
          {triggerLabel}
        </button>
      }
    >
      {(closePopover) => (
        <div
          className="space-y-2"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            closePopover();
          }}
        >
          <div className="relative px-1">
            <Icons.MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <TextInput
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder.replace(/\.+$/, '')}
              autoFocus
              className="pl-7 pr-3"
              onPointerDown={(event) => event.stopPropagation()}
            />
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs font-medium text-gray-100">{selectedCount} shown</span>
            <span className="text-[10px] text-gray-500">{totalLabel}</span>
          </div>

          {fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-primary-300/15 bg-gray-950/60 p-3 text-xs leading-5 text-primary-100/60">
              {emptyMessage}
            </div>
          ) : availableFields.length === 0 && shownFields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center text-[11px] text-gray-500">
              No fields match &quot;{query.trim()}&quot;
            </div>
          ) : (
            <ScrollArea axis="y" viewportClassName="max-h-64" contentClassName="space-y-2 pr-1">
              {availableGroups.map(([group, groupItems]) => (
                <div key={group}>
                  <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    {group}
                  </div>
                  {groupItems.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      aria-pressed="false"
                      aria-label={`Show ${field.label}${field.group ? ` from ${field.group}` : ''}`}
                      title={field.group ? `${field.group} / ${field.label}` : field.label}
                      onClick={() => onToggleField(field.id)}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-gray-400 transition hover:bg-primary-300/10 hover:text-gray-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-300/30"
                    >
                      <CheckboxIndicator
                        checked={false}
                        uncheckedIcon={<Icons.Plus className="h-2.5 w-2.5" />}
                      />
                      <span className="min-w-0 flex-1 truncate">{field.label}</span>
                      {renderFieldDetail(field)}
                    </button>
                  ))}
                </div>
              ))}

              {shownFields.length > 0 ? (
                <div className={availableFields.length > 0 ? 'border-t border-white/10 pt-2' : ''}>
                  <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Shown fields
                  </div>
                  {shownFields.map((field) => {
                    const label = field.selectedLabel ?? field.label;
                    return (
                      <button
                        key={field.id}
                        type="button"
                        aria-pressed="true"
                        aria-label={`Hide ${label}${field.group ? ` from ${field.group}` : ''}`}
                        title={field.group ? `${field.group} / ${label}` : label}
                        onClick={() => onToggleField(field.id)}
                        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-gray-100 transition hover:bg-red-500/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-300/30"
                      >
                        <CheckboxIndicator checked />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {renderFieldDetail(field)}
                        <Icons.EyeSlash className="h-3 w-3 shrink-0 text-gray-500" />
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </ScrollArea>
          )}
        </div>
      )}
    </Popover>
  );
}
