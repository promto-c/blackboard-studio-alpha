import type { InstalledOnnxModel } from '@blackboard/types';

export interface InstalledOnnxModelGroup {
  id: string;
  name: string;
  repoName: string;
  targetLabel?: string;
  models: InstalledOnnxModel[];
  latestInstalledAt: number;
}

export const getInstalledOnnxModelGroupId = (model: InstalledOnnxModel): string =>
  model.catalogRef
    ? `catalog:${model.catalogRef.origin}:${model.catalogRef.modelId}:${model.catalogRef.targetId ?? 'default'}`
    : `repo:${model.repoName}`;

export const groupInstalledOnnxModels = (
  models: readonly InstalledOnnxModel[],
): InstalledOnnxModelGroup[] => {
  const groups = new Map<string, InstalledOnnxModelGroup>();

  models.forEach((model) => {
    const id = getInstalledOnnxModelGroupId(model);
    const existing = groups.get(id);
    if (existing) {
      existing.models.push(model);
      existing.latestInstalledAt = Math.max(existing.latestInstalledAt, model.installedAt);
      return;
    }
    groups.set(id, {
      id,
      name: model.catalogRef?.modelName ?? model.name,
      repoName: model.repoName,
      targetLabel: model.catalogRef?.targetLabel,
      models: [model],
      latestInstalledAt: model.installedAt,
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      models: group.models.sort((left, right) =>
        left.variant.label.localeCompare(right.variant.label, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      ),
    }))
    .sort((left, right) => right.latestInstalledAt - left.latestInstalledAt);
};
