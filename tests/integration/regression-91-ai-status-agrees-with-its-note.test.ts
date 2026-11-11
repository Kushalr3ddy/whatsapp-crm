import { describe, expect, it } from 'vitest';
import { parseAiTurn } from '@crm/core';
import { reconcileStatus } from '../../packages/core/src/ai-turn.js';

/**
 * [#91] (2026-11-09, found by: live run, AI-INT-1). A clear "yes I will be there" was filed as "talking", while the AI's own note for the team said
 * "confirmed his attendance". The model judged the status separately and conservatively, so the campaign page counted a person who had agreed under
 * "Talking". The status and the note come from the same answer and now have to agree: a note that says the person agreed makes "talking" into
 * "interested", and a note that says they declined does not stay "talking". Any other status the model chose is left alone.
 */
const turn = (status: string, summary: string): string => JSON.stringify({ reply: 'Great!', status, summary, handover: false });

describe('[R-059] [#91] the status follows the note', () => {
  it('[#91] "confirmed his attendance" filed as talking becomes interested', () => {
    expect(parseAiTurn(turn('talking', 'Candidate confirmed his attendance for the 15 Nov interview.')).status).toBe('interested');
  });
  it('[#91] the other ways a note says someone agreed', () => {
    for (const note of ['Agreed to come on Saturday.', 'She will attend the walk-in.', 'He is coming at 4 PM.', 'Wants to go ahead with the interview.', 'Said yes to the slot.', 'Is interested in the role.']) {
      expect(reconcileStatus('talking', note), note).toBe('interested');
    }
  });
  it('[#91] no status at all, with a note that says they agreed, is interested too', () => {
    expect(reconcileStatus(null, 'Confirmed their attendance.')).toBe('interested');
  });
  it('[#91] a note that says they declined does not stay "talking"', () => {
    expect(reconcileStatus('talking', 'Said they are not interested right now.')).toBe('not_interested');
  });
  it('[#91] a status the model chose other than talking is never overridden', () => {
    expect(reconcileStatus('needs_person', 'Confirmed his attendance but asked for a call.')).toBe('needs_person');
    expect(reconcileStatus('not_interested', 'Is interested but too far away.')).toBe('not_interested');
    expect(reconcileStatus('interested', 'Asked about the pay.')).toBe('interested');
  });
  it('[#91] a note that says neither leaves "talking" as it is, and a missing note changes nothing', () => {
    expect(reconcileStatus('talking', 'Asked what the pay is and where the office is.')).toBe('talking');
    expect(reconcileStatus('talking', null)).toBe('talking');
    expect(reconcileStatus(null, null)).toBeNull();
  });
});
