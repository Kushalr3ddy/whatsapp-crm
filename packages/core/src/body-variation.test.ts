import { describe, expect, it } from 'vitest';
import {
  blankFillIns, fillInKeys, fillVariables, renderBody, suggestFillIn, unknownFillIns, usedFillIns
} from './body-variation.js';

describe('fill-ins (CW-7.6, CW-7.7)', () => {
  it('lists the built-in keys and the org fields, lower case, once each', () => {
    expect(fillInKeys(['Due_Date', 'city', 'name'])).toEqual(['name', 'first_name', 'due_date', 'city']);
  });

  it('finds the keys a text uses, with or without the contact. prefix', () => {
    expect(usedFillIns('Hi {{ Name }}, {{contact.name}} {{due_date}}')).toEqual(['name', 'due_date']);
  });

  it('flags a key that is not a column and suggests the closest one within 2 edits', () => {
    const known = fillInKeys(['due_date', 'city']);
    expect(unknownFillIns('Due {{duedate}} in {{city}}', known)).toEqual([{ key: 'duedate', suggestion: 'due_date' }]);
    expect(unknownFillIns('{{zzzzzz}}', known)).toEqual([{ key: 'zzzzzz', suggestion: null }]);
    expect(unknownFillIns('{{name}} {{contact.first_name}}', known)).toEqual([]);
  });

  it('suggests nothing when the nearest key is more than 2 edits away', () => {
    expect(suggestFillIn('duedat', ['due_date'])).toBe('due_date');
    expect(suggestFillIn('dd', ['due_date'])).toBeNull();
  });

  it('names the keys a person has no value for, counting empty and spaces as blank', () => {
    expect(blankFillIns('{{name}} {{due_date}} {{city}}', { name: 'Asha', due_date: '  ', city: 'Pune' })).toEqual(['due_date']);
    expect(blankFillIns('{{due_date}}', {})).toEqual(['due_date']);
  });

  it('fills a blank with the fallback, and leaves a filled value alone', () => {
    const vars = { name: 'Asha', due_date: '' };
    expect(fillVariables('Hi {{name}}, due {{due_date}}', vars, 'soon')).toBe('Hi Asha, due soon');
    expect(fillVariables('Hi {{name}}, due {{due_date}}', vars)).toBe('Hi Asha, due ');
    expect(fillVariables('due {{unknown}}', vars, 'soon')).toBe('due soon');
    expect(renderBody('{Hi|Hi} {{due_date}}', vars, () => 0, 'soon')).toBe('Hi soon');
  });
});
