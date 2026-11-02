import { describe, expect, it } from 'vitest';
import {
  applyVariations, checkFillIns, didYouMean, estimateFinish, fillInKeysUsed, insertFillIn, inQuiet, monthOf, monthOptions, previewHtml,
  removeVariations, whatsappHtml, wrapSelection, type Column
} from './new-campaign';

const COLS: Column[] = [
  { key: 'name', label: 'Name', type: 'text', have: 474 },
  { key: 'first_name', label: 'First name', type: 'text', have: 474 },
  { key: 'due_date', label: 'Due Date', type: 'date', have: 468 },
  { key: 'code', label: 'Coupon', type: 'text', have: 1 }
];
const priya = { name: 'Priya Sharma', values: { name: 'Priya Sharma', first_name: 'Priya', due_date: '12 Nov 2026' } };
const noName = { name: null, values: { due_date: '12 Nov 2026' } };
const noDue = { name: 'Rahul Nair', values: { name: 'Rahul Nair', first_name: 'Rahul' } };

describe('whatsappHtml', () => {
  it('reads WhatsApp markers at word edges', () => {
    expect(whatsappHtml('Hi *Priya*, _hello_ ~old~ ```code```')).toBe('Hi <b>Priya</b>, <i>hello</i> <s>old</s> <code>code</code>');
  });
  it('leaves a marker that does not hug a word, and never lets text add markup', () => {
    expect(whatsappHtml('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(whatsappHtml('<img src=x onerror=1>')).toBe('&lt;img src=x onerror=1&gt;');
  });
});

describe('previewHtml', () => {
  it('fills a person in and picks their wording variation', () => {
    const body = '{Hi|Hey|Hello} {{name}}, due {{due_date}}';
    expect(previewHtml(body, priya, COLS, 0, 'skip')).toBe('Hi Priya Sharma, due 12 Nov 2026');
    expect(previewHtml(body, priya, COLS, 4, 'skip')).toBe('Hey Priya Sharma, due 12 Nov 2026');
  });
  it('reads "there" for a missing name and flags another blank', () => {
    expect(previewHtml('Hi {{name}}', noName, COLS, 0, 'skip')).toBe('Hi there');
    expect(previewHtml('Due {{due_date}}', noDue, COLS, 0, 'skip')).toBe('Due <span class="nc-miss">blank</span>');
    expect(previewHtml('Due {{due_date}}', noDue, COLS, 0, 'word')).toBe('Due soon');
  });
  it('flags a key that is not a column and keeps fill-ins as typed with nobody to preview', () => {
    expect(previewHtml('{{duedate}}', priya, COLS, 0, 'skip')).toBe('<span class="nc-miss">duedate?</span>');
    expect(previewHtml('Hi {{name}}', null, COLS, 0, 'skip')).toBe('Hi {{name}}');
  });
  it('escapes a contact value, so a name cannot add markup', () => {
    const evil = { name: '<b>x</b>', values: { name: '<b>x</b>' } };
    expect(previewHtml('Hi {{name}}', evil, COLS, 0, 'skip')).toBe('Hi &lt;b&gt;x&lt;/b&gt;');
  });
});

describe('fill-in checks', () => {
  it('lists each key once, in lower case', () => {
    expect(fillInKeysUsed('{{Name}} {{name}} {{contact.due_date}}')).toEqual(['name', 'due_date']);
  });
  it('treats a missing name as nothing to decide and reports the most-missing other column', () => {
    const c = checkFillIns('Hi {{name}}, due {{due_date}}', COLS, 486);
    expect(c.noName).toBe(12);
    expect(c.mostMissing).toEqual({ key: 'due_date', label: 'Due Date', missing: 18, have: 468 });
    expect(c.unknown).toEqual([]);
  });
  it('names a key that is not a column, with the closest real one, and one nobody has', () => {
    expect(checkFillIns('{{duedate}}', COLS, 486).unknown).toEqual([{ key: 'duedate', suggestion: 'due_date', everyoneLacks: false }]);
    expect(checkFillIns('{{code}}', [{ ...COLS[3]!, have: 0 }], 486).unknown).toEqual([{ key: 'code', suggestion: null, everyoneLacks: true }]);
  });
  it('suggests nothing when nothing is close', () => {
    expect(didYouMean('zzzzzz', ['name', 'due_date'])).toBeNull();
  });
});

describe('wording variations', () => {
  it('puts the options where the greeting is, or in front', () => {
    expect(applyVariations('Hi {{name}}, hello', ['Hi', 'Hey', 'Hello'])).toBe('{Hi|Hey|Hello} {{name}}, hello');
    expect(applyVariations('Offer is live', ['Hi', 'Hey'])).toBe('{Hi|Hey} Offer is live');
    expect(applyVariations('Hi there', ['Hi'])).toBe('Hi there');
  });
  it('takes them out again, keeping the first word', () => {
    expect(removeVariations('{Hi|Hey|Hello} {{name}}')).toBe('Hi {{name}}');
  });
});

describe('editing helpers', () => {
  it('wraps a selection, or the word "text" with nothing selected', () => {
    expect(wrapSelection('say hi now', 4, 6, '*')).toEqual({ value: 'say *hi* now', start: 5, end: 7 });
    expect(wrapSelection('', 0, 0, '_')).toEqual({ value: '_text_', start: 1, end: 5 });
  });
  it('puts a fill-in at the cursor and replaces the brace that opened the list', () => {
    expect(insertFillIn('Hi {', 4, 4, 'name', true)).toEqual({ value: 'Hi {{name}}', cursor: 11 });
    expect(insertFillIn('Hi ', 3, 3, 'name', false)).toEqual({ value: 'Hi {{name}}', cursor: 11 });
  });
});

describe('months', () => {
  const files = [
    { id: 'a', name: 'a', at: '2026-10-28T10:00:00', people: 1 }, { id: 'b', name: 'b', at: '2026-10-02T10:00:00', people: 1 },
    { id: 'c', name: 'c', at: '2026-11-02T10:00:00', people: 1 }
  ];
  it('lists the months that have files, newest first, with how many', () => {
    expect(monthOptions(files).map((m) => m.label)).toEqual(['Nov 2026 · 1 file', 'Oct 2026 · 2 files']);
    expect(monthOf(files[0]!.at)).toBe('2026-09');
  });
});

describe('quiet hours and the finish estimate', () => {
  const quiet = { enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Kolkata' };
  const gap = { minMs: 1000, maxMs: 50000 };
  it('knows the window crosses midnight', () => {
    expect(inQuiet(23 * 60, quiet)).toBe(true);
    expect(inQuiet(7 * 60, quiet)).toBe(true);
    expect(inQuiet(12 * 60, quiet)).toBe(false);
    expect(inQuiet(23 * 60, { ...quiet, enabled: false })).toBe(false);
  });
  it('says how long it takes and when it finishes the same day', () => {
    const now = new Date('2026-11-02T09:06:00Z'); // 14:36 in India
    const e = estimateFinish(486, now, gap, quiet);
    expect(e.duration).toBe('About 3 h 27 min');
    expect(e.finish).toBe('Starting now, it finishes around 6:03 pm');
  });
  it('runs past quiet hours into the next morning', () => {
    const now = new Date('2026-11-02T09:06:00Z');
    const e = estimateFinish(1204, now, gap, quiet);
    expect(e.finish).toMatch(/runs into quiet hours and finishes about \d{1,2}:\d{2} [ap]m tomorrow/);
  });
  it('is only minutes for a handful of people', () => {
    expect(estimateFinish(3, new Date('2026-11-02T09:06:00Z'), gap, quiet).duration).toBe('About 1 min');
  });
});
