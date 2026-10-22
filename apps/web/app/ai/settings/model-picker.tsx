'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LlmModel } from '@/lib/crm';

/** The most rows drawn at once; a provider can list hundreds, and a list that long is unreadable. Typing narrows it. */
const SHOWN = 40;

/**
 * A searchable model picker in the app's own style: type to narrow the provider's list, use the arrow keys and Enter or click to choose, and Escape to close.
 * Any name can also be typed by hand (a model the list does not show). The recommended model, the one we measured, is marked and listed first.
 */
export function ModelPicker(
  { id, value, models, recommended, onChange, disabled }:
  { id: string; value: string; models: LlmModel[]; recommended: string | null; onChange: (next: string) => void; disabled?: boolean }
) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // The text used to narrow the list: what was typed since the list was opened, not the chosen value.
  const [typed, setTyped] = useState<string | null>(null);

  const query = (typed ?? '').trim().toLowerCase();
  const rows = useMemo(() => {
    const hit = models.filter((m) => query === '' || m.id.toLowerCase().includes(query) || (m.name ?? '').toLowerCase().includes(query));
    // The tested model first, then the provider's own order.
    return [...hit].sort((a, b) => Number(b.id === recommended) - Number(a.id === recommended));
  }, [models, query, recommended]);
  const shown = rows.slice(0, SHOWN);
  const typedName = (typed ?? '').trim();
  const offerTyped = typedName !== '' && !models.some((m) => m.id === typedName);
  const total = shown.length + (offerTyped ? 1 : 0);

  useEffect(() => {
    /** Closes the list when the pointer goes down anywhere outside this control. */
    function away(e: MouseEvent) { if (box.current !== null && !box.current.contains(e.target as Node)) { setOpen(false); setTyped(null); } }
    document.addEventListener('mousedown', away);
    return () => { document.removeEventListener('mousedown', away); };
  }, []);

  /** Chooses a model and closes the list. */
  function choose(next: string) { onChange(next); setOpen(false); setTyped(null); }

  /** Arrow keys move, Enter chooses, Escape closes. */
  function key(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => (total === 0 ? 0 : (a + 1) % total)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((a) => (total === 0 ? 0 : (a - 1 + total) % total)); }
    else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (active < shown.length) choose(shown[active]!.id);
      else if (offerTyped) choose(typedName);
    } else if (e.key === 'Escape') { setOpen(false); setTyped(null); }
  }

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <input
          id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off" disabled={disabled}
          className="field w-full pr-9 font-normal" placeholder={models.length > 0 ? `Search ${String(models.length)} models, or type a name` : 'Type a model name, or press Find models'}
          value={open && typed !== null ? typed : value}
          onFocus={() => { setOpen(models.length > 0); setActive(0); }}
          onChange={(e) => { setTyped(e.target.value); onChange(e.target.value); setOpen(models.length > 0); setActive(0); }}
          onKeyDown={key}
        />
        {models.length > 0 && (
          <button
            type="button" tabIndex={-1} aria-label="Show the models" disabled={disabled}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted hover:text-ink"
            onClick={() => { setOpen(!open); setTyped(null); setActive(0); }}
          >
            <span aria-hidden className={`text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
          </button>
        )}
      </div>

      {open && models.length > 0 && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <ul id={listId} role="listbox" aria-label="Models" className="max-h-72 overflow-y-auto py-1">
            {shown.map((m, i) => (
              <li
                key={m.id} role="option" aria-selected={m.id === value}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-accent-soft' : ''}`}
                onMouseEnter={() => { setActive(i); }}
                onMouseDown={(e) => { e.preventDefault(); choose(m.id); }}
              >
                <span className="w-4 shrink-0 text-accent" aria-hidden>{m.id === value ? '✓' : ''}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{m.id}</span>
                  {m.name !== undefined && <span className="ml-2 text-xs text-muted">{m.name}</span>}
                </span>
                {m.id === recommended && <span className="badge badge-accent shrink-0">tested</span>}
                {m.contextLength !== undefined && <span className="shrink-0 text-xs text-muted">{String(Math.round(m.contextLength / 1000))}k</span>}
              </li>
            ))}
            {offerTyped && (
              <li
                role="option" aria-selected={false}
                className={`flex cursor-pointer items-center gap-2 border-t border-border px-3 py-1.5 text-sm ${active === shown.length ? 'bg-accent-soft' : ''}`}
                onMouseEnter={() => { setActive(shown.length); }}
                onMouseDown={(e) => { e.preventDefault(); choose(typedName); }}
              >
                <span className="w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">Use “{typedName}” as typed</span>
              </li>
            )}
            {total === 0 && <li className="px-3 py-2 text-sm text-muted">No models match. Type the name to use it as it is.</li>}
          </ul>
          {rows.length > SHOWN && (
            <p className="border-t border-border px-3 py-1.5 text-xs text-muted">Showing {SHOWN} of {rows.length}. Keep typing to narrow the list.</p>
          )}
        </div>
      )}
    </div>
  );
}
