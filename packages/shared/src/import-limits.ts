/**
 * How much of an uploaded contact file the importer will read (R-016).
 *
 * The 20 MB upload cap bounds the bytes received, not what they become: an 18 KB .xlsx with one cell in the last column made the old
 * parser build 33 million cells and took the API down, and a 20 MB CSV of commas is two million columns. These limits bound the parsed
 * shape instead. They are generous for a contact list (200,000 people, 200 columns) and are checked while reading, so an oversized file
 * is refused as soon as it crosses one rather than after it has been built in memory.
 */
export interface ImportLimits {
  /** Columns that hold a value. Empty, merely formatted cells further right do not count. */
  readonly maxColumns: number;
  /** Data rows, not counting the header. */
  readonly maxRows: number;
  /** Characters in one cell. */
  readonly maxCellChars: number;
  /** Rows × columns of the parsed table, which is what ends up in memory. */
  readonly maxCells: number;
  /** What an .xlsx may unpack to in total, as its zip directory declares. */
  readonly maxUnpackedBytes: number;
  /** How many times larger one zip entry may unpack than it is packed (only checked above 1 MB unpacked). */
  readonly maxUnpackRatio: number;
  /** Files inside one .xlsx. A real workbook has a few dozen. */
  readonly maxZipEntries: number;
}

/** The limits in force. 200,000 people x 10 columns, plus the header, fits inside `maxCells`. */
export const IMPORT_LIMITS: ImportLimits = Object.freeze({
  maxColumns: 200,
  maxRows: 200_000,
  maxCellChars: 10_000,
  maxCells: 2_500_000,
  maxUnpackedBytes: 100 * 1024 * 1024,
  maxUnpackRatio: 100,
  maxZipEntries: 1_000
});

/** Which limit a file crossed. */
export type ImportLimitKind = 'columns' | 'rows' | 'cell' | 'cells' | 'unpacked' | 'ratio' | 'entries';

/** A file is larger, in some dimension, than the importer will read. The message is written for the person who uploaded it. */
export class ImportLimitError extends Error {
  /** `kind` says which limit, for code; `message` says what to do, for the person. */
  constructor(readonly kind: ImportLimitKind, message: string) {
    super(message);
    this.name = 'ImportLimitError';
  }
}

/** An .xlsx whose zip structure cannot be read at all. */
export class SpreadsheetError extends Error {
  /** Carries what the zip reader or exceljs said, for the log. */
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetError';
  }
}

/** The refusal for a file over the row limit, shared by the CSV and the spreadsheet reader. */
export function tooManyRows(limits: ImportLimits): ImportLimitError {
  return new ImportLimitError('rows',
    `This file has more than ${limits.maxRows.toLocaleString('en')} rows. Split it into smaller files and upload them one at a time.`);
}

/** The refusal for a file over the column limit. */
export function tooManyColumns(limits: ImportLimits): ImportLimitError {
  return new ImportLimitError('columns',
    `This file has data in more than ${String(limits.maxColumns)} columns. Keep only the columns you need and upload it again.`);
}

/** The refusal for one oversized cell. */
export function cellTooLong(limits: ImportLimits): ImportLimitError {
  return new ImportLimitError('cell',
    `A cell in this file is longer than ${limits.maxCellChars.toLocaleString('en')} characters, which no contact field needs.`);
}

/** The refusal for a table whose rows × columns is too large to hold. */
export function tooManyCells(limits: ImportLimits): ImportLimitError {
  return new ImportLimitError('cells',
    `This file has more than ${limits.maxCells.toLocaleString('en')} cells. Remove columns you do not need, or split the rows into smaller files.`);
}
