import { describe, expect, it } from 'vitest';
import { recipientVars } from './campaign-text.js';

const person = (displayName: string | null) => ({ campaignId: 'c', contactId: 'p', displayName, customFields: null });

describe('recipientVars: the greeting for a person', () => {
  it('uses the name as it is saved', () => {
    expect(recipientVars(person('Ravi Kumar'))).toMatchObject({ name: 'Ravi Kumar', first_name: 'Ravi' });
  });

  it('reads "there" for a person with no name', () => {
    expect(recipientVars(person(null))).toMatchObject({ name: 'there', first_name: 'there' });
    expect(recipientVars(person('  '))).toMatchObject({ name: 'there', first_name: 'there' });
  });

  it('reads "there", not their number, for a person whose saved name is their phone number', () => {
    for (const n of ['+919876543210', '919876543210', '+91 98765 43210', '098765-43210']) {
      expect(recipientVars(person(n)), n).toMatchObject({ name: 'there', first_name: 'there' });
    }
  });

  it('keeps a name that merely contains digits', () => {
    expect(recipientVars(person('Unit 7 Traders'))).toMatchObject({ name: 'Unit 7 Traders', first_name: 'Unit' });
  });
});
