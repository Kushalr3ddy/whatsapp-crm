'use client';

import { useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent, RefObject } from 'react';
import { insertFillIn, wrapSelection } from '@/lib/new-campaign';

/**
 * The WhatsApp-style message box, shared by New campaign and the Inbox reply box: one place for how the toolbar marks words, how
 * Ctrl+B and Ctrl+I work, how a fill-in goes in at the cursor (and how typing `{` opens the list), and how a pasted picture is taken.
 *
 * The screens keep their own layout and wording; what they share is this behaviour. The text helpers themselves (`wrapSelection`,
 * `insertFillIn`, `previewHtml`) live in `lib/new-campaign.ts`.
 */

/** What the box hands the screen. */
export interface MessageBox {
  /** Attach to the `<textarea>`. */
  ref: RefObject<HTMLTextAreaElement | null>;
  /** The last thing typed was a `{` that opened the fill-in list, so choosing a fill-in replaces that brace. */
  braceTyped: boolean;
  setBraceTyped: (typed: boolean) => void;
  /** Wraps the selected words (or the word "text") in a WhatsApp marker: `*`, `_`, `~` or three backticks. */
  wrap: (marker: string) => void;
  /** Puts a fill-in at the cursor. `brace` replaces the `{` the person just typed. */
  insert: (key: string, brace: boolean) => void;
  /** Sets the text and puts the cursor (or selection) back where a helper left it. */
  put: (value: string, from: number, to: number) => void;
  /** Reads typing: sets the text, and a lone `{` asks the screen to open its fill-in list. */
  onChange: (value: string, cursor: number) => void;
  /** Ctrl/Cmd+B marks bold and Ctrl/Cmd+I italic. Returns true when it handled the key. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/**
 * The behaviour of one message box.
 * @param value the text now in the box
 * @param setValue how the screen stores new text
 * @param onBraceMenu told to open (true) or close (false) the fill-in list as a brace is typed or dropped
 * @param afterPut run after a helper changed the text (the Inbox box uses it to resize)
 */
export function useMessageBox(
  value: string, setValue: (next: string) => void, onBraceMenu: (open: boolean) => void, afterPut?: () => void
): MessageBox {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [braceTyped, setBraceTyped] = useState(false);

  /** Sets the text and puts the cursor back where a helper left it. */
  function put(next: string, from: number, to: number): void {
    setValue(next);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(from, to); afterPut?.(); });
  }
  /** Wraps the selected words in a WhatsApp marker. */
  function wrap(marker: string): void {
    const t = ref.current;
    if (t === null) return;
    const r = wrapSelection(value, t.selectionStart, t.selectionEnd, marker);
    put(r.value, r.start, r.end);
  }
  /** Puts a fill-in at the cursor. */
  function insert(key: string, brace: boolean): void {
    const t = ref.current;
    const r = insertFillIn(value, t?.selectionStart ?? value.length, t?.selectionEnd ?? value.length, key, brace);
    onBraceMenu(false);
    put(r.value, r.cursor, r.cursor);
  }
  /** Reads typing in the box; a brace opens the fill-in list. */
  function onChange(next: string, cursor: number): void {
    setValue(next);
    const brace = next.charAt(cursor - 1) === '{' && next.charAt(cursor - 2) !== '{';
    setBraceTyped(brace);
    if (brace) onBraceMenu(true); else if (next.charAt(cursor - 1) !== '{') onBraceMenu(false);
  }
  /** Ctrl+B and Ctrl+I. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
      const k = event.key.toLowerCase();
      if (k === 'b') { event.preventDefault(); wrap('*'); return true; }
      if (k === 'i') { event.preventDefault(); wrap('_'); return true; }
    }
    return false;
  }

  return { ref, braceTyped, setBraceTyped, wrap, insert, put, onChange, onKeyDown };
}

/** The four formatting buttons: bold, italic, strikethrough and monospace. The screen gives the class that styles the group. */
export function FormatButtons({ className, onWrap }: { className: string; onWrap: (marker: string) => void }) {
  return (
    <span className={className} role="group" aria-label="Format">
      <button type="button" aria-label="Bold" title="Bold (Ctrl+B)" onClick={() => { onWrap('*'); }}><b>B</b></button>
      <button type="button" aria-label="Italic" title="Italic (Ctrl+I)" onClick={() => { onWrap('_'); }}><i>I</i></button>
      <button type="button" aria-label="Strikethrough" title="Strikethrough" onClick={() => { onWrap('~'); }}><s>S</s></button>
      <button type="button" aria-label="Monospace" title="Monospace" onClick={() => { onWrap('```'); }}>&lt;/&gt;</button>
    </span>
  );
}

/**
 * The pictures in a paste: the ones the box takes (up to `max` in all, `have` already there) and a plain reason when some are left out.
 * `found` is false for an ordinary text paste, which the box leaves alone.
 */
export function picturesFromPaste(
  event: ReactClipboardEvent<HTMLTextAreaElement>, have: number, max: number, allowed: readonly string[]
): { found: boolean; take: File[]; problem: string | null } {
  const images = [...event.clipboardData.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile()).filter((f): f is File => f !== null);
  if (images.length === 0) return { found: false, take: [], problem: null };
  const fine = images.filter((f) => allowed.includes(f.type));
  const take = fine.slice(0, Math.max(0, max - have));
  const problem = fine.length < images.length ? 'Only JPG, PNG, WebP and GIF pictures can be sent.'
    : take.length < fine.length ? `You can attach up to ${String(max)} pictures.` : null;
  return { found: true, take, problem };
}
