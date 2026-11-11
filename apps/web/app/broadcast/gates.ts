/**
 * Plain-language labels for the recipient-experience gates an admin may lift, and what lifting each one does.
 * There is no cooldown entry: messaged-in-the-last-14-days is a warning line now and never stops anyone (CW-6.6a).
 */
export const GATE_LABEL: Record<string, string> = {
  dnc: 'Do-not-contact — they asked not to be messaged (use with great care)',
  engagement: 'Engagement lock — an agent is mid-conversation with them',
  duplicate_campaign: 'Still in another live campaign from this number'
};

/** One line under each override: what happens if it is ticked. */
export const GATE_EFFECT: Record<string, string> = {
  dnc: 'People marked do-not-contact will be messaged anyway.',
  engagement: 'People an agent is chatting with right now will get this message too.',
  duplicate_campaign: 'People still waiting in another running campaign from this number will get this one as well.'
};

/** The reason saved in the audit log when "Send anyway" lifts the live-campaign check from the red confirm. */
export const SEND_ANYWAY_REASON = 'Chose "Send anyway" in the confirm for people still in a live campaign from this number';

/** The sentence in the red confirm for people still in a live campaign on the same number (CW-6.6a AC1). */
export function liveCampaignSentence(count: number, campaign: string | null, phone: string | null): string {
  return `${String(count)} of these people are still in '${campaign ?? 'another campaign'}' from ${phone ?? 'this number'}. `
    + 'Sending again from the same number will cut into that conversation, and their replies may be counted for the wrong campaign.';
}

/** The plain warning line for people this number messaged lately, nothing live (CW-6.6a AC3). */
export function recentWarning(count: number): string {
  return `${String(count)} of these got a campaign from you in the last 14 days, from this number.`;
}

/** The small note when people are also in a campaign from a different number (CW-6.6a AC4). */
export const OTHER_NUMBER_NOTE = "They'll see two chats from your business.";

/** The sentence under an unknown `{{key}}` (CW-7.7 AC3). */
export function unknownFillInSentence(key: string, suggestion: string | null): string {
  return `No column called ${key}.${suggestion !== null ? ` Did you mean ${suggestion}?` : ''}`;
}
