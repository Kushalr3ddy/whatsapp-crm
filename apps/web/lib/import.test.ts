import { describe, expect, it } from 'vitest';
import type { ImportUpload } from './crm';
import {
  checkCounts, columnCount, countryOptions, doneCounts, exampleValues, formatNumber, gapFileName, groupSkipped, missingDetails, otherColumns, peekPeople,
  exampleParts, isGap, pageList, tagNote, tagProblem, peopleText, phoneOptionId, phoneOptions, readColumns, sheetColumns, sheetRow, skipReason, skippedCsv, skippedLine, tagFromFile, type ColumnChoice
} from './import';

/** An upload the way the server describes it, with columns profiled as the server does (phoneShare of the filled cells). */
function upload(headers: string[], shares: Record<string, number>, extra: Partial<ImportUpload> = {}): ImportUpload {
  return {
    id: 'run-1', sha256: 'x', rowCount: 500, headers, sample: [], reimportOf: null,
    columns: headers.map((header) => ({ header, sampled: 100, phoneShare: shares[header] ?? 0, emailShare: 0 })),
    ...extra
  };
}

describe('readColumns', () => {
  it('finds the one column of numbers and the name', () => {
    const r = readColumns(upload(['Full Name', 'Mobile', 'City'], { Mobile: 1 }, { suggestions: { phone: 'Mobile', email: null, name: 'Full Name' } }));
    expect(r.kind).toBe('ready');
    if (r.kind !== 'ready') return;
    expect(r.choice.phones).toEqual(['Mobile']);
    expect(r.choice.name).toEqual({ kind: 'column', column: 'Full Name' });
    expect(r.choice.country).toBe('IN');
  });

  it('asks which to message when two columns hold numbers', () => {
    const r = readColumns(upload(['Name', 'Mobile', 'Alt Phone'], { Mobile: 1, 'Alt Phone': 0.9 }, { suggestions: { phone: 'Mobile', email: null, name: 'Name' } }));
    expect(r.kind).toBe('pick');
    if (r.kind !== 'pick') return;
    expect(r.candidates).toEqual(['Mobile', 'Alt Phone']);
    expect(r.choice.phones).toEqual(['Mobile', 'Alt Phone']);
  });

  it('joins a first and a last name column', () => {
    const r = readColumns(upload(['First Name', 'Last Name', 'Phone'], { Phone: 1 }, { suggestions: { phone: 'Phone', email: null, name: 'First Name' } }));
    if (r.kind === 'no-phone') throw new Error('expected a phone column');
    expect(r.choice.name).toEqual({ kind: 'joined', first: 'First Name', last: 'Last Name' });
  });

  it('uses the header when the values are mostly unreadable, so the check can say what is wrong', () => {
    const r = readColumns(upload(['Name', 'Mobile'], { Mobile: 0.2 }, { suggestions: { phone: null, email: null, name: 'Name' } }));
    expect(r.kind).toBe('ready');
    if (r.kind !== 'ready') return;
    expect(r.choice.phones).toEqual(['Mobile']);
  });

  it('says so when no column looks like a mobile number', () => {
    const r = readColumns(upload(['Name', 'Email', 'City', 'Company'], {}, { suggestions: { phone: null, email: 'Email', name: 'Name' } }));
    expect(r).toEqual({ kind: 'no-phone', headers: ['Name', 'Email', 'City', 'Company'] });
  });

  it('keeps the email for matching but never reads it as a number or a name', () => {
    const r = readColumns(upload(['Name', 'Mobile', 'Email'], { Mobile: 1 }, { suggestions: { phone: 'Mobile', email: 'Email', name: 'Name' } }));
    if (r.kind === 'no-phone') throw new Error('expected a phone column');
    expect(r.choice.email).toBe('Email');
  });
});

describe('otherColumns', () => {
  const choice: ColumnChoice = { phones: ['Mobile'], name: { kind: 'joined', first: 'First', last: 'Last' }, email: 'Email', country: 'IN' };
  it('is every column the name, number and email do not use', () => {
    expect(otherColumns(['First', 'Last', 'Mobile', 'Email', 'City', 'Source'], choice)).toEqual(['City', 'Source']);
  });
});

describe('exampleValues', () => {
  it('shows up to three values and marks a blank one', () => {
    const sample = [{ Alt: '+1 202 555 0150' }, { Alt: '+1 202 555 0151' }, { Alt: '' }, { Alt: 'never shown' }];
    expect(exampleValues(sample, 'Alt')).toBe('+1 202 555 0150 · +1 202 555 0151 · (empty)');
  });
});

describe('countryOptions', () => {
  it('lists India first, then the rest by name', () => {
    const list = countryOptions();
    expect(list[0]).toEqual({ code: 'IN', label: 'India (+91)' });
    expect(list.some((c) => c.label === 'United States (+1)')).toBe(true);
    expect(list.filter((c) => c.code === 'IN')).toHaveLength(1);
  });
});

describe('tagFromFile', () => {
  it('names the tag after the file', () => {
    expect(tagFromFile('Drivers Pune.csv')).toBe('Drivers-Pune');
    expect(tagFromFile('walk_in october.xlsx')).toBe('walk-in-october');
    expect(tagFromFile('x'.repeat(80) + '.csv')).toHaveLength(60);
  });

  it('leaves out the full date and time an export puts in its file name, so the tag is one a person would type', () => {
    expect(tagFromFile('Purchase-Manager_20260622211807_160.xlsx')).toBe('Purchase-Manager-160');
    expect(tagFromFile('Leads 2026.csv')).toBe('Leads-2026');
    // Other long numbers are kept: they may be what tells two files apart.
    expect(tagFromFile('flow-1793766765804.csv')).toBe('flow-1793766765804');
    expect(tagFromFile('20260622211807.csv')).toBe('20260622211807');
  });
});

describe('skipReason', () => {
  it('reads the server’s sentences', () => {
    expect(skipReason('no usable identity: every identity column was empty')).toBe('no_number');
    expect(skipReason('Mobile: "not-a-phone" contains no digits.')).toBe('bad_number');
    expect(skipReason('Mobile: "123" has too few digits to be a phone number.')).toBe('bad_number');
    expect(skipReason('Email: "test" is not an email address')).toBe('bad_email');
  });
});

describe('groupSkipped', () => {
  const choice: ColumnChoice = { phones: ['Mobile'], name: { kind: 'column', column: 'Name' }, email: null, country: 'IN' };
  const errors = [
    { rowNumber: 13, error: 'no usable identity: every identity column was empty', raw: { Name: 'Sunil Patil', Mobile: '' } },
    { rowNumber: 51, error: 'no usable identity: every identity column was empty', raw: { Name: 'Imran Shaikh', Mobile: '' } },
    { rowNumber: 32, error: 'Mobile: "12" has too few digits to be a phone number.', raw: { Name: 'Deepak More', Mobile: '12' } }
  ];

  it('groups by reason, biggest first, with sheet row numbers', () => {
    const { groups, unlisted } = groupSkipped({ errors, warnings: [] }, choice, 3);
    expect(groups.map((g) => [g.reason, g.count])).toEqual([['no_number', 2], ['bad_number', 1]]);
    expect(groups[0]?.rows[0]).toMatchObject({ row: 14, name: 'Sunil Patil' });
    expect(unlisted).toBe(0);
  });

  it('says how many rows the server did not list', () => {
    expect(groupSkipped({ errors, warnings: [] }, choice, 250).unlisted).toBe(247);
  });

  it('names a row the way the list does', () => {
    const { groups } = groupSkipped({ errors, warnings: [] }, choice, 3);
    expect(skippedLine(groups[1]!.rows[0]!)).toBe('Row 33, Deepak More (12)');
    expect(skippedLine(groups[0]!.rows[0]!)).toBe('Row 14, Sunil Patil (—)');
  });

  it('joins a first and a last name', () => {
    const joined: ColumnChoice = { ...choice, name: { kind: 'joined', first: 'First', last: 'Last' } };
    const { groups } = groupSkipped({ errors: [{ rowNumber: 1, error: 'no usable identity: x', raw: { First: 'Anita', Last: 'Sharma' } }], warnings: [] }, joined, 1);
    expect(groups[0]?.rows[0]?.name).toBe('Anita Sharma');
  });
});

describe('skippedCsv', () => {
  it('holds the sheet’s own columns and the reason, quoted', () => {
    const csv = skippedCsv(
      [{ row: 14, name: 'Sunil "S" Patil', value: '', raw: { Name: 'Sunil "S" Patil', Mobile: '' }, reason: 'no_number' }],
      ['Name', 'Mobile']
    );
    expect(csv.split('\n')).toEqual([
      '"Sheet row","Name","Mobile","Why it was skipped"',
      '"14","Sunil ""S"" Patil","","No mobile number in the row"'
    ]);
  });
});

describe('checkCounts', () => {
  it('counts people already in your contacts as updated plus unchanged', () => {
    expect(checkCounts({ created: 430, updated: 20, skipped: 14, errors: 28 })).toEqual({ ready: 464, fresh: 430, existing: 34, skipped: 28 });
  });
});

describe('doneCounts', () => {
  it('counts each person once by the tag, even when a file lists someone on two rows', () => {
    // 27 rows read fine, but one person was on two rows: 26 people.
    expect(doneCounts({ created: 25, updated: 1, skipped: 1, errors: 2, tagged: 26 })).toEqual({ ready: 26, fresh: 25, existing: 1, skipped: 2 });
  });
  it('falls back to the rows when nobody was tagged', () => {
    expect(doneCounts({ created: 5, updated: 1, skipped: 0, errors: 0 })).toEqual({ ready: 6, fresh: 5, existing: 1, skipped: 0 });
  });
});

describe('small texts', () => {
  it('says a small number of columns in words', () => {
    expect(columnCount(2)).toBe('two');
    expect(columnCount(9)).toBe('9');
  });
  it('counts people', () => {
    expect(peopleText(1)).toBe('1 person');
    expect(peopleText(464)).toBe('464 people');
  });
  it('turns a ledger row into a sheet row', () => {
    expect(sheetRow(1)).toBe(2);
  });
});

describe('phoneOptions', () => {
  const sample = [{ Mobile: '+1 202 555 0101', 'Alt Phone': '+1 202 555 0150' }, { Mobile: '+1 202 555 0102', 'Alt Phone': '' }];
  const two = upload(['Name', 'Mobile', 'Alt Phone', 'City'], { Mobile: 1, 'Alt Phone': 1 }, { sample });
  const choice: ColumnChoice = { phones: ['Mobile', 'Alt Phone'], name: { kind: 'none' }, email: null, country: 'IN' };

  it('lists each column of numbers, then both together', () => {
    const o = phoneOptions(two, choice);
    expect(o.map((x) => x.label)).toEqual(['Mobile', 'Alt Phone', 'Both']);
    expect(o[0]?.examples).toBe('+1 202 555 0101 · +1 202 555 0102');
    expect(o[2]?.phones).toEqual(['Mobile', 'Alt Phone']);
  });

  it('finds the option in use', () => {
    const o = phoneOptions(two, choice);
    expect(phoneOptionId(o, ['Mobile', 'Alt Phone'])).toBe(o[2]?.id);
    expect(phoneOptionId(o, ['Alt Phone'])).toBe('Alt Phone');
  });

  it('offers no "both" for a file with one column of numbers, but still lists the one in use', () => {
    const one = upload(['Name', 'Contact', 'City'], { Contact: 1 });
    const o = phoneOptions(one, { ...choice, phones: ['Contact'] });
    expect(o.map((x) => x.label)).toEqual(['Contact']);
  });

  it('lets a column the server misread be picked when a fifth of it looks like numbers', () => {
    const odd = upload(['Name', 'Reach me', 'Notes'], { 'Reach me': 0.3 });
    expect(phoneOptions(odd, { ...choice, phones: ['Notes'] }).map((x) => x.label)).toEqual(['Reach me', 'Notes', 'Both']);
  });
});

describe('formatNumber', () => {
  it('spaces an international number', () => {
    expect(formatNumber('+12025550100')).toBe('+1 202 555 0100');
  });
  it('shows what it cannot read as it was given', () => {
    expect(formatNumber('not a number')).toBe('not a number');
  });
});

describe('missingDetails', () => {
  const choice: ColumnChoice = { phones: ['Phone'], name: { kind: 'column', column: 'Name' }, email: 'Email', country: 'IN' };
  const up = upload(['Name', 'Phone', 'Email', 'Salary', 'City', 'Notice'], {}, {
    columnFill: [
      { header: 'Name', blank: 0 }, { header: 'Phone', blank: 3 }, { header: 'Email', blank: 1 },
      { header: 'Salary', blank: 40 }, { header: 'City', blank: 5 }, { header: 'Notice', blank: 0 }
    ]
  });

  it('lists only columns with gaps, the key ones first, then the most missing', () => {
    expect(missingDetails(up, choice).map((m) => [m.header, m.blank, m.role])).toEqual([
      ['Phone', 3, 'phone'], ['Email', 1, 'email'], ['Salary', 40, 'other'], ['City', 5, 'other']
    ]);
  });

  it('is empty when the server sent no counts or nobody is missing anything', () => {
    expect(missingDetails(upload(['Name'], {}), choice)).toEqual([]);
    expect(missingDetails(upload(['Name'], {}, { columnFill: [{ header: 'Name', blank: 0 }] }), choice)).toEqual([]);
  });
});

describe('peekPeople', () => {
  const choice: ColumnChoice = { phones: ['Phone'], name: { kind: 'column', column: 'Name' }, email: null, country: 'IN' };
  const up = upload(['City', 'Name', 'Phone', 'Salary'], {}, {
    peek: [{ row: 57, values: { City: 'Pune', Name: 'Asha Fiction', Phone: '2025550101', Salary: 'NA' } }]
  });

  it('puts the name and number first, keeps the file’s order after, and names what is missing', () => {
    const [p] = peekPeople(up, choice);
    expect(p?.row).toBe(57);
    expect(p?.name).toBe('Asha Fiction');
    expect(p?.fields.map((f) => f.header)).toEqual(['Phone', 'City']);
    expect(p?.missing).toEqual(['Salary']);
  });

  it('shows nobody when the server drew nobody', () => {
    expect(peekPeople(upload(['Name'], {}), choice)).toEqual([]);
  });
});

describe('gapFileName', () => {
  it('names the file after the detail that is missing', () => {
    expect(gapFileName(['Doctorate degree'])).toBe('people-missing-doctorate-degree.csv');
    expect(gapFileName(['Time Of View'])).toBe('people-missing-time-of-view.csv');
  });

  it('says how many more when several are chosen, and has a plain name when none is', () => {
    expect(gapFileName(['City', 'Name'])).toBe('people-missing-city-and-1-more.csv');
    expect(gapFileName(['City', 'Name', 'Email'])).toBe('people-missing-city-and-2-more.csv');
    expect(gapFileName([])).toBe('people-from-sheet.csv');
  });

  it('copes with a header that has no letters or digits, and with a very long one', () => {
    expect(gapFileName(['---'])).toBe('people-missing-detail.csv');
    expect(gapFileName(['x'.repeat(100)])).toBe(`people-missing-${'x'.repeat(40)}.csv`);
  });
});

describe('sheetColumns', () => {
  const choice: ColumnChoice = { phones: ['Phone'], name: { kind: 'column', column: 'Name' }, email: 'Email', country: 'IN' };

  it('puts the name, number and email first, then the rest in the sheet’s own order', () => {
    expect(sheetColumns(['City', 'Email', 'Phone', 'Notes', 'Name'], choice)).toEqual(['Name', 'Phone', 'Email', 'City', 'Notes']);
  });

  it('puts a first and a last name column first together', () => {
    const joined: ColumnChoice = { phones: ['Phone'], name: { kind: 'joined', first: 'First', last: 'Last' }, email: null, country: 'IN' };
    expect(sheetColumns(['City', 'Last', 'Phone', 'First'], joined)).toEqual(['Last', 'First', 'Phone', 'City']);
  });
});

describe('isGap', () => {
  it('is true for an empty cell and for the markers a sheet uses for "no value"', () => {
    for (const v of ['', '  ', 'NA', 'n/a', 'N.A.', 'nil', 'null', 'None', '-', '--', '—']) expect(isGap(v)).toBe(true);
  });

  it('is false for anything with a real value, even one that contains a marker', () => {
    for (const v of ['Pune', 'Nagpur', '0', 'na na', 'Anil']) expect(isGap(v)).toBe(false);
  });
});

describe('pageList', () => {
  it('lists every page when there are few', () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(2, 4)).toEqual([1, 2, 3, 4]);
    expect(pageList(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the first and last page and the ones beside the current, with a gap marker between', () => {
    expect(pageList(1, 20)).toEqual([1, 2, '…', 20]);
    expect(pageList(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(pageList(20, 20)).toEqual([1, '…', 19, 20]);
  });

  it('shows a single missing page instead of a gap marker standing for one page', () => {
    expect(pageList(3, 20)).toEqual([1, 2, 3, 4, '…', 20]);
    expect(pageList(18, 20)).toEqual([1, '…', 17, 18, 19, 20]);
  });

  it('treats a current page outside the range as the nearest real page, and copes with no pages', () => {
    expect(pageList(99, 5)).toEqual([1, '…', 4, 5]);
    expect(pageList(0, 5)).toEqual([1, 2, '…', 5]);
    expect(pageList(1, 0)).toEqual([]);
  });
});

describe('exampleParts', () => {
  it('shows each number as it will be saved, in international form', () => {
    expect(exampleParts({ raw: '7001367448', numbers: ['+917001367448'], dropped: [], problem: null }))
      .toEqual([{ kind: 'number', text: '+91 70013 67448' }]);
  });

  it('keeps every number of a cell and says which part could not be read', () => {
    expect(exampleParts({ raw: '8553912035, +9156006008553912035', numbers: ['+918553912035'], dropped: ['+9156006008553912035'], problem: null }))
      .toEqual([{ kind: 'number', text: '+91 85539 12035' }, { kind: 'dropped', text: '+9156006008553912035' }]);
  });

  it('gives the reason when nothing in the cell can be read', () => {
    expect(exampleParts({ raw: '98765x43210', numbers: [], dropped: [], problem: '"98765x43210" has letters inside the number.' }))
      .toEqual([{ kind: 'problem', text: '"98765x43210" has letters inside the number.' }]);
  });

  it('calls an empty cell empty', () => {
    expect(exampleParts({ raw: '', numbers: [], dropped: [], problem: null })).toEqual([{ kind: 'empty', text: '(empty)' }]);
    expect(exampleParts({ raw: 'NA', numbers: [], dropped: [], problem: null })).toEqual([{ kind: 'empty', text: '(empty)' }]);
  });
});

describe('tagNote', () => {
  it('says the tag is made when the import runs, when it is new', () => {
    expect(tagNote('Drivers-Pune', ['Hot leads'])).toBe('New tag: it is created when you import. Everyone in this file gets it, so you can find and message them later.');
  });

  it('says so when the tag already exists, ignoring case and spaces at the ends', () => {
    expect(tagNote(' drivers-pune ', ['Hot leads', 'Drivers-Pune'])).toBe('This tag already exists. Everyone in this file is added to it, next to the people who have it.');
  });

  it('asks for a name when the tag is empty, in the same words as the rule that blocks the import', () => {
    expect(tagNote('  ', [])).toBe(tagProblem('  '));
  });
});

describe('tagProblem', () => {
  it('refuses an empty or blank tag: the tag is how these people are found later, so an import never goes without one', () => {
    for (const t of ['', '   ', '\t']) expect(tagProblem(t), JSON.stringify(t)).toBe('Give the tag a name before you import: every person in this file gets it, and it is how you find them later.');
  });

  it('accepts any tag with something in it', () => {
    for (const t of ['Drivers-Pune', ' x ', '2026']) expect(tagProblem(t), t).toBeNull();
  });
});
