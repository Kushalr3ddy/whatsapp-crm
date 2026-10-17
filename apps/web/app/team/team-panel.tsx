'use client';

import { useState, useTransition } from 'react';
import type { TeamMember } from '@/lib/crm';
import { addMemberAction, changeMemberAction, resetPasswordAction } from './actions';

/** Characters for a generated password: no look-alikes (0/O, 1/l/I), so it can be read out or typed from a message. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Makes a random 16-character password in the browser, using the platform's secure random source. */
function generatePassword(): string {
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Credentials shown once, after adding someone or resetting a password, for the admin to pass on. */
interface Handover { name: string; email: string; password: string }

/** Formats a last-sign-in time for the table, or says they have not signed in yet. */
function lastSeen(iso: string | null): string {
  return iso === null ? 'Never signed in' : new Date(iso).toLocaleString();
}

/**
 * The Team screen body: the people list with per-person actions, and the form to add someone.
 *
 * Passwords are chosen by the admin (or generated here) and shown once, because there is no email
 * invitation yet. Nothing is stored in the page after it is dismissed.
 */
export function TeamPanel({ members, meId }: { members: TeamMember[]; meId: string | null }) {
  const [handover, setHandover] = useState<Handover | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Runs a change on one person and shows its error, if any, above the list. */
  function change(userId: string, patch: { role?: 'admin' | 'agent'; status?: 'active' | 'disabled' }) {
    setError(null);
    startTransition(async () => {
      const result = await changeMemberAction(userId, patch);
      if (!result.ok) setError(result.error ?? 'Could not make that change.');
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {handover !== null && <HandoverNotice handover={handover} onDone={() => { setHandover(null); }} />}
      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}

      <AddMember onAdded={setHandover} />

      <section aria-label="People">
        <h2 className="mb-2 text-sm font-semibold text-muted">{members.length} {members.length === 1 ? 'person' : 'people'}</h2>
        <ul className="card divide-y divide-border">
          {members.map((m) => (
            <MemberRow
              key={m.userId} member={m} isMe={m.userId === meId} busy={pending}
              onChange={(patch) => { change(m.userId, patch); }} onHandover={setHandover}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** One person: who they are, their role and status, and the actions available on them. */
function MemberRow(
  { member, isMe, busy, onChange, onHandover }: {
    member: TeamMember; isMe: boolean; busy: boolean;
    onChange: (patch: { role?: 'admin' | 'agent'; status?: 'active' | 'disabled' }) => void;
    onHandover: (h: Handover) => void;
  }
) {
  const [resetting, setResetting] = useState(false);
  const disabled = member.status === 'disabled';
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {member.displayName}{isMe && <span className="ml-2 text-xs text-muted">(you)</span>}
          </p>
          <p className="truncate text-sm text-muted">{member.email}</p>
          <p className="text-xs text-muted">{lastSeen(member.lastLoginAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {disabled && <span className="badge badge-warning">Disabled</span>}
          <label className="sr-only" htmlFor={`role-${member.userId}`}>Role for {member.displayName}</label>
          <select
            id={`role-${member.userId}`} value={member.role} disabled={busy}
            onChange={(e) => { onChange({ role: e.target.value === 'admin' ? 'admin' : 'agent' }); }}
            className="field field-sm"
          >
            <option value="admin">Admin</option>
            <option value="agent">Agent</option>
          </select>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setResetting(!resetting); }}>
            Reset password
          </button>
          <button
            type="button" className="btn btn-sm" disabled={busy || isMe}
            title={isMe ? 'You cannot disable yourself' : undefined}
            onClick={() => { onChange({ status: disabled ? 'active' : 'disabled' }); }}
          >
            {disabled ? 'Enable' : 'Disable'}
          </button>
        </div>
      </div>
      {resetting && (
        <ResetPassword
          member={member}
          onDone={(h) => { setResetting(false); onHandover(h); }}
          onCancel={() => { setResetting(false); }}
        />
      )}
    </li>
  );
}

/** The inline form that sets a new password for one person. */
function ResetPassword(
  { member, onDone, onCancel }: { member: TeamMember; onDone: (h: Handover) => void; onCancel: () => void }
) {
  const [password, setPassword] = useState(generatePassword);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Saves the password, which also signs that person out everywhere. */
  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await resetPasswordAction(member.userId, password);
      if (!result.ok) { setError(result.error ?? 'Could not set the password.'); return; }
      onDone({ name: member.displayName, email: member.email, password });
    });
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3" aria-label={`Reset password for ${member.displayName}`}>
      <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs font-medium text-muted">
        New password (at least 12 characters)
        <input
          value={password} onChange={(e) => { setPassword(e.target.value); }} minLength={12} required
          className="field font-mono font-normal text-ink" autoComplete="off"
        />
      </label>
      <button type="button" className="btn btn-sm" onClick={() => { setPassword(generatePassword()); }}>Generate another</button>
      <button type="submit" disabled={pending} className="btn btn-primary btn-sm">{pending ? 'Saving…' : 'Set password'}</button>
      <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
      <p className="w-full text-xs text-muted">They are signed out everywhere and must use the new password.</p>
      {error !== null && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
    </form>
  );
}

/** The form that adds a person. */
function AddMember({ onAdded }: { onAdded: (h: Handover) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'agent'>('agent');
  const [password, setPassword] = useState(generatePassword);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Adds the person; on success the form resets and their sign-in details are shown once. */
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addMemberAction({ email, displayName: name, role, password });
      if (!result.ok) { setError(result.error ?? 'Could not add them.'); return; }
      onAdded({ name: name.trim(), email: email.trim().toLowerCase(), password });
      setName(''); setEmail(''); setRole('agent'); setPassword(generatePassword()); setOpen(false);
    });
  }

  if (!open) {
    return <div><button type="button" className="btn btn-primary" onClick={() => { setOpen(true); }}>Add a person</button></div>;
  }
  return (
    <form onSubmit={submit} aria-label="Add a person" className="card flex max-w-xl flex-col gap-3 p-5">
      <h2 className="text-base font-semibold">Add a person</h2>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Name
        <input value={name} onChange={(e) => { setName(e.target.value); }} required maxLength={200} className="field font-normal text-ink" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Email
        <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); }} required className="field font-normal text-ink" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Role
        <select value={role} onChange={(e) => { setRole(e.target.value === 'admin' ? 'admin' : 'agent'); }} className="field font-normal text-ink">
          <option value="agent">Agent (works in the inbox)</option>
          <option value="admin">Admin (manages everything, including the team)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Password (at least 12 characters)
        <span className="flex gap-2">
          <input value={password} onChange={(e) => { setPassword(e.target.value); }} minLength={12} required autoComplete="off" className="field flex-1 font-mono font-normal text-ink" />
          <button type="button" className="btn btn-sm" onClick={() => { setPassword(generatePassword()); }}>Generate another</button>
        </span>
      </label>
      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">{pending ? 'Adding…' : 'Add person'}</button>
        <button type="button" className="btn" onClick={() => { setOpen(false); }}>Cancel</button>
      </div>
    </form>
  );
}

/** Shows sign-in details once, with a Copy button, so the admin can pass them on. */
function HandoverNotice({ handover, onDone }: { handover: Handover; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Email: ${handover.email}\nPassword: ${handover.password}`;

  /** Copies the details to the clipboard; if the browser refuses, the text is still on screen to select. */
  function copy() {
    void navigator.clipboard.writeText(text).then(() => { setCopied(true); }, () => { setCopied(false); });
  }

  return (
    <div role="status" className="notice notice-success flex flex-col gap-2">
      <p className="font-medium">Share these sign-in details with {handover.name}. This is the only time the password is shown.</p>
      <pre className="rounded-lg bg-surface p-3 font-mono text-sm text-ink">{text}</pre>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="btn btn-sm" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
