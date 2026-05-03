const TRAILING_NUMBER_PATTERN = /^(.*?)(?:\s+(\d+))$/;

const normalizeItemName = (name: string): string => name.toLowerCase();

const getItemNameBase = (name: string): string => {
  const trimmedName = name.trimEnd();
  const match = trimmedName.match(TRAILING_NUMBER_PATTERN);
  const candidateBase = match?.[1].trimEnd();
  return candidateBase && candidateBase.length > 0 ? candidateBase : trimmedName;
};

export const createUniqueItemNameAssigner = (existingNames: Iterable<string>) => {
  const usedNames = new Set(Array.from(existingNames, normalizeItemName));

  return (name: string): string => {
    const normalizedName = normalizeItemName(name);
    if (!usedNames.has(normalizedName)) {
      usedNames.add(normalizedName);
      return name;
    }

    const baseName = getItemNameBase(name);
    let index = 1;
    let nextName = `${baseName} ${index}`;

    while (usedNames.has(normalizeItemName(nextName))) {
      index += 1;
      nextName = `${baseName} ${index}`;
    }

    usedNames.add(normalizeItemName(nextName));
    return nextName;
  };
};
