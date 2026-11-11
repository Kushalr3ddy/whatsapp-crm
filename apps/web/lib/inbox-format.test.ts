import { describe, expect, it } from 'vitest';
import { campaignStarts, dividerWhen, highlightPieces, initials, kindLabel, listWhen, snippetAround } from './inbox-format';
import { fillInText, previewHtml, type Column } from './new-campaign';

describe('highlightPieces', () => {
  it('marks the first match, whatever its case', () => {
    expect(highlightPieces('Priya Sharma', 'SHAR')).toEqual([
      { text: 'Priya ', hit: false }, { text: 'Shar', hit: true }, { text: 'ma', hit: false }
    ]);
  });
  it('is one plain piece with no word or no match', () => {
    expect(highlightPieces('Priya', '')).toEqual([{ text: 'Priya', hit: false }]);
    expect(highlightPieces('Priya', 'zzz')).toEqual([{ text: 'Priya', hit: false }]);
  });
  it('has no empty pieces when the match is the whole text', () => {
    expect(highlightPieces('abc', 'abc')).toEqual([{ text: 'abc', hit: true }]);
  });
});

describe('snippetAround', () => {
  it('keeps a short message whole', () => {
    expect(snippetAround('Is Saturday   possible?', 'saturday')).toBe('Is Saturday possible?');
  });
  it('cuts a long message around the match with ellipses', () => {
    const text = `${'a '.repeat(60)}needle${' b'.repeat(60)}`;
    const s = snippetAround(text, 'needle');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('needle');
  });
});

describe('kindLabel and initials', () => {
  it('names a message with no text', () => {
    expect(kindLabel('image')).toBe('Photo');
    expect(kindLabel('document')).toBe('Document');
    expect(kindLabel('text')).toBe('Message');
  });
  it('takes two letters of a name, or the last digits of a number', () => {
    expect(initials('priya sharma')).toBe('PS');
    expect(initials('Cher')).toBe('C');
    expect(initials('+919845012345')).toBe('45');
    expect(initials('   ')).toBe('?');
  });
});

describe('listWhen and dividerWhen', () => {
  const now = new Date(2026, 10, 3, 18, 0);
  it('says the time today, Yesterday, then the date', () => {
    expect(listWhen(new Date(2026, 10, 3, 14, 48).toISOString(), now)).toBe('2:48 pm');
    expect(listWhen(new Date(2026, 10, 2, 23, 0).toISOString(), now)).toBe('Yesterday');
    expect(listWhen(new Date(2026, 9, 20, 10, 0).toISOString(), now)).toBe('20 Oct');
    expect(listWhen(null, now)).toBe('');
  });
  it('says the date and time a campaign started', () => {
    expect(dividerWhen(new Date(2026, 10, 2, 14, 36).toISOString())).toBe('2 Nov, 2:36 pm');
  });
});

describe('campaignStarts', () => {
  const m = (id: string, direction: 'inbound' | 'outbound', campaignId: string | null) => ({ id, direction, campaignId, createdAt: '2026-11-03T10:00:00Z' });
  it('marks the first message of each campaign, not later ones of the same campaign', () => {
    const starts = campaignStarts([m('1', 'outbound', 'A'), m('2', 'inbound', null), m('3', 'outbound', null), m('4', 'outbound', 'A'), m('5', 'outbound', 'B')]);
    expect([...starts]).toEqual(['1', '5']);
  });
  it('marks a campaign that comes back after another one', () => {
    expect([...campaignStarts([m('1', 'outbound', 'A'), m('2', 'outbound', 'B'), m('3', 'outbound', 'A')])]).toEqual(['1', '2', '3']);
  });
  it('marks nothing for a chat no campaign wrote to', () => {
    expect(campaignStarts([m('1', 'inbound', null), m('2', 'outbound', null)]).size).toBe(0);
  });
});

describe('fillInText', () => {
  const priya = { name: 'Priya Sharma', values: { name: 'Priya Sharma', first_name: 'Priya', city: 'Pune' } };
  it('fills each fill-in with the person\'s value', () => {
    expect(fillInText('Hi {{first_name}} from {{ city }}', priya)).toBe('Hi Priya from Pune');
    expect(fillInText('Hi {{contact.name}}', priya)).toBe('Hi Priya Sharma');
  });
  it('reads "there" for a missing name and leaves another missing value empty', () => {
    expect(fillInText('Hi {{first_name}}, {{offer}}.', { name: null, values: {} })).toBe('Hi there, .');
  });
  it('matches the preview for the same person', () => {
    const cols: Column[] = [{ key: 'first_name', label: 'First name', type: 'text', have: 1 }, { key: 'city', label: 'City', type: 'text', have: 1 }];
    expect(previewHtml('Hi {{first_name}} from {{city}}', priya, cols, 0, 'any', false)).toBe(fillInText('Hi {{first_name}} from {{city}}', priya));
  });
});

describe('previewHtml without wording variations', () => {
  it('leaves {a|b} as typed in a reply to one person', () => {
    expect(previewHtml('{Hi|Hey} there', { name: null, values: {} }, [], 0, 'any', false)).toBe('{Hi|Hey} there');
    expect(previewHtml('{Hi|Hey} there', { name: null, values: {} }, [], 1, 'any')).toBe('Hey there');
  });
});
