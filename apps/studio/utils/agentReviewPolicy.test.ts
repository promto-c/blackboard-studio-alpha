import { describe, expect, it } from 'vitest';
import { assessAgentSelfReviewContent } from './agentReviewPolicy';

describe('agentReviewPolicy', () => {
  it('detects explicit pass and needs-work review markers', () => {
    expect(assessAgentSelfReviewContent('Looks ready. [agent-review:pass]')).toBe('pass');
    expect(assessAgentSelfReviewContent('Mask edge still slips. [agent-review:needs-work]')).toBe(
      'needs-work',
    );
  });

  it('keeps unmarked reviews unknown', () => {
    expect(assessAgentSelfReviewContent('Looks mostly good but maybe inspect it.')).toBe('unknown');
  });
});
