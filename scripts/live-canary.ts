/**
 * Live canary: proves the real WhatsApp path works end to end, on two spare numbers the operator owns.
 *
 *   npm run live:canary                 # one round: A → B, B sees it, B → A, A sees it
 *   npm run live:canary -- --check      # only the pre-flight: says what a person still has to do, sends nothing
 *
 * It talks to a running install through its API, exactly as a person's clicks would, so the anti-ban lane, the gateway and the real
 * WhatsApp adapter are all in the path. Both numbers must be linked in the same install (B has to be linked so the install can see that
 * the message arrived). Exit code 0 = healthy, 1 = a step failed, 2 = not ready (a person has to do something first).
 *
 * Everything a person must do is checked before anything is sent, and listed together, so a run never stops halfway on a missing step.
 * Set CANARY_ALERT_URL to a Slack or Discord incoming-webhook URL to be told when a round fails; run it from cron every few hours.
 */

/** One setting from the environment, trimmed. */
const env = (name: string): string => (process.env[name] ?? '').trim();
const API = (env('CRM_API_URL') || 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
const KEY = env('CRM_API_KEY');
const FROM = env('LIVE_CANARY_FROM');      // number A, E.164, e.g. +919000000001
const TO = env('LIVE_CANARY_TO');          // number B, E.164
const ALERT = env('CANARY_ALERT_URL');
const WAIT_MS = Number(env('CANARY_WAIT_MS') || 180_000);
const checkOnly = process.argv.includes('--check');

/** One line to the terminal (this is a command-line tool: its output is the report). */
const say = (line: string): void => { process.stdout.write(`${line}
`); };
/** One line to the error stream. */
const shout = (line: string): void => { process.stderr.write(`${line}
`); };

/** A number as `GET /senders` lists it. */
interface Sender { id: string; label: string | null; phoneE164: string | null; status: string; connectionState: string | null; linked: boolean }
/** A thread as `GET /conversations` lists it. */
interface Conversation { id: string; contactPhone: string | null; senderLabel: string | null }
/** A message as a thread lists it. */
interface Message { id: string; direction: string; status: string; body?: string | null; errorCode: string | null; holdReason: string | null }

/** One API call with the canary's key, unwrapping the `data` envelope. */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, ...init.headers }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${String(r.status)} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { data: T }).data;
}

/** Waits. */
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** Posts a failure to the alert webhook, if one is set. */
async function alert(text: string): Promise<void> {
  if (ALERT === '') return;
  await fetch(ALERT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }) })
    .catch(() => undefined);
}

/** Every step a person must have done, checked together. Returns what is still missing, in plain words. */
async function preflight(): Promise<{ missing: string[]; a?: Sender; b?: Sender }> {
  const missing: string[] = [];
  if (KEY === '') missing.push('Create an API key with messages:send, conversations:read and senders:read (Team page), and set CRM_API_KEY.');
  if (FROM === '') missing.push('Set LIVE_CANARY_FROM to spare number A, in full international form (+91…).');
  if (TO === '') missing.push('Set LIVE_CANARY_TO to spare number B, in full international form.');
  if (FROM !== '' && FROM === TO) missing.push('LIVE_CANARY_FROM and LIVE_CANARY_TO must be two different numbers.');
  if (missing.length > 0) return { missing };

  let senders: Sender[];
  try { senders = await api<Sender[]>('/senders'); }
  catch (error) { return { missing: [`Start the install (API, gateway) and check CRM_API_URL and CRM_API_KEY: ${error instanceof Error ? error.message : String(error)}`] }; }
  const find = (phone: string): Sender | undefined => senders.find((s) => s.phoneE164 === phone && s.status !== 'removed');
  const a = find(FROM);
  const b = find(TO);
  for (const [name, phone, s] of [['A', FROM, a], ['B', TO, b]] as const) {
    if (s === undefined) missing.push(`Add number ${name} (${phone}) on the Numbers page.`);
    else if (!s.linked) missing.push(`Link number ${name} (${phone}): scan its QR on the Numbers page with that phone (Linked devices → Link a device).`);
    else if (s.connectionState !== 'open') missing.push(`Number ${name} (${phone}) is linked but not connected (${s.connectionState ?? 'unknown'}): make sure its phone is on, online and still lists this device under Linked devices.`);
  }
  return { missing, ...(a ? { a } : {}), ...(b ? { b } : {}) };
}

/** The thread on `sender` with `phone`, once it exists. */
async function threadWith(sender: Sender, phone: string): Promise<Conversation | null> {
  const list = await api<Conversation[]>('/conversations');
  return list.find((c) => c.contactPhone === phone && c.senderLabel === sender.label) ?? null;
}

/** Waits until `check` returns something, or the time is up. */
async function waitFor<T>(what: string, check: () => Promise<T | null>): Promise<T> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const got = await check();
    if (got !== null) return got;
    if (Date.now() > until) throw new Error(`timed out after ${String(Math.round(WAIT_MS / 1000))} s waiting for: ${what}`);
    await sleep(5_000);
  }
}

/** Sends from one number to the other and waits for it to be delivered there and to arrive on the other side. */
async function leg(from: Sender, to: Sender, token: string): Promise<void> {
  const body = `CRM health check ${token} (automatic, please ignore)`;
  const sent = await api<{ id: string; conversationId: string }>('/messages', {
    method: 'POST', body: JSON.stringify({ to: to.phoneE164, body, senderId: from.id })
  });
  const out = await waitFor(`${from.phoneE164} → ${to.phoneE164} to show delivered`, async () => {
    const msgs = await api<Message[]>(`/conversations/${sent.conversationId}/messages`);
    const m = msgs.find((x) => x.id === sent.id);
    if (m?.status === 'failed') throw new Error(`the send failed: ${m.errorCode ?? 'no code'}`);
    return m !== undefined && (m.status === 'delivered' || m.status === 'read') ? m : null;
  });
  void out;
  await waitFor(`${to.phoneE164} to receive it`, async () => {
    const thread = await threadWith(to, from.phoneE164!);
    if (thread === null) return null;
    const msgs = await api<Message[]>(`/conversations/${thread.id}/messages`);
    return msgs.find((x) => x.direction === 'inbound' && (x.body ?? '').includes(token)) ?? null;
  });
}

/** One canary round. Returns the exit code. */
async function main(): Promise<number> {
  const { missing, a, b } = await preflight();
  if (missing.length > 0 || a === undefined || b === undefined) {
    say('Not ready. A person needs to do this first:');
    missing.forEach((m, i) => { say(`  ${String(i + 1)}. ${m}`); });
    return 2;
  }
  say(`Ready: A ${a.phoneE164} and B ${b.phoneE164} are linked and connected.`);
  if (checkOnly) return 0;

  const token = Math.random().toString(36).slice(2, 8).toUpperCase();
  const started = Date.now();
  try {
    await leg(a, b, `${token}-AB`);
    say(`A → B delivered and received (${String(Math.round((Date.now() - started) / 1000))} s)`);
    await leg(b, a, `${token}-BA`);
    say(`B → A delivered and received (${String(Math.round((Date.now() - started) / 1000))} s)`);
    say('Healthy.');
    return 0;
  } catch (error) {
    const text = `WhatsApp CRM health check FAILED: ${error instanceof Error ? error.message : String(error)}`;
    shout(text);
    await alert(text);
    return 1;
  }
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  shout(String(error));
  process.exitCode = 1;
});
