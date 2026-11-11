import { describe, expect, it } from 'vitest';
import { reactionBrakeOn } from './brake.js';
import { planFirstMessage, renderRecipientBody } from './campaign-text.js';
import { hasVariation, splitFirstMessage } from './first-message.js';
import { numberHints } from './hints.js';
import { quietHoursEnd } from './quiet-hours.js';

describe('AC-7.4 the reaction brake', () => {
  it('AC-7.4 is off with nothing sent, and off while the figures are healthy', () => {
    expect(reactionBrakeOn({ sent: 0, replied: 0, likelyBlocked: 0 })).toBe(false);
    expect(reactionBrakeOn({ sent: 50, replied: 10, likelyBlocked: 1 })).toBe(false);
  });

  it('AC-7.4 is on when 10% or more of the contacts probably blocked us', () => {
    expect(reactionBrakeOn({ sent: 50, replied: 20, likelyBlocked: 5 })).toBe(true);
    expect(reactionBrakeOn({ sent: 50, replied: 20, likelyBlocked: 4 })).toBe(false);
    expect(reactionBrakeOn({ sent: 10, replied: 5, likelyBlocked: 1 })).toBe(true);
  });

  it('AC-7.4 is on when at least 30 were sent and fewer than 5% replied', () => {
    expect(reactionBrakeOn({ sent: 30, replied: 1, likelyBlocked: 0 })).toBe(true);
    expect(reactionBrakeOn({ sent: 50, replied: 2, likelyBlocked: 0 })).toBe(true);
    expect(reactionBrakeOn({ sent: 50, replied: 3, likelyBlocked: 0 })).toBe(false);
  });

  it('AC-7.4 below 30 sent, a low reply rate alone does not brake', () => {
    expect(reactionBrakeOn({ sent: 29, replied: 0, likelyBlocked: 0 })).toBe(false);
  });

  it('AC-7.4 lifts by itself when both figures fall back below the thresholds', () => {
    expect(reactionBrakeOn({ sent: 50, replied: 0, likelyBlocked: 0 })).toBe(true);
    expect(reactionBrakeOn({ sent: 50, replied: 5, likelyBlocked: 0 })).toBe(false);
  });
});

describe('AC-7.5 quiet hours', () => {
  const setting = { enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Kolkata' };

  it('AC-7.5 is quiet from 22:00 to 08:00 in the org time zone, and reports when it ends', () => {
    expect(quietHoursEnd(new Date('2026-11-02T16:30:00.000Z'), setting)).toEqual(new Date('2026-11-03T02:30:00.000Z'));   // 22:00 IST
    expect(quietHoursEnd(new Date('2026-11-03T01:00:00.000Z'), setting)).toEqual(new Date('2026-11-03T02:30:00.000Z'));   // 06:30 IST
    expect(quietHoursEnd(new Date('2026-11-03T02:30:00.000Z'), setting)).toBeNull();                                      // 08:00 IST
    expect(quietHoursEnd(new Date('2026-11-02T16:29:00.000Z'), setting)).toBeNull();                                      // 21:59 IST
  });

  it('AC-7.5 reads the time in the org zone, not the server zone', () => {
    // The same instant is the middle of the day in India and the middle of the night in New York.
    const instant = new Date('2026-11-02T06:30:00.000Z');
    expect(quietHoursEnd(instant, setting)).toBeNull();
    expect(quietHoursEnd(instant, { ...setting, timeZone: 'America/New_York' })).not.toBeNull();
  });

  it('AC-7.5 can be switched off, can sit inside one day, and a broken setting never stops sending', () => {
    const night = new Date('2026-11-02T17:30:00.000Z');
    expect(quietHoursEnd(night, { ...setting, enabled: false })).toBeNull();
    expect(quietHoursEnd(new Date('2026-11-02T08:00:00.000Z'), { ...setting, start: '13:00', end: '15:00' })).toEqual(new Date('2026-11-02T09:30:00.000Z'));
    expect(quietHoursEnd(night, { ...setting, start: 'late', end: 'early' })).toBeNull();
    expect(quietHoursEnd(night, { ...setting, timeZone: 'Not/AZone' })).toBeNull();
  });
});

describe('AC-7.6 hints', () => {
  const now = new Date('2026-11-10T00:00:00.000Z');

  it('AC-7.6 says go gently for a number linked less than 7 days ago', () => {
    const hints = numberHints({ linkedSince: new Date('2026-11-05T00:00:00.000Z'), timelockType: null, now });
    expect(hints.map((h) => h.code)).toEqual(['new_number']);
    expect(numberHints({ linkedSince: new Date('2026-11-03T00:00:00.000Z'), timelockType: null, now })).toEqual([]);
    expect(numberHints({ linkedSince: null, timelockType: null, now })).toEqual([]);
  });

  it('AC-7.6 says to use WhatsApp on the phone itself too when the timelock type is WEB_COMPANION_ONLY', () => {
    const hints = numberHints({ linkedSince: null, timelockType: 'WEB_COMPANION_ONLY', now });
    expect(hints.map((h) => h.code)).toEqual(['use_phone_too']);
    expect(numberHints({ linkedSince: null, timelockType: 'DEFAULT', now })).toEqual([]);
  });
});

describe('AC-7.2 variants and the no-variation warning', () => {
  it('AC-7.2 a text with a {a|b} choice has variation, one without does not', () => {
    expect(hasVariation('{Hi|Hello|Hey} {{first_name}}, a quick question')).toBe(true);
    expect(hasVariation('Hi {{first_name}}, a quick question')).toBe(false);
    expect(hasVariation('a | b but no braces')).toBe(false);
  });

  const person = { campaignId: 'camp-1', contactId: 'contact-1', displayName: 'Asha Verma', customFields: { city: 'Pune' } };

  it('AC-7.2 fills {{first_name}}, {{name}} and custom fields', () => {
    expect(renderRecipientBody('Hi {{first_name}} ({{name}}) from {{city}}', person)).toBe('Hi Asha (Asha Verma) from Pune');
    expect(renderRecipientBody('Hi {{first_name}}', { ...person, displayName: null })).toBe('Hi there');
    expect(renderRecipientBody('Hi {{name}}', { ...person, displayName: '  ' })).toBe('Hi there');
  });

  it('AC-7.2 one recipient always gets the same pick, from a draw seeded by campaign and contact', () => {
    const template = '{Hi|Hello|Hey|Namaste|Good day} there';
    const first = renderRecipientBody(template, person);
    for (let i = 0; i < 20; i++) expect(renderRecipientBody(template, person)).toBe(first);
  });

  it('AC-7.2 different recipients get different picks across a campaign', () => {
    const template = '{Hi|Hello|Hey|Namaste|Good day} there';
    const picks = new Set(Array.from({ length: 60 }, (_, i) => renderRecipientBody(template, { ...person, contactId: `contact-${String(i)}` })));
    expect(picks.size).toBeGreaterThanOrEqual(4);
  });
});

describe('AC-7.3 media after reply', () => {
  it('AC-7.3 a link is held back for the follow-up and the text goes alone', () => {
    const split = splitFirstMessage('Hi Asha, see our brochure https://example.com/b.pdf and tell me what you think', false);
    expect(split).not.toBeNull();
    expect(split!.text).toBe('Hi Asha, see our brochure and tell me what you think');
    expect(split!.followUp).toEqual({ text: 'https://example.com/b.pdf', withMedia: false });
  });

  it('AC-7.3 a photo is held back for the follow-up', () => {
    const split = splitFirstMessage('Hi Asha, our new range', true);
    expect(split).toEqual({ text: 'Hi Asha, our new range', withMedia: false, followUp: { text: '', withMedia: true } });
  });

  it('AC-7.3 nothing is split when there is no link and no photo, or when only a link would be left', () => {
    expect(splitFirstMessage('Hi Asha', false)).toBeNull();
    expect(splitFirstMessage('https://example.com', false)).toBeNull();
  });

  it('AC-7.3 only a new chat on a campaign with the setting on gets the text alone; known contacts get it all at once', () => {
    const rendered = 'Hi Asha https://example.com/x';
    const base = { rendered, hasMedia: true };
    expect(planFirstMessage({ ...base, newChat: true, mediaAfterReply: true })).toMatchObject({ text: 'Hi Asha', withMedia: false });
    expect(planFirstMessage({ ...base, newChat: false, mediaAfterReply: true })).toEqual({ text: rendered, withMedia: true, split: null });
    expect(planFirstMessage({ ...base, newChat: true, mediaAfterReply: false })).toEqual({ text: rendered, withMedia: true, split: null });
  });
});
