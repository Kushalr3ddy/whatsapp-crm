// A standalone WhatsApp client for the test number (456). It is NOT part of the CRM: its login lives in ./auth next to this file,
// never in the CRM's database, and the CRM only ever sees it as a contact.
//
//   TESTER_HOME=<folder outside any checkout> node_modules/.bin/tsx tests/live/tester.mjs <checkout with node_modules>
//
// TESTER_HOME holds the login (auth/), events.jsonl and baileys.log. It must be outside the repository: the login is a real WhatsApp device.
//
// Control it over http://127.0.0.1:3998 :
//   GET  /status                 connection state, own number, whether a QR is waiting
//   GET  /qr.png                 the QR to scan with the 456 phone (Linked devices > Link a device)
//   POST /send   {to, text}      sends a WhatsApp message to `to` (+91...), returns its id
//   GET  /inbox?since=<ms>       messages received, oldest first
//   GET  /acks                   ticks for what this client sent
// Everything is also appended to ./events.jsonl.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = process.env.TESTER_HOME ?? dirname(fileURLToPath(import.meta.url));
const repo = process.argv[2];
if (!repo) { process.stderr.write('usage: node tester.mjs <checkout with node_modules>\n'); process.exit(2); }
const req = createRequire(join(repo, 'package.json'));
const load = async (name) => import(pathToFileURL(req.resolve(name)).href);
const B = await load('baileys');
const makeWASocket = B.default?.default ?? B.default ?? B.makeWASocket;
const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = B;
const QR = (await load('qrcode')).default;
const pino = (await load('pino')).default;

const authDir = join(here, 'auth');
mkdirSync(authDir, { recursive: true });
const log = (event) => appendFileSync(join(here, 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);

const state = { connection: 'starting', me: null, qr: null, lastClose: null };
const inbox = [];
const acks = new Map();
let sock = null;

const textOf = (m) => m?.conversation ?? m?.extendedTextMessage?.text ?? m?.imageMessage?.caption ?? m?.videoMessage?.caption
  ?? (m?.imageMessage ? '[image]' : m?.videoMessage ? '[video]' : m?.documentMessage ? '[document]' : null);

async function start() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version, auth, logger: pino({ level: 'debug' }, pino.destination(join(here, 'baileys.log'))), browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { state.qr = u.qr; state.connection = 'waiting_for_scan'; log({ kind: 'qr' }); }
    if (u.connection === 'open') {
      state.connection = 'open'; state.qr = null; state.me = sock.user?.id ?? null; log({ kind: 'open', me: state.me });
    }
    if (u.connection === 'close') {
      const err = u.lastDisconnect?.error;
      const code = err?.output?.statusCode ?? null;
      state.connection = 'closed'; state.lastClose = code;
      log({ kind: 'close', code, message: err?.message ?? null, data: err?.data ?? null, payload: err?.output?.payload ?? null });
      if (code === 401) { state.connection = 'logged_out'; return; }       // unlinked on the phone: needs a new scan
      setTimeout(() => { start().catch((e) => log({ kind: 'restart_failed', err: String(e) })); }, code === 515 ? 0 : 3000);
    }
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (m.key.fromMe || !m.key.remoteJid || m.key.remoteJid.endsWith('@g.us') || m.key.remoteJid.endsWith('@broadcast')) continue;
      const item = {
        id: m.key.id, from: m.key.remoteJid, fromAlt: m.key.remoteJidAlt ?? null, text: textOf(m.message),
        at: Date.now(), ts: Number(m.messageTimestamp ?? 0)
      };
      inbox.push(item); log({ kind: 'in', ...item });
    }
  });
  sock.ev.on('messages.update', (updates) => {
    for (const u of updates) {
      if (u.update?.status === undefined || !acks.has(u.key.id)) continue;
      acks.get(u.key.id).status = u.update.status; log({ kind: 'ack', id: u.key.id, status: u.update.status });
    }
  });
}

const body = (r) => new Promise((ok) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } }); });
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

createServer(async (rq, res) => {
  const url = new URL(rq.url, 'http://x');
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Test number 456</title><body style="font:16px system-ui;text-align:center;padding:24px">
<h2>Scan with the 456 phone: WhatsApp &gt; Linked devices &gt; Link a device</h2><img id="q" width="420" height="420"><p id="s"></p>
<script>async function t(){const s=await (await fetch('/status')).json();document.getElementById('s').textContent='State: '+s.connection+(s.me?' as '+s.me:'');
const q=document.getElementById('q');if(s.qr){q.style.display='';q.src='/qr.png?'+Date.now()}else{q.style.display='none'}}t();setInterval(t,3000)</script>`);
    }
    if (url.pathname === '/status') return json(res, 200, { ...state, qr: state.qr !== null });
    if (url.pathname === '/qr.png') {
      if (!state.qr) return json(res, 404, { error: 'no QR waiting', connection: state.connection });
      res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(await QR.toBuffer(state.qr, { width: 420, margin: 2 }));
    }
    if (url.pathname === '/send' && rq.method === 'POST') {
      const { to, text } = await body(rq);
      if (state.connection !== 'open') return json(res, 409, { error: `not connected (${state.connection})` });
      const jid = `${String(to).replace(/\D/g, '')}@s.whatsapp.net`;
      const sent = await sock.sendMessage(jid, { text: String(text) });
      acks.set(sent.key.id, { id: sent.key.id, to: jid, text, status: 1, at: Date.now() });
      log({ kind: 'out', id: sent.key.id, to: jid, text });
      return json(res, 200, { id: sent.key.id });
    }
    if (url.pathname === '/inbox') { const since = Number(url.searchParams.get('since') ?? 0); return json(res, 200, inbox.filter((m) => m.at >= since)); }
    if (url.pathname === '/acks') return json(res, 200, [...acks.values()]);
    return json(res, 404, { error: 'unknown path' });
  } catch (e) { return json(res, 500, { error: String(e?.message ?? e) }); }
}).listen(3998, '127.0.0.1', () => { log({ kind: 'listening', port: 3998 }); });

start().catch((e) => { log({ kind: 'start_failed', err: String(e) }); process.stderr.write(`${String(e)}\n`); });
