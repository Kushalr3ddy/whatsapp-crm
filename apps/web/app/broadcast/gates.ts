/** Plain-language labels for the recipient-experience gates an admin may lift, and what lifting each one does. */
export const GATE_LABEL: Record<string, string> = {
  dnc: 'Do-not-contact — they asked not to be messaged (use with great care)',
  engagement: 'Engagement lock — an agent is mid-conversation with them',
  cooldown: 'Cooldown — sent a campaign in the last 14 days',
  duplicate_campaign: 'Duplicate campaign — waiting in another live campaign'
};

/** One line under each override: what happens if it is ticked. */
export const GATE_EFFECT: Record<string, string> = {
  dnc: 'People marked do-not-contact will be messaged anyway.',
  engagement: 'People an agent is chatting with right now will get this message too.',
  cooldown: 'People already messaged by another campaign in the last 14 days will be messaged again.',
  duplicate_campaign: 'People still waiting in another running campaign will get this one as well.'
};
