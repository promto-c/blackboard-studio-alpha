import * as Icons from '@blackboard/icons';

export function ComfyOutputPlaceholder({
  label,
  detail,
  active = false,
  onClick,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const isClickable = onClick !== undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-dashed px-1.5 text-center transition ${
        active
          ? 'border-primary-300/45 bg-primary-300/[0.08] text-primary-100'
          : isClickable
            ? 'border-white/10 bg-gray-900/60 text-gray-500 hover:border-red-300/50 hover:bg-red-500/10 hover:text-red-100 cursor-pointer'
            : 'border-white/10 bg-gray-900/60 text-gray-500'
      } ${active && isClickable ? 'hover:border-red-300/40 hover:bg-red-500/[0.07] cursor-pointer' : ''}`}
      title={isClickable ? `Cancel: ${detail ?? label}` : (detail ?? label)}
      aria-label={isClickable ? `Cancel ${label}` : undefined}
    >
      <Icons.CubeTransparent className={`h-4 w-4 ${active ? 'animate-pulse' : ''}`} />
      <span className="mt-0.5 max-w-full truncate text-[10px] font-medium">{label}</span>
    </button>
  );
}
