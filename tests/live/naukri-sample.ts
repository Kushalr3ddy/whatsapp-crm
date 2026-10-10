import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One candidate row in the style of a recruiter's Naukri export; only name + phone matter to us. */
interface Row { name: string; phone: string; email: string; exp: string; ctc: string; city: string }

/**
 * Writes a synthetic, Naukri-looking .xlsx and returns its path.
 *
 * It stands in for the real production export until we have one, so it is deliberately messy the
 * way those files are: extra columns we ignore, phones in several
 * formats (a bare number, `+91 98…`, `0` prefix, a number stored as a spreadsheet *number*), a
 * blank row, and a duplicate. The `recipients` are the operator's own numbers; the filler rows use
 * a reserved-looking 90000 000xx range and are never messaged.
 */
export async function writeNaukriSample(recipients: Array<{ name: string; phone: string }>): Promise<string> {
  const filler: Row[] = Array.from({ length: 12 }, (_, i) => ({
    name: `Sample Candidate ${String(i + 1).padStart(2, '0')}`,
    phone: [
      `90000${String(10000 + i)}`,           // bare 10 digits
      `+91 90000 ${String(20000 + i)}`,      // spaced, with country code
      `090000${String(30000 + i)}`,          // trunk-prefixed
      `+91-90000-${String(40000 + i)}`       // dashed
    ][i % 4]!,
    email: `sample${String(i + 1)}@example.test`,
    exp: `${String(1 + (i % 9))} Years`, ctc: `${String(3 + (i % 12))} Lacs`,
    city: ['Bengaluru', 'Pune', 'Hyderabad', 'Chennai'][i % 4]!
  }));
  const own: Row[] = recipients.map((r) => ({
    name: r.name, phone: r.phone, email: `${r.name.toLowerCase().replace(/\W+/g, '.')}@example.test`,
    exp: '5 Years', ctc: '12 Lacs', city: 'Bengaluru'
  }));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Candidates');
  const header = ['Candidate Name', 'Mobile Number', 'Email ID', 'Total Experience', 'Current CTC', 'Current Location'];
  ws.addRow(header);
  for (const r of [...own, ...filler]) ws.addRow([r.name, r.phone, r.email, r.exp, r.ctc, r.city]);
  // One filler row unique to this run: the importer refuses identical bytes twice, so a re-run
  // of the demo would otherwise be rejected as "already imported".
  const unique = String(Date.now()).slice(-6);
  ws.addRow([`Run ${unique} Candidate`, `+91 9000 ${unique.slice(0, 3)} ${unique.slice(3)}`, `run${unique}@example.test`, '2 Years', '4 Lacs', 'Pune']);
  ws.addRow([]);
  ws.addRow([own[0]?.name ?? 'Duplicate', own[0]?.phone ?? '', 'dup@example.test', '5 Years', '12 Lacs', 'Bengaluru']);

  const dir = mkdtempSync(join(tmpdir(), 'naukri-sample-'));
  const path = join(dir, 'naukri-export-sample.xlsx');
  await wb.xlsx.writeFile(path);
  return path;
}
