export type AiToolPermission = 'safe' | 'confirm' | 'blocked';

export const canExecuteAiTool = (permission: AiToolPermission) => permission === 'safe';
