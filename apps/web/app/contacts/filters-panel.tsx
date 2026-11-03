'use client';

import { Plus, X } from 'lucide-react';
import type { ContactSources, FieldRule, SegmentDefinition } from '@/lib/crm';
import {
  RULE_OPS, activeChoice, importedChoice, lastMessagedChoice, withActive, withImported, withKey, withLastMessaged,
  type ActiveChoice, type ImportedChoice, type LastMessagedChoice
} from '@/lib/contacts-screen';

/** One row of buttons where exactly one is pressed. */
function Seg<T extends string>(
  { label, value, options, onPick }: {
    label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onPick: (v: T) => void;
  }
) {
  return (
    <div>
      <h4>{label}</h4>
      <div className="ct-seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => { onPick(v); }}>{text}</button>
        ))}
      </div>
    </div>
  );
}

/**
 * The one grouped Filters control: how they responded, what you have sent, whether you can reach them, and rules on the
 * columns of their file. It edits the stored filter directly, and the match count is the table's own total.
 */
export function FiltersPanel(
  { filter, sources, matching, onChange, onSave, onClear }: {
    filter: SegmentDefinition;
    sources: ContactSources;
    /** How many people match right now. */
    matching: number;
    onChange: (next: SegmentDefinition) => void;
    onSave: () => void;
    onClear: () => void;
  }
) {
  const rules = filter.fieldRules ?? [];
  const setRules = (next: FieldRule[]): void => { onChange(withKey(filter, 'fieldRules', next.length === 0 ? undefined : next)); };
  const setRule = (i: number, patch: Partial<FieldRule>): void => {
    setRules(rules.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  };
  const firstField = sources.fields[0]?.key;
  const dncChoice = filter.dnc === 'exclude' ? 'ok' : filter.dnc === 'only' ? 'dnc' : 'any';

  return (
    <>
      <div className="ct-fg">
        <h3>How they responded</h3>
        <Seg<'any' | 'ever' | 'never'> label="Replied" value={filter.replied ?? 'any'}
          options={[['any', 'Any'], ['ever', 'Replied'], ['never', 'Never replied']]}
          onPick={(v) => { onChange(withKey(filter, 'replied', v === 'any' ? undefined : v)); }} />
        <Seg<ActiveChoice> label="Last active within" value={activeChoice(filter)}
          options={[['any', 'Any'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['older', 'Longer ago']]}
          onPick={(v) => { onChange(withActive(filter, v)); }} />
        <label className="ct-chk">
          <input type="checkbox" checked={filter.waitingForUs === true}
            onChange={(e) => { onChange(withKey(filter, 'waitingForUs', e.target.checked ? true : undefined)); }} />
          Waiting for us<span className="ct-n">they wrote last</span>
        </label>
      </div>

      <div className="ct-fg">
        <h3>What you have sent</h3>
        <Seg<'any' | 'some' | 'never'> label="Campaigns" value={filter.campaigns ?? 'any'}
          options={[['any', 'Any'], ['some', 'Messaged'], ['never', 'Never messaged']]}
          onPick={(v) => { onChange(withKey(filter, 'campaigns', v === 'any' ? undefined : v)); }} />
        <div>
          <h4>In campaign</h4>
          <select className="ct-in" aria-label="In campaign" value={filter.campaignId ?? ''}
            onChange={(e) => { onChange(withKey(filter, 'campaignId', e.target.value === '' ? undefined : e.target.value)); }}>
            <option value="">Any campaign</option>
            {sources.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Seg<LastMessagedChoice> label="Last messaged" value={lastMessagedChoice(filter)}
          options={[['any', 'Any'], ['recent', 'Last 30 days'], ['stale', 'Not in 30 days']]}
          onPick={(v) => { onChange(withLastMessaged(filter, v)); }} />
      </div>

      <div className="ct-fg">
        <h3>Can you reach them</h3>
        <Seg<'any' | 'ok' | 'dnc'> label="Can be messaged" value={dncChoice}
          options={[['any', 'Any'], ['ok', 'Yes'], ['dnc', 'Do not contact']]}
          onPick={(v) => { onChange(withKey(filter, 'dnc', v === 'any' ? undefined : v === 'ok' ? 'exclude' : 'only')); }} />
        <Seg<'any' | 'yes' | 'no' | 'unchecked'> label="WhatsApp" value={filter.whatsapp ?? 'any'}
          options={[['any', 'Any'], ['yes', 'On WhatsApp'], ['no', 'Not on it'], ['unchecked', 'Not checked']]}
          onPick={(v) => { onChange(withKey(filter, 'whatsapp', v === 'any' ? undefined : v)); }} />
        <Seg<'any' | 'yes' | 'no'> label="Email" value={filter.email ?? 'any'}
          options={[['any', 'Any'], ['yes', 'Has one'], ['no', 'Missing']]}
          onPick={(v) => { onChange(withKey(filter, 'email', v === 'any' ? undefined : v)); }} />
        <Seg<ImportedChoice> label="Imported in the last" value={importedChoice(filter)}
          options={[['any', 'Any'], ['30', '30 days'], ['90', '90 days']]}
          onPick={(v) => { onChange(withImported(filter, v)); }} />
      </div>

      <div className="ct-fg">
        <h3>Your file’s columns</h3>
        {rules.map((r, i) => (
          <div className="ct-rule" key={i}>
            <select aria-label="Column" value={r.key} onChange={(e) => { setRule(i, { key: e.target.value }); }}>
              {sources.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              {!sources.fields.some((f) => f.key === r.key) && <option value={r.key}>{r.key}</option>}
            </select>
            <select aria-label="Condition" value={r.op} onChange={(e) => { setRule(i, { op: e.target.value as FieldRule['op'] }); }}>
              {RULE_OPS.map(([op, text]) => <option key={op} value={op}>{text}</option>)}
            </select>
            {r.op !== 'blank' && r.op !== 'filled' && (
              <input aria-label="Value" placeholder="Value" value={r.value ?? ''} maxLength={200}
                onChange={(e) => { setRule(i, { value: e.target.value }); }} />
            )}
            <button type="button" className="ct-btn ct-g ct-sm" aria-label="Remove this rule"
              onClick={() => { setRules(rules.filter((_, at) => at !== i)); }}><X size={16} aria-hidden /></button>
          </div>
        ))}
        {firstField !== undefined && rules.length < 10 && (
          <button type="button" className="ct-btn ct-sm" onClick={() => { setRules([...rules, { key: firstField, op: 'is', value: '' }]); }}>
            <Plus size={16} aria-hidden /> Add a column rule
          </button>
        )}
        <p className="ct-small">
          {firstField === undefined
            ? 'No columns were kept from an import yet. Choose which columns to keep when you import a file.'
            : 'Any column you kept from an import, like city or due date.'}
        </p>
      </div>

      <div className="ct-ffoot">
        <span><b>{matching}</b> {matching === 1 ? 'person matches' : 'people match'}</span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="ct-btn ct-sm" onClick={onSave}>Save as a list</button>
          <button type="button" className="ct-btn ct-g ct-sm" onClick={onClear}>Clear all</button>
        </span>
      </div>
    </>
  );
}
