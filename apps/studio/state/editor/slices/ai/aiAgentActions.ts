import { AiAgentRun, AiAgentRunStep, EditorTab } from '@blackboard/types';
import type { SetState, GetState } from '@/state/editor/slices/types';
import {
  appendAiAgentRunEvent,
  createAiAgentRunRecord,
  createAiAgentRunStep,
  getAiAgentRunRecommendedNextAction,
  getAiAgentRunStatusEvent,
  updateAiAgentRunById,
  type CreateAiAgentRunInput,
} from './helpers/agent';

import type { EditorState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';

export function createAiAgentActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
  },
) {
  return {
    createAiAgentRun: (input: CreateAiAgentRunInput): string => {
      const state = get();
      const run = createAiAgentRunRecord(input, state.projectId);
      deps.commitMutation(() => ({
        patch: {
          aiAgentRuns: [run, ...state.aiAgentRuns],
          activeAiAgentRunId: run.id,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
      return run.id;
    },

    updateAiAgentRun: (
      runId: string,
      patch: Partial<
        Pick<
          AiAgentRun,
          | 'branchId'
          | 'error'
          | 'planMode'
          | 'recommendedNextAction'
          | 'sourceChatId'
          | 'status'
          | 'title'
          | 'userAccess'
          | 'workingOwnerId'
          | 'workingOwnerType'
        >
      >,
    ) => {
      const timestamp = Date.now();
      deps.commitMutation((state) => ({
        patch: {
          aiAgentRuns: updateAiAgentRunById(state.aiAgentRuns, runId, (run) => {
            const status = patch.status ?? run.status;
            const branchId = patch.branchId ?? run.branchId;
            const statusEvent =
              patch.status && patch.status !== run.status
                ? getAiAgentRunStatusEvent(status, branchId)
                : null;
            return {
              ...run,
              ...patch,
              branchId: branchId ?? undefined,
              status,
              userAccess: patch.userAccess ?? run.userAccess ?? (branchId ? 'read-only' : 'review'),
              recommendedNextAction:
                patch.recommendedNextAction ??
                getAiAgentRunRecommendedNextAction(status, branchId) ??
                run.recommendedNextAction,
              steps: appendAiAgentRunEvent(run.steps, statusEvent),
              updatedAt: timestamp,
            };
          }),
          activeAiAgentRunId: runId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
    },

    appendAiAgentRunReviewAsset: (runId: string, reviewAssetId: string) => {
      const timestamp = Date.now();
      deps.commitMutation((state) => ({
        patch: {
          aiAgentRuns: updateAiAgentRunById(state.aiAgentRuns, runId, (run) => {
            const reviewStepIndex = run.steps.findIndex((step) => step.kind === 'review');
            const updateReviewStep = (step: AiAgentRunStep): AiAgentRunStep => {
              const reviewAssetIds = step.reviewAssetIds ?? [];
              return {
                ...step,
                kind: 'review',
                status: 'complete',
                reviewAssetIds: reviewAssetIds.includes(reviewAssetId)
                  ? reviewAssetIds
                  : [...reviewAssetIds, reviewAssetId],
              };
            };
            const steps =
              reviewStepIndex === -1
                ? [
                    ...run.steps,
                    createAiAgentRunStep({
                      title: 'Preview captured',
                      kind: 'review',
                      status: 'complete',
                      reviewAssetIds: [reviewAssetId],
                    }),
                  ]
                : run.steps.map((step, index) =>
                    index === reviewStepIndex ? updateReviewStep(step) : step,
                  );
            return {
              ...run,
              steps,
              recommendedNextAction: run.branchId ? 'apply' : run.recommendedNextAction,
              updatedAt: timestamp,
            };
          }),
          activeAiAgentRunId: runId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
    },

    answerAiAgentRunQuestion: (
      runId: string,
      questionId: string,
      answer: { choiceId?: string; text: string },
    ) => {
      const timestamp = Date.now();
      deps.commitMutation((state) => ({
        patch: {
          aiAgentRuns: updateAiAgentRunById(state.aiAgentRuns, runId, (run) => ({
            ...run,
            steps: run.steps.map((step) => {
              if (
                step.kind !== 'question' ||
                !step.questions?.some((entry) => entry.id === questionId)
              ) {
                return step;
              }
              const questions = step.questions.map((question) =>
                question.id === questionId
                  ? {
                      ...question,
                      answeredChoiceId: answer.choiceId,
                      answerText: answer.text,
                      answeredAt: timestamp,
                    }
                  : question,
              );
              const isComplete = questions.every(
                (question) => !question.required || Boolean(question.answerText?.trim()),
              );
              return {
                ...step,
                questions,
                status: isComplete ? 'complete' : step.status,
                needsUserInput: isComplete ? false : step.needsUserInput,
              };
            }),
            updatedAt: timestamp,
          })),
          activeAiAgentRunId: runId,
          activeTab: EditorTab.Chats,
          isSubPanelVisible: true,
        },
        persist: 'debounced',
      }));
    },
  };
}
