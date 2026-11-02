import { readImportFile, ImportLimitError, CsvError, looksLikeXlsx, type ImportLimits } from '@crm/shared';

/**
 * The child process `import-parse.ts` forks to read one uploaded file (R-016). It reads exactly one message, answers once and exits,
 * so nothing it allocated outlives the upload. Run with a capped heap: if the file exhausts it, this process dies, not the API.
 */
process.once('message', (message: { bytes: Uint8Array; limits: ImportLimits }) => {
  void answer(Buffer.from(message.bytes), message.limits);
});
// Started ahead of need and left waiting: when the API goes, so does this.
process.once('disconnect', () => { process.exit(0); });

/** Reads the file, sends back the result or why it was refused, and exits. */
async function answer(bytes: Buffer, limits: ImportLimits): Promise<void> {
  let reply: unknown;
  try {
    const result = await readImportFile(bytes, limits);
    reply = { ok: true, isXlsx: result.isXlsx, csvText: result.csvText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ImportLimitError) reply = { ok: false, code: 'IMPORT_LIMIT', message };
    else if (error instanceof CsvError) reply = { ok: false, code: 'MALFORMED_CSV', message };
    else if (looksLikeXlsx(bytes)) reply = { ok: false, code: 'MALFORMED_XLSX', message: 'That file could not be read as an .xlsx spreadsheet.' };
    else reply = { ok: false, code: 'FILE_UNREADABLE', message: 'This file could not be read.' };
  }
  process.send!(reply, () => { process.exit(0); });
}
