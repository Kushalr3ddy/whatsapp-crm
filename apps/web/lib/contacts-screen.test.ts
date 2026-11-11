import { describe, expect, it } from 'vitest';
import type { ContactSources, PersonRow } from './crm';
import {
  activeChoice, addedText, chipsFor, cleanFilter, deleteTagText, emptyView, filterCount, formatDay, initials, pageCount,
  showingText, subheading, tagsText, viewFromSearch, viewToRequest, viewToSearch, withActive, withLastMessaged,
  withoutChip
} from './contacts-screen';

const names = {
  campaigns: [{ id: 'c1', name: 'Diwali offer, 2 Nov' }],
  fields: [{ key: 'city', label: 'City' }]
};

const FILE = '11111111-1111-4111-8111-111111111111';
const TAG = '22222222-2222-4222-8222-222222222222';
const OWN = '55555555-5555-4555-8555-555555555555';
const LIST = '33333333-3333-4333-8333-333333333333';
const sources: ContactSources = {
  total: 530,
  files: [{ id: FILE, filename: 'Drivers Pune.csv', importedAt: '2026-10-28T08:00:00Z', count: 486, tagId: TAG, tagName: 'Drivers Pune', columns: ['City'] }],
  tags: [{ id: OWN, name: 'Called', colour: null, count: 3 }],
  lists: [{ id: LIST, name: 'Waiting for us', definition: { waitingForUs: true }, count: 12 }],
  campaigns: names.campaigns, fields: names.fields
};

describe('what the filter controls mean in the stored filter', () => {
  it('last active maps to within-days or longer-ago, and back', () => {
    expect(withActive({}, '30')).toEqual({ activeWithinDays: 30 });
    expect(withActive({ activeWithinDays: 30 }, 'older')).toEqual({ activeOlderThanDays: 90 });
    expect(withActive({ activeOlderThanDays: 90 }, 'any')).toEqual({});
    expect(activeChoice({ activeOlderThanDays: 90 })).toBe('older');
    expect(activeChoice({ activeWithinDays: 7 })).toBe('7');
    expect(activeChoice({})).toBe('any');
  });

  it('last messaged swaps between recent and not-in-30-days', () => {
    expect(withLastMessaged({}, 'recent')).toEqual({ lastContactedWithinDays: 30 });
    expect(withLastMessaged({ lastContactedWithinDays: 30 }, 'stale')).toEqual({ notContactedWithinDays: 30 });
  });

  it('cleans a filter: a rule with nothing to compare drops out, a blank rule keeps no value', () => {
    expect(cleanFilter({ fieldRules: [{ key: 'city', op: 'is', value: '  ' }] })).toEqual({});
    expect(cleanFilter({ fieldRules: [{ key: 'city', op: 'blank', value: 'x' }, { key: 'city', op: 'has', value: ' pune ' }] }))
      .toEqual({ fieldRules: [{ key: 'city', op: 'blank' }, { key: 'city', op: 'has', value: 'pune' }] });
  });
});

describe('chips', () => {
  it('names each active filter in words, search first', () => {
    const chips = chipsFor('asha', {
      replied: 'ever', activeWithinDays: 30, waitingForUs: true, campaigns: 'some', campaignId: 'c1',
      lastContactedWithinDays: 30, dnc: 'only', whatsapp: 'unchecked', email: 'no', importedWithinDays: 90,
      fieldRules: [{ key: 'city', op: 'is', value: 'Pune' }, { key: 'city', op: 'is', value: '' }]
    }, names);
    expect(chips.map((c) => c.label)).toEqual([
      'Search: asha', 'Replied: yes', 'Last active: last 30 days', 'Waiting for us', 'Campaigns: messaged',
      'In campaign: Diwali offer, 2 Nov', 'Last messaged: last 30 days', 'Can be messaged: do not contact',
      'WhatsApp: not checked', 'Email: missing', 'Imported: last 90 days', 'City is “Pune”'
    ]);
  });

  it('takes one chip off and leaves the rest', () => {
    const f = { replied: 'ever' as const, email: 'yes' as const, fieldRules: [{ key: 'city', op: 'is' as const, value: 'Pune' }, { key: 'city', op: 'filled' as const }] };
    expect(withoutChip('x', f, 'replied')).toEqual({ q: 'x', filter: { email: 'yes', fieldRules: f.fieldRules } });
    expect(withoutChip('x', f, 'q')).toEqual({ q: '', filter: f });
    expect(withoutChip('x', f, 'rule:0').filter.fieldRules).toEqual([{ key: 'city', op: 'filled' }]);
    expect(withoutChip('x', { fieldRules: [f.fieldRules[0]!] }, 'rule:0').filter).toEqual({});
  });

  it('counts filters without the search', () => {
    expect(filterCount({ replied: 'never', email: 'yes' })).toBe(2);
    expect(filterCount({})).toBe(0);
  });
});

describe('the address holds the view', () => {
  it('writes only what is not the default, and reads it back', () => {
    expect(viewToSearch(emptyView())).toBe('');
    const v = { ...emptyView(), source: { kind: 'file' as const, id: FILE }, q: 'asha', filter: { email: 'yes' as const }, page: 2, size: 100, sort: 'name_desc' as const };
    const back = viewFromSearch(Object.fromEntries(new URLSearchParams(viewToSearch(v))), sources);
    expect(back).toEqual(v);
  });

  it('a saved list is only named in the address and its definition becomes the filter', () => {
    const v = { ...emptyView(), source: { kind: 'list' as const, id: LIST }, filter: { waitingForUs: true as const } };
    expect(viewToSearch(v)).toBe(`?list=${LIST}`);
    expect(viewFromSearch({ list: LIST }, sources).filter).toEqual({ waitingForUs: true });
  });

  it('opens a file when the address names the file’s own tag, as the Import page links it', () => {
    expect(viewFromSearch({ tag: TAG }, sources).source).toEqual({ kind: 'file', id: FILE });
  });

  it('ignores a file, tag or list that is gone, a cut-short filter and a bad page, instead of failing', () => {
    const gone = '44444444-4444-4444-8444-444444444444';
    expect(viewFromSearch({ file: gone, list: gone, tag: gone }, sources).source).toEqual({ kind: 'all', id: '' });
    expect(viewFromSearch({ f: '{"email":' }, sources).filter).toEqual({});
    expect(viewFromSearch({ f: '[1]' }, sources).filter).toEqual({});
    const v = viewFromSearch({ page: '-3', size: '7', sort: 'weird' }, sources);
    expect([v.page, v.size, v.sort]).toEqual([0, 50, 'name_asc']);
  });

  it('asks the server for the file as a source, the filter as the filter, and pages by offset', () => {
    const v = { ...emptyView(), source: { kind: 'file' as const, id: FILE }, filter: { email: 'yes' as const, fieldRules: [{ key: 'city', op: 'is' as const, value: ' ' }] }, page: 2, size: 50 };
    expect(viewToRequest(v)).toEqual({ sort: 'name_asc', file: FILE, filter: { email: 'yes' }, limit: 50, offset: 100 });
    expect(viewToRequest(v, false)).toEqual({ sort: 'name_asc', file: FILE, filter: { email: 'yes' } });
  });
});

describe('words on the screen', () => {
  const person = (over: Partial<PersonRow>): PersonRow => ({
    id: 'p', displayName: 'Asha Rao', doNotContact: false, createdAt: '', identities: [], tags: [], customFields: {},
    lastActiveAt: null, file: null, lastCampaign: null, fileValues: null, ...over
  });

  it('formats a day in the install’s zone, with the year only when it is not this year', () => {
    const now = new Date('2026-11-03T10:00:00Z');
    expect(formatDay('2026-10-28T08:00:00Z', 'Asia/Kolkata', now)).toBe('28 Oct');
    expect(formatDay('2025-10-28T08:00:00Z', 'Asia/Kolkata', now)).toBe('28 Oct 2025');
    // 22:00 UTC is already the next morning in India.
    expect(formatDay('2026-10-27T22:00:00Z', 'Asia/Kolkata', now)).toBe('28 Oct');
  });

  it('shows the file’s tag first, two tags and a count of the rest', () => {
    const t = (name: string, isFile = false) => ({ id: name, name, colour: null, isFile });
    expect(tagsText(person({ tags: [t('Drivers Pune.csv', true), t('Called'), t('Follow up')] }))).toBe('Drivers Pune.csv, Called +1');
    expect(tagsText(person({ tags: [] }))).toBe('');
  });

  it('says where in the list you are', () => {
    expect(showingText(0, 50, 530)).toBe('Showing 1–50 of 530 people');
    expect(showingText(10, 50, 530)).toBe('Showing 501–530 of 530 people');
    expect(showingText(0, 50, 1)).toBe('Showing 1–1 of 1 person');
    expect(showingText(0, 50, 0)).toBe('0 people');
    expect(pageCount(530, 50)).toBe(11);
    expect(pageCount(0, 50)).toBe(1);
  });

  it('makes initials', () => {
    expect(initials('Asha Rao')).toBe('AR');
    expect(initials('Madonna')).toBe('MA');
    expect(initials('  ')).toBe('?');
  });

  it('says what is picked on the left', () => {
    const day = (iso: string) => formatDay(iso, 'UTC', new Date('2026-11-03T00:00:00Z'));
    expect(subheading({ kind: 'all', id: '' }, sources, day)).toBe('Everyone you can message, from all your imported files.');
    expect(subheading({ kind: 'file', id: FILE }, sources, day))
      .toBe('People from Drivers Pune.csv, imported 28 Oct. They all carry the tag “Drivers Pune”.');
    expect(subheading({ kind: 'tag', id: OWN }, sources, day)).toBe('People you tagged “Called”.');
    expect(subheading({ kind: 'list', id: LIST }, sources, day)).toBe('People who match your list “Waiting for us”.');
  });

  it('says who a deleted tag comes off, and who got a new one', () => {
    expect(deleteTagText('Called', 3).body).toBe('It comes off 3 people. The people stay in your contacts. This cannot be undone.');
    expect(deleteTagText('Called', 1).body.startsWith('It comes off 1 person.')).toBe(true);
    expect(deleteTagText('Called', 0).body.startsWith('Nobody has it.')).toBe(true);
    expect(addedText('Called', 5, 3)).toBe('Added “Called” to 5 people (2 already had it).');
    expect(addedText('Called', 1, 1)).toBe('Added “Called” to 1 person.');
  });
});
