import {
  EditorStateSlice,
  Flow,
  ProjectIndexEntry,
  removeCycleCreatingFlowConnections,
  validateRootFlow,
} from '@blackboard/types';
import {
  saveProjectStateToDB,
  loadProjectStateFromDB,
  deleteProjectStateFromDB,
} from './assetStorage';

const PROJECT_INDEX_KEY = 'blackboard-studio-project-index-v1';

export const SCHEMA_VERSION = 1;

// --- Project Index ---

export const getProjectIndex = (): ProjectIndexEntry[] => {
  try {
    const serializedIndex = localStorage.getItem(PROJECT_INDEX_KEY);
    if (!serializedIndex) return [];
    const index = JSON.parse(serializedIndex);
    return Array.isArray(index) ? index : [];
  } catch (error) {
    console.error('Could not load project index from localStorage', error);
    return [];
  }
};

export const saveProjectIndex = (index: ProjectIndexEntry[]): void => {
  try {
    const serializedIndex = JSON.stringify(index);
    localStorage.setItem(PROJECT_INDEX_KEY, serializedIndex);
  } catch (error) {
    console.error('Could not save project index to localStorage', error);
  }
};

// --- Individual Project State ---

type StoredProjectState = Omit<EditorStateSlice, 'projectId'>;

const repairFlowCycles = (
  flows: Record<string, Flow> | undefined,
): { flows: Record<string, Flow> | undefined; repairedCount: number } => {
  if (!flows) {
    return { flows, repairedCount: 0 };
  }

  let repairedFlows = flows;
  let repairedCount = 0;

  for (const [flowId, flow] of Object.entries(flows)) {
    const repairedFlow = removeCycleCreatingFlowConnections(flow);
    const removedCount = flow.relationships.length - repairedFlow.relationships.length;
    if (removedCount === 0) {
      continue;
    }

    if (repairedFlows === flows) {
      repairedFlows = { ...flows };
    }
    repairedFlows[flowId] = repairedFlow;
    repairedCount += removedCount;
  }

  return { flows: repairedFlows, repairedCount };
};

const repairProjectStateFlowCycles = (
  state: StoredProjectState,
): { state: StoredProjectState; repairedCount: number } => {
  let nextState = state;
  let totalRepaired = 0;

  const mainRepair = repairFlowCycles(state.flows);
  if (mainRepair.repairedCount > 0) {
    nextState = { ...nextState, flows: mainRepair.flows };
    totalRepaired += mainRepair.repairedCount;
  }

  if (Array.isArray(state.history)) {
    let nextHistory = state.history;

    state.history.forEach((entry, index) => {
      const entryRepair = repairFlowCycles(entry.state.flows);
      if (entryRepair.repairedCount === 0) {
        return;
      }

      if (nextHistory === state.history) {
        nextHistory = [...state.history];
      }
      nextHistory[index] = {
        ...entry,
        state: {
          ...entry.state,
          flows: entryRepair.flows,
        },
      };
      totalRepaired += entryRepair.repairedCount;
    });

    if (nextHistory !== state.history) {
      nextState = { ...nextState, history: nextHistory };
    }
  }

  return { state: nextState, repairedCount: totalRepaired };
};

export const saveProject = async (id: string, state: StoredProjectState): Promise<void> => {
  try {
    const repair = repairProjectStateFlowCycles(state);
    // Save to IndexedDB to avoid quota limits with large projects/history
    await saveProjectStateToDB(id, repair.state);
  } catch (error) {
    console.error(`Could not save project ${id} to IndexedDB`, error);
  }
};

export const loadProjectState = async (id: string): Promise<StoredProjectState | null> => {
  try {
    let stored = await loadProjectStateFromDB(id);
    if (stored) {
      const repair = repairProjectStateFlowCycles(stored as StoredProjectState);
      if (repair.repairedCount > 0) {
        stored = repair.state;
        await saveProjectStateToDB(id, repair.state);
        console.warn(
          `Repaired ${repair.repairedCount} cycle-creating flow connection(s) in project ${id}.`,
        );
      }

      // Validate history to prevent crashes from corrupt/old data
      if (
        stored.history &&
        Array.isArray(stored.history) &&
        typeof stored.historyIndex === 'number'
      ) {
        // Ensure index is within bounds
        stored.historyIndex = Math.max(0, Math.min(stored.history.length - 1, stored.historyIndex));
      } else {
        // If history is invalid, remove it so the store can create a fresh one.
        delete stored.history;
        delete stored.historyIndex;
      }

      if (stored.rootFlowId && stored.flows && stored.flows[stored.rootFlowId]) {
        const issues = validateRootFlow(stored.flows[stored.rootFlowId]);
        if (issues.length > 0) {
          console.error(`Project ${id} failed flow validation`, issues);
          return null;
        }
      }

      return stored as StoredProjectState;
    }
    return null;
  } catch (error) {
    console.error(`Could not load project ${id}`, error);
    return null;
  }
};

export const deleteProject = async (id: string): Promise<void> => {
  try {
    // Remove from DB
    await deleteProjectStateFromDB(id);

    // Update the index
    const index = getProjectIndex();
    const newIndex = index.filter((p) => p.id !== id);
    saveProjectIndex(newIndex);
  } catch (error) {
    console.error(`Could not delete project ${id}`, error);
  }
};
