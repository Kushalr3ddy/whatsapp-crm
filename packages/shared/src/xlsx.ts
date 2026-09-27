import ExcelJS from 'exceljs';

/**
 * Reads the first worksheet of an `.xlsx` file into rows of strings.
 *
 * Every cell is taken as its **displayed text**, never its typed value — a phone number a
 * spreadsheet stored as a number would otherwise arrive as `9.19e11` or lose a leading zero, and
 * this whole system turns on phone numbers surviving intact (M8). Downstream everything is the
 * same CSV pipeline, so an imported sheet and an imported CSV are treated identically.
 */
export async function parseXlsxRows(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // Cast bridges a types-only mismatch: Node 20's `Buffer` is generic (`Buffer<ArrayBufferLike>`)
  // while exceljs's bundled types expect the older non-generic `Buffer`. Same object at runtime.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (ws === undefined) return [];

  const width = ws.columnCount;
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      // `.text` is the formatted display value as a string ('' for an empty cell), which is what
      // a person saw in the sheet — exactly what a mapping should match against.
      cells.push(row.getCell(c).text.trim());
    }
    rows.push(cells);
  });
  return rows;
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
