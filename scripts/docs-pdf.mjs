// Builds one printable PDF of the whole documentation set: cover, contents (with page numbers),
// every chapter in reading order, and an alphabetical index. Output: build/whatsapp-crm-docs.pdf.
// Run with `npm run docs:pdf`. Two passes: the first finds which page each chapter lands on,
// the second prints again with those numbers filled into the contents.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build');
const outPdf = join(outDir, 'whatsapp-crm-docs.pdf');

/** Reading order: working docs first, then the design docs the way docs/README.md groups them. */
const PARTS = [
  ['Start here', ['GETTING_STARTED.md', 'HANDOFF.md', 'CHANGELOG.md', 'docs/README.md', 'docs/20-orientation.md']],
  ['The product', ['docs/01-vision-scope.md', 'docs/00-prior-art.md', 'docs/03-competitive-analysis.md', 'docs/02-requirements.md', 'docs/17-roadmap.md']],
  ['The design', ['docs/04-architecture.md', 'docs/05-data-model.md', 'docs/10-stack.md', 'docs/18-providers.md', 'docs/11-conventions.md', 'docs/12-testing.md']],
  ['Features', ['docs/06-features/README.md', ...readdirSync(join(root, 'docs/06-features'))
    .filter((f) => /^F\d+-/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
    .map((f) => `docs/06-features/${f}`)]],
  ['Anti-ban, ingestion, linking', ['docs/08-antiban.md', 'docs/07-ingestion.md', 'docs/25-ingestion-guide.md', 'docs/26-linking-lifecycle.md']],
  ['Security and access', ['docs/09-security.md', 'docs/22-encryption.md', 'docs/23-auth.md']],
  ['API and integration', ['docs/15-api.md', 'docs/16-integration-jobportal.md']],
  ['Running it', ['docs/13-deployment.md', 'docs/19-capacity.md', 'docs/14-runbooks.md', 'docs/24-local-testing.md']],
  ['Open decisions', ['docs/21-deferred.md']]
];

/** Colour emoji have no glyph in the print fonts and render as empty boxes, so swap in plain symbols. */
const GLYPHS = { '✅': '✔', '⬜': '☐', '❌': '✘', '⚠': '⚠', '🔜': '(soon)', '\uFE0F': '' };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every chapter, in order, with the file it came from and its id used for cross-links. */
const chapters = [];
for (const [part, files] of PARTS) {
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8').replace(/[✅⬜❌⚠🔜\uFE0F]/g, (c) => GLYPHS[c] ?? '');
    const title = (text.match(/^#\s+(.+)$/m)?.[1] ?? basename(file)).replace(/[`*]/g, '');
    chapters.push({ part, file, text, title, id: `ch-${chapters.length + 1}` });
  }
}
const idByFile = new Map(chapters.map((c) => [resolve(root, c.file), c.id]));

const indexTerms = new Map(); // heading text -> [{chapter id, anchor}]

/** Renders one chapter, prefixing heading ids so two chapters can't collide and rewriting
 *  links between documents to jump inside the PDF. Collects ## headings for the index. */
function renderChapter(ch) {
  const marked = new Marked();
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const raw = this.parser.parseInline(tokens);
        const anchor = `${ch.id}-${slug(raw)}`;
        if (depth === 2) {
          const key = raw.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
          if (!indexTerms.has(key)) indexTerms.set(key, []);
          indexTerms.get(key).push({ id: ch.id, anchor });
        }
        const mark = depth === 2 ? `<span class="marker">⟦${anchor}⟧</span>` : '';
        return `<h${depth} id="${anchor}">${mark}${raw}</h${depth}>\n`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const [path, hash] = href.split('#');
        if (/^(https?:|mailto:)/.test(href)) return `<a href="${href}">${inner}</a>`;
        if (path.endsWith('.md')) {
          const target = idByFile.get(resolve(root, dirname(ch.file), path));
          if (target) return `<a href="#${hash ? `${target}-${hash}` : target}">${inner}</a>`;
        }
        return `<span class="deadlink">${inner}</span>`;
      }
    }
  });
  const body = marked.parse(ch.text.replace(/^#\s+.+\n/, '')); // the title is rendered separately
  return `<section class="chapter" id="${ch.id}">
  <div class="kicker">${esc(ch.part)} · <span class="src">${esc(ch.file)}</span></div>
  <span class="marker">⟦${ch.id}⟧</span>
  <h1>${esc(ch.title)}</h1>
  ${body}
</section>`;
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font: 10pt/1.5 Georgia, 'Times New Roman', 'DejaVu Serif', serif; color: #111; }
h1, h2, h3, h4, .kicker, .toc, th { font-family: 'Helvetica Neue', Arial, sans-serif; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover h1 { font-size: 34pt; margin: 0 0 6mm; border: 0; }
.cover p { font-size: 13pt; color: #444; margin: 0 0 3mm; }
.chapter { page-break-before: always; }
.chapter > h1 { font-size: 22pt; margin: 2mm 0 6mm; border-bottom: 2px solid #111; padding-bottom: 2mm; }
.kicker { font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #777; }
.marker { color: #fff; font-size: 1px; line-height: 0; }
h2 { font-size: 15pt; margin: 8mm 0 2mm; break-after: avoid; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; break-after: avoid; }
h4 { font-size: 10.5pt; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
code { font: 8.6pt 'DejaVu Sans Mono', Menlo, monospace; background: #f1f1f1; padding: 0 2px; border-radius: 2px; }
pre, pre code { font-family: 'DejaVu Sans Mono', Menlo, monospace; }
pre { background: #f6f6f6; border: 1px solid #ddd; padding: 3mm; overflow-wrap: anywhere; white-space: pre-wrap; break-inside: avoid-page; }
pre code { background: none; padding: 0; font-size: 8pt; }
blockquote { margin: 3mm 0; padding: 1mm 4mm; border-left: 3px solid #999; color: #333; background: #fafafa; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 8.8pt; }
th, td { border: 1px solid #bbb; padding: 1.2mm 2mm; vertical-align: top; text-align: left; }
th { background: #eee; }
tr { break-inside: avoid; }
img { max-width: 100%; }
a { color: #0a3d91; text-decoration: none; }
.deadlink { color: #444; }
.toc { page-break-after: always; }
.toc h1 { font-size: 22pt; border-bottom: 2px solid #111; padding-bottom: 2mm; }
.toc h3 { margin: 5mm 0 1mm; font-size: 10pt; text-transform: uppercase; letter-spacing: .06em; color: #555; }
.toc .row { display: flex; align-items: baseline; font-size: 9.5pt; padding: .4mm 0; }
.toc .row .dots { flex: 1; border-bottom: 1px dotted #999; margin: 0 2mm; }
.toc .row .file { color: #888; font-size: 7.5pt; margin-left: 2mm; }
.index { page-break-before: always; }
.index h1 { font-size: 22pt; border-bottom: 2px solid #111; padding-bottom: 2mm; }
.index .cols { column-count: 2; column-gap: 8mm; font: 8.8pt/1.4 'Helvetica Neue', Arial, sans-serif; }
.index .letter { font-weight: bold; margin: 3mm 0 1mm; break-after: avoid; font-size: 10pt; }
.index .term { break-inside: avoid; display: flex; }
.index .term .dots { flex: 1; border-bottom: 1px dotted #bbb; margin: 0 1mm 2px; }
`;

/** Builds the full HTML. `pages` maps chapter id → page number (and `index` → page of the index). */
function buildHtml(pages) {
  const toc = PARTS.map(([part]) => {
    const rows = chapters.filter((c) => c.part === part).map((c) =>
      `<div class="row"><a href="#${c.id}">${esc(c.title)}</a><span class="file">${esc(c.file)}</span><span class="dots"></span><span>${pages[c.id] ?? ''}</span></div>`).join('');
    return `<h3>${esc(part)}</h3>${rows}`;
  }).join('');

  const terms = [...indexTerms.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));
  let letter = '';
  const indexRows = terms.map(([term, refs]) => {
    const l = (term.replace(/^[^A-Za-z0-9]+/, '')[0] ?? '#').toUpperCase();
    const head = l !== letter ? `<div class="letter">${(letter = l)}</div>` : '';
    const first = refs[0];
    const nums = [...new Set(refs.map((r) => pages[r.anchor]).filter(Boolean))].sort((a, b) => a - b);
    const where = nums.length ? nums.join(', ') : '';
    return `${head}<div class="term"><a href="#${first.anchor}">${esc(term)}</a><span class="dots"></span><span>${where}</span></div>`;
  }).join('');

  const today = new Date().toISOString().slice(0, 10);
  return `<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp CRM — documentation</title><style>${CSS}</style></head><body>
<div class="cover"><h1>WhatsApp CRM</h1><p>Complete documentation — printable edition</p>
<p>${chapters.length} documents · generated ${today} from the repository</p>
<p style="color:#888;font-size:10pt">Working docs first, then the design docs in reading order. Contents and an index of every section heading follow.</p></div>
<div class="toc"><h1>Contents</h1>${toc}<h3>Back matter</h3><div class="row"><a href="#index">Index of sections</a><span class="dots"></span><span>${pages.index ?? ''}</span></div></div>
${chapters.map(renderChapter).join('\n')}
<section class="index" id="index"><span class="marker">⟦index⟧</span><h1>Index of sections</h1><div class="cols">${indexRows}</div></section>
</body></html>`;
}

/** Which page each marker lands on, read back from the rendered PDF's text layer. */
function findPages(pdf) {
  const count = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }))[1]);
  const pages = {};
  const wanted = new Set([...chapters.map((c) => c.id), 'index', ...[...indexTerms.values()].flat().map((r) => r.anchor)]);
  for (let p = 1; p <= count && wanted.size; p++) {
    const text = execFileSync('pdftotext', ['-f', String(p), '-l', String(p), pdf, '-'], { encoding: 'utf8' });
    for (const m of text.matchAll(/⟦([^⟧]+)⟧/g)) {
      if (wanted.delete(m[1])) pages[m[1]] = p;
    }
  }
  return pages;
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  /** Renders the given HTML to the output PDF with page numbers in the footer. */
  const print = async (html) => {
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outPdf, format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font:8px Arial;color:#777;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' }
    });
  };
  await print(buildHtml({}));
  const pages = findPages(outPdf);
  await print(buildHtml(pages));
  const verify = findPages(outPdf);
  const drift = Object.keys(pages).filter((k) => pages[k] !== verify[k]);
  if (drift.length) console.warn(`contents page numbers moved for: ${drift.join(', ')}`);
} finally {
  await browser.close();
}
if (!existsSync(outPdf)) throw new Error('PDF was not written');
console.log(`wrote ${outPdf} (${chapters.length} documents, ${indexTerms.size} index entries)`);
