import { describe, expect, it } from 'vitest';
import { changedFields } from './changed-fields';

const form = (pairs: Array<[string, string]>): Array<[string, string]> => pairs;

describe('changedFields: what a Contacts form saves', () => {
  it('[R-044] a field the person did not touch is not sent, so a stale page cannot put an old value back', () => {
    // The page was drawn with city Pune, stage new. Only the city box was edited.
    const sent = changedFields(form([['f_city', 'Mumbai'], ['o_city', 'Pune'], ['f_stage', 'new'], ['o_stage', 'new']]));
    expect(sent).toEqual({ city: 'Mumbai' });
  });

  it('a field the person changed is sent, and so is one they cleared', () => {
    expect(changedFields(form([['f_city', ''], ['o_city', 'Pune'], ['f_age', '31'], ['o_age', '30']]))).toEqual({ city: '', age: '31' });
  });

  it('a field that was empty and is still empty is not sent', () => {
    expect(changedFields(form([['f_city', ''], ['o_city', '']]))).toEqual({});
  });

  it('a field with no original value counts the original as empty, so typing into it is a change', () => {
    expect(changedFields(form([['f_city', 'Pune']]))).toEqual({ city: 'Pune' });
  });

  it('files and other form entries are ignored', () => {
    expect(changedFields([['contactId', 'x'], ['f_city', new File(['a'], 'a.txt')], ['f_age', '5'], ['o_age', '4']])).toEqual({ age: '5' });
  });
});
