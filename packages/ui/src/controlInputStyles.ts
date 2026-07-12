const CONTROL_INPUT_BASE_CLASS =
  'bb-control-input rounded-lg border border-white/10 bg-white/[0.06] text-gray-200 outline-none hover:border-white/15 hover:bg-white/[0.08]';

export const CONTROL_INPUT_SURFACE_CLASS = `${CONTROL_INPUT_BASE_CLASS} focus-visible:border-primary-400/40 focus-visible:ring-2 focus-visible:ring-primary-400/20 disabled:opacity-55`;

export const CONTROL_INPUT_CONTAINER_CLASS = `${CONTROL_INPUT_BASE_CLASS} focus-within:border-primary-400/40 focus-within:ring-2 focus-within:ring-primary-400/20`;

export const DEFAULT_CONTROL_INPUT_CLASS = `${CONTROL_INPUT_SURFACE_CLASS} block min-h-9 w-full min-w-0 px-2.5 py-2 text-xs`;
