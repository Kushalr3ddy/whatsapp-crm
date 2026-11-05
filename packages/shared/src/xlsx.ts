import {
  IMPORT_LIMITS, ImportLimitError, SpreadsheetError, cellTooLong, tooManyCells, tooManyColumns, tooManyRows, type ImportLimits
} from './import-limits.js';
import { parseCsvRows } from './csv.js';

/**
 * Reads the first worksheet of an `.xlsx` file into rows of strings, within `limits` (R-016).
 *
 * Every cell is taken as its **displayed text**, never its typed value — a phone number a
 * spreadsheet stored as a number would otherwise arrive as `9.19e11` or lose a leading zero, and
 * this whole system turns on phone numbers surviving intact (M8). Downstream everything is the
 * same CSV pipeline, so an imported sheet and an imported CSV are treated identically.
 *
 * An .xlsx is a zip, so its byte size says nothing about what it holds. The zip directory is
 * checked against the unpacked-size budget before anything is inflated, and then only cells that
 * hold a value are read: the table is as wide as the last column with data, not the sheet's
 * declared width (one cell in column XFD made the old reader build 16,384 cells for every row).
 * exceljs' streaming reader would use less memory but fails on workbooks whose sheet comes before
 * `workbook.xml` in the zip, which exceljs itself writes. The directory's sizes can lie, which is
 * why the API also runs this in a child process with its own memory cap (`apps/api/src/import-parse.ts`).
 */
export async function parseXlsxRows(buffer: Buffer, limits: ImportLimits = IMPORT_LIMITS): Promise<string[][]> {
  checkZipBudget(buffer, limits);

  // Loaded here, not at the top: exceljs takes over a second to load, and the import reader's child processes mostly read CSV.
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  try {
    // Cast bridges a types-only mismatch: Node 20's `Buffer` is generic (`Buffer<ArrayBufferLike>`)
    // while exceljs's bundled types expect the older non-generic `Buffer`. Same object at runtime.
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (error) {
    throw new SpreadsheetError(error instanceof Error ? error.message : String(error));
  }
  const ws = wb.worksheets[0];
  if (ws === undefined) return [];
  if (ws.actualRowCount > limits.maxRows + 1) throw tooManyRows(limits);

  const rows: string[][] = [];
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      // `.text` is the formatted display value, which is what a person saw in the sheet.
      const text = cell.text.trim();
      if (text === '') return;
      if (column > limits.maxColumns) throw tooManyColumns(limits);
      if (text.length > limits.maxCellChars) throw cellTooLong(limits);
      cells[column - 1] = text;
    });
    if (cells.length === 0) return;                      // a row with nothing in it is not a record
    rows.push(cells);
    width = Math.max(width, cells.length);
    if (rows.length * width > limits.maxCells) throw tooManyCells(limits);
  });
  return rows.map((cells) => Array.from({ length: width }, (_, i) => cells[i] ?? ''));
}

/** Zip records, from the zip format's own description (APPNOTE.TXT). */
const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
/** A zip64 field: a size or count too large for the classic format, which no contact list needs. */
const ZIP64 = 0xffffffff;
/** Small entries may compress very well legitimately; the ratio is only judged above this. */
const RATIO_FLOOR_BYTES = 1024 * 1024;

/**
 * Refuses an .xlsx whose zip directory declares more than `limits` allow, without inflating anything.
 * Throws `SpreadsheetError` when the bytes are not a readable zip.
 */
function checkZipBudget(buffer: Buffer, limits: ImportLimits): void {
  const end = findEndOfDirectory(buffer);
  if (end < 0) throw new SpreadsheetError('not a zip file');
  const entries = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryAt = buffer.readUInt32LE(end + 16);
  if (entries === 0xffff || directoryAt === ZIP64) throw unpackedTooLarge(limits);
  if (directoryAt + directorySize > buffer.length) throw new SpreadsheetError('the zip directory is cut off');
  if (entries > limits.maxZipEntries) {
    throw new ImportLimitError('entries', `This spreadsheet is made of more than ${String(limits.maxZipEntries)} parts, which a contact list never needs.`);
  }

  let at = directoryAt;
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== DIRECTORY_ENTRY) throw new SpreadsheetError('the zip directory is damaged');
    const packed = buffer.readUInt32LE(at + 20);
    const unpacked = buffer.readUInt32LE(at + 24);
    if (packed === ZIP64 || unpacked === ZIP64) throw unpackedTooLarge(limits);
    total += unpacked;
    if (unpacked > RATIO_FLOOR_BYTES && unpacked / Math.max(packed, 1) > limits.maxUnpackRatio) {
      throw new ImportLimitError('ratio', 'This spreadsheet unpacks to far more than its size suggests, so it was not opened. Save it again from your spreadsheet program, or export it as CSV.');
    }
    at += 46 + buffer.readUInt16LE(at + 28) + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  if (total > limits.maxUnpackedBytes) throw unpackedTooLarge(limits);
}

/** The refusal for a workbook that unpacks past the budget. */
function unpackedTooLarge(limits: ImportLimits): ImportLimitError {
  return new ImportLimitError('unpacked',
    `This spreadsheet unpacks to more than ${String(Math.round(limits.maxUnpackedBytes / 1024 / 1024))} MB. Split it into smaller files, or export it as CSV.`);
}

/** Where the zip's end-of-directory record starts (it sits in the last 64 KB + 22 bytes), or -1. */
function findEndOfDirectory(buffer: Buffer): number {
  const last = buffer.length - 22;
  for (let i = last; i >= 0 && i >= last - 0xffff; i--) {
    if (buffer.readUInt32LE(i) === END_OF_DIRECTORY) return i;
  }
  return -1;
}

/**
 * Serialises rows to CSV text (RFC 4180 quoting), so an uploaded spreadsheet can be stored and
 * re-parsed by the same `parseCsv` path a CSV upload uses — one parser, one set of edge cases.
 */
export function rowsToCsv(rows: string[][]): string {
  const escape = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return rows.map((row) => row.map(escape).join(',')).join('\r\n');
}

/** True when these bytes are an `.xlsx` (a ZIP container: the `PK\x03\x04` local-file header). */
export function looksLikeXlsx(buffer: Buffer): boolean {
  return buffer.length >= 4
    && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * Reads an uploaded contact file within `limits`: an .xlsx becomes CSV text, a CSV is checked as it is.
 * `csvText` is the converted spreadsheet, or null for a CSV (whose own bytes are already the text).
 */
export async function readImportFile(
  bytes: Buffer, limits: ImportLimits = IMPORT_LIMITS
): Promise<{ isXlsx: boolean; csvText: string | null }> {
  if (looksLikeXlsx(bytes)) return { isXlsx: true, csvText: rowsToCsv(await parseXlsxRows(bytes, limits)) };
  parseCsvRows(bytes.toString('utf8'), limits);
  return { isXlsx: false, csvText: null };
}
