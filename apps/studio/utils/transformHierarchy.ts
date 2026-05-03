/**
 * Enforce transform component hierarchy based on reference-point requirements.
 *
 * perspective -> affine -> { rotation, scale } -> translation
 *
 * Rotation and scale are independent, but both require translation.
 * Affine requires both rotation and scale.
 *
 * When toggling on, enable the selected field and its prerequisites.
 * When toggling off, disable the selected field and any dependents above it.
 * When a lower field is only active because a higher-level model requires it,
 * clicking that lower field removes the higher-level dependents instead of turning it off.
 */

export type TransformToggles = {
  translation: boolean;
  rotation: boolean;
  scale: boolean;
  affine: boolean;
  perspective: boolean;
};

type TransformField = keyof TransformToggles;

const REQUIRED_FIELDS: Record<TransformField, TransformField[]> = {
  translation: [],
  rotation: ['translation'],
  scale: ['translation'],
  affine: ['translation', 'rotation', 'scale'],
  perspective: ['translation', 'rotation', 'scale', 'affine'],
};

function getActiveDependents(current: TransformToggles, field: TransformField): TransformField[] {
  return (Object.keys(REQUIRED_FIELDS) as TransformField[]).filter(
    (candidate) =>
      candidate !== field && current[candidate] && REQUIRED_FIELDS[candidate].includes(field),
  );
}

function getDowngradeChanges(field: TransformField, activeDependents: TransformField[]) {
  const changes = activeDependents.reduce<Partial<TransformToggles>>((next, dependent) => {
    next[dependent] = false;
    return next;
  }, {});

  // Downgrading to scale should fall back to scale-only instead of preserving rotation.
  if (field === 'scale') {
    changes.rotation = false;
  }

  return changes;
}

export function toggleTransformWithHierarchy(
  current: TransformToggles,
  field: TransformField,
): Partial<TransformToggles> {
  const activeDependents = getActiveDependents(current, field);

  if (current[field] && activeDependents.length > 0) {
    return getDowngradeChanges(field, activeDependents);
  }

  const enabling = !current[field];

  if (enabling) {
    switch (field) {
      case 'perspective':
        return { perspective: true, affine: true, rotation: true, scale: true, translation: true };
      case 'affine':
        return { affine: true, rotation: true, scale: true, translation: true };
      case 'rotation':
        return { rotation: true, translation: true };
      case 'scale':
        return { scale: true, translation: true };
      case 'translation':
        return { translation: true };
    }
  }

  switch (field) {
    case 'translation':
      return {
        translation: false,
        scale: false,
        rotation: false,
        affine: false,
        perspective: false,
      };
    case 'scale':
      return { scale: false, affine: false, perspective: false };
    case 'rotation':
      return { rotation: false, affine: false, perspective: false };
    case 'affine':
      return { affine: false, perspective: false };
    case 'perspective':
      return { perspective: false };
  }
}
