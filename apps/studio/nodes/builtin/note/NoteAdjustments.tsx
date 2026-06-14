import { type AnyNode, type NoteColor, type NoteNode } from '@blackboard/types';
import { useEditorActions } from '@/state/editorContext';
import { MarkdownNote } from '@/components';
import * as Icons from '@blackboard/icons';

const NOTE_COLOR_ORDER: NoteColor[] = ['theme', 'teal', 'slate', 'amber', 'rose', 'violet'];

const NOTE_COLORS: Record<
  NoteColor,
  {
    label: string;
    swatchClassName: string;
    previewClassName: string;
  }
> = {
  theme: {
    label: 'As Theme',
    swatchClassName: 'bg-primary-300',
    previewClassName: 'border-primary-300/35 bg-primary-950/25 text-primary-100',
  },
  teal: {
    label: 'Teal',
    swatchClassName: 'bg-teal-300',
    previewClassName: 'border-teal-300/35 bg-teal-950/25 text-teal-100',
  },
  slate: {
    label: 'Slate',
    swatchClassName: 'bg-slate-300',
    previewClassName: 'border-slate-300/30 bg-slate-950/35 text-slate-100',
  },
  amber: {
    label: 'Amber',
    swatchClassName: 'bg-amber-300',
    previewClassName: 'border-amber-300/35 bg-amber-950/25 text-amber-100',
  },
  rose: {
    label: 'Rose',
    swatchClassName: 'bg-rose-300',
    previewClassName: 'border-rose-300/35 bg-rose-950/25 text-rose-100',
  },
  violet: {
    label: 'Violet',
    swatchClassName: 'bg-violet-300',
    previewClassName: 'border-violet-300/35 bg-violet-950/25 text-violet-100',
  },
};

function NoteAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as NoteNode;
  const { updateNode } = useEditorActions();
  const selectedColor = node.color;
  const previewColor = NOTE_COLORS[selectedColor];

  return (
    <div className="space-y-3 text-xs text-gray-300">
      <div className="rounded-md border border-white/10 bg-gray-950/40 p-3">
        <label
          htmlFor={`note-content-${node.id}`}
          className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase text-gray-500"
        >
          <Icons.DocumentPlus className="h-3.5 w-3.5" />
          Markdown
        </label>
        <textarea
          id={`note-content-${node.id}`}
          value={node.content}
          onChange={(event) => updateNode(node.id, { content: event.currentTarget.value })}
          placeholder="Write a note for this part of the graph..."
          className="min-h-[120px] w-full resize-y rounded border border-white/10 bg-gray-950 px-3 py-2 text-xs text-gray-100 outline-none placeholder:text-gray-600 focus:border-primary-400"
          rows={6}
        />
      </div>

      <div className="rounded-md border border-white/10 bg-gray-950/40 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase text-gray-500">Color</div>
        <div className="grid grid-cols-3 gap-1.5">
          {NOTE_COLOR_ORDER.map((colorValue) => {
            const color = NOTE_COLORS[colorValue];
            const isSelected = colorValue === selectedColor;
            return (
              <button
                key={colorValue}
                type="button"
                onClick={() => updateNode(node.id, { color: colorValue }, true)}
                className={`flex min-w-0 items-center gap-2 rounded border px-2 py-1.5 text-left text-[11px] transition-colors ${
                  isSelected
                    ? 'border-primary-300/60 bg-primary-500/10 text-primary-100'
                    : 'border-white/10 bg-gray-950 text-gray-400 hover:border-white/20 hover:text-gray-200'
                }`}
                aria-pressed={isSelected}
              >
                <span className={`h-3 w-3 shrink-0 rounded-sm ${color.swatchClassName}`} />
                <span className="min-w-0 flex-1 truncate">{color.label}</span>
                {isSelected ? <Icons.Check className="h-3 w-3 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`rounded-md border p-3 text-xs ${previewColor.previewClassName}`}>
        <MarkdownNote content={node.content || '_Empty note_'} />
      </div>
    </div>
  );
}

export default NoteAdjustments;
