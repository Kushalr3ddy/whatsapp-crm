import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { docHtmlToText, docIdFrom, docJsonToText, splitProblems, titleFrom, toImporterMarkdown } from '../../scripts/lib/gdoc';

/**
 * The Google Doc reader (D-92): a tester's doc becomes one problem per heading or numbered line, with the screenshots counted (never copied)
 * and the person's words kept as they wrote them. The sample is the text of a real report from the other dev (no names or numbers in it).
 */
const sample = readFileSync(new URL('../fixtures/gdoc-feedback-sample.txt', import.meta.url), 'utf8');

describe('reading a feedback doc', () => {
  it('finds one problem per numbered line, undoing Google\'s escapes, and counts every screenshot', () => {
    const items = splitProblems(sample);
    expect(items.map((i) => i.n)).toEqual([1, 2, 3, 4]);
    expect(items.map((i) => i.images)).toEqual([1, 1, 2, 1]);
    expect(items[0]!.title).toBe("Can't send messages from AI: shows as waiting for message");
    expect(items[2]!.lines).toEqual(['cant see the message that is being sent to user', 'does show in the inbox part of the app tho']);
    expect(JSON.stringify(items)).not.toContain('[image]');
  });

  it('starts a problem at a heading too, and reads the template\'s labelled lines', () => {
    const items = splitProblems('Intro text that is ignored\n## Import is slow\nWhich screen: Import\nWhat happened instead: it hangs\n[image]\n## Second one\njust words');
    expect(items.map((i) => i.title)).toEqual(['Import is slow', 'Second one']);
    expect(items[0]!.fields).toEqual([['Which screen', 'Import'], ['What happened instead', 'it hangs']]);
    expect(items[0]!.images).toBe(1);
  });

  it('writes the markdown the importer reads, with no screenshot data', () => {
    const md = toImporterMarkdown(splitProblems(sample), { reporter: 'Mikhil', docId: 'x'.repeat(30), date: '2026-10-22' });
    expect(md).toContain('## issue-3: cant see the message that is being sent to user');
    expect(md).toContain('![screenshot in the Google Doc, item 3, 2 of 2](gdoc-item-3-2)');
    expect(md).toContain('> does show in the inbox part of the app tho');
    expect(md).not.toMatch(/data:image|base64/);
  });

  it('shortens a long first line into a title', () => {
    expect(titleFrom('number is not there in the excel sheet i think, but is still showing as person there and being updated:').length).toBeLessThanOrEqual(92);
    expect(titleFrom('Short title:')).toBe('Short title');
  });

  it('reads a doc link or a bare id, and refuses anything else', () => {
    const id = 'a'.repeat(44);
    expect(docIdFrom(`https://docs.google.com/document/d/${id}/edit?tab=t.0`)).toBe(id);
    expect(docIdFrom(id)).toBe(id);
    expect(() => docIdFrom('https://example.com/nothing')).toThrow();
  });

  it('turns Google\'s structured document into text with headings, numbered items and image markers', () => {
    const doc = {
      lists: { l1: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }] } } },
      body: { content: [
        { paragraph: { elements: [{ textRun: { content: 'First problem\n' } }], bullet: { listId: 'l1', nestingLevel: 0 } } },
        { paragraph: { elements: [{ inlineObjectElement: {} }, { textRun: { content: '\n' } }] } },
        { paragraph: { elements: [{ textRun: { content: 'Second problem\n' } }], bullet: { listId: 'l1', nestingLevel: 0 } } }
      ] }
    };
    const items = splitProblems(docJsonToText(doc));
    expect(items.map((i) => i.title)).toEqual(['First problem', 'Second problem']);
    expect(items[0]!.images).toBe(1);
  });

  it('reads the simple HTML view of a doc (the way the browser tool does, with no credentials): a list item, typed numbers, pictures', () => {
    // The shape of /document/d/<id>/mobilebasic as seen on a real feedback doc: the first problem is a real list item, later ones are typed "2.", pictures are <img> in paragraphs.
    const html = '<html><head><style>.x{}</style></head><body><div class="container"><div class="doc-content"><ol class="s" start="1"><li><span>Can&#39;t send messages &amp; it says waiting:</span></li></ol>' +
      '<p><span><img src="https://example.invalid/a?x=1"></span></p><p><span></span></p><hr>' +
      '<p><span>2. number is not in the sheet</span></p><p><span><img src="b"></span></p>' +
      '<p><span>3. cant see the message</span></p><p><span>does show in the inbox</span></p><p><span><img src="c"></span><span><img src="d"></span></p></div></div></body></html>';
    const text = docHtmlToText(html);
    expect(text.split('\n')).toEqual(["1. Can't send messages & it says waiting:", '[image]', '2. number is not in the sheet', '[image]', '3. cant see the message', 'does show in the inbox', '[image] [image]']);
    const items = splitProblems(text);
    expect(items.map((i) => i.n)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.images)).toEqual([1, 1, 2]);
    expect(items[0]!.title).toBe("Can't send messages & it says waiting");
  });

  it('turns an HTML heading into a problem start and a bullet into a plain line', () => {
    const text = docHtmlToText('<div class="doc-content"><h2><span>Import is slow</span></h2><ul><li><span>it hangs</span></li></ul></div>');
    expect(text).toBe('## Import is slow\n- it hangs');
    expect(splitProblems(text).map((i) => i.title)).toEqual(['Import is slow']);
  });
});
