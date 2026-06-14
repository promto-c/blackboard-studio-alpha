type AgentReviewOutcome = 'pass' | 'needs-work' | 'unknown';

export interface AgentSelfReviewPolicy {
  maxPasses: number;
  maxToolStepsPerPass: number;
  passMarker: string;
  needsWorkMarker: string;
}

export const DEFAULT_AGENT_SELF_REVIEW_POLICY: AgentSelfReviewPolicy = {
  maxPasses: 2,
  maxToolStepsPerPass: 4,
  passMarker: '[agent-review:pass]',
  needsWorkMarker: '[agent-review:needs-work]',
};

export const assessAgentSelfReviewContent = (
  content: string | null | undefined,
  policy: AgentSelfReviewPolicy = DEFAULT_AGENT_SELF_REVIEW_POLICY,
): AgentReviewOutcome => {
  const normalized = content?.toLocaleLowerCase() ?? '';
  if (normalized.includes(policy.passMarker.toLocaleLowerCase())) {
    return 'pass';
  }
  if (normalized.includes(policy.needsWorkMarker.toLocaleLowerCase())) {
    return 'needs-work';
  }
  return 'unknown';
};

export const buildAgentSelfReviewMarkerInstruction = (
  policy: AgentSelfReviewPolicy = DEFAULT_AGENT_SELF_REVIEW_POLICY,
) =>
  `End the review with exactly one status marker: ${policy.passMarker} when the after image is ready for user review, or ${policy.needsWorkMarker} when more work remains.`;
