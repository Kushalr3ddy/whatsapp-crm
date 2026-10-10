import { describe, expect, it } from 'vitest';
import {
  extractBody, extractStatusCode, mapDisconnectReason, mapStatus, phoneFromJid, toDate
} from './index.js';

describe('mapDisconnectReason', () => {
  it('maps the codes that each imply a DIFFERENT response', () => {
    // Typed rather than generic because the correct reaction differs: 401 is terminal,
    // 429 means back off hard, 463 means pause for a day. The previous system treated
    // every failure identically and retried straight into a ban.
    expect(mapDisconnectReason(401)).toBe('logged_out');
    expect(mapDisconnectReason(403)).toBe('forbidden');
    expect(mapDisconnectReason(408)).toBe('timeout');
    expect(mapDisconnectReason(428)).toBe('connection_closed');
    expect(mapDisconnectReason(429)).toBe('rate_limited');
    expect(mapDisconnectReason(440)).toBe('connection_replaced');
    expect(mapDisconnectReason(463)).toBe('reachout_timelock');
    expect(mapDisconnectReason(515)).toBe('restart_required');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(mapDisconnectReason(999)).toBe('unknown');
    expect(mapDisconnectReason(null)).toBe('unknown');
  });
});

describe('extractStatusCode', () => {
  it('digs the code out of the Boom error Baileys reports', () => {
    expect(extractStatusCode({ error: { output: { statusCode: 401 } } })).toBe(401);
  });
  it('returns null when the shape is anything else', () => {
    expect(extractStatusCode(undefined)).toBeNull();
    expect(extractStatusCode({})).toBeNull();
    expect(extractStatusCode({ error: {} })).toBeNull();
  });
});

describe('mapStatus', () => {
  it('treats a server ERROR ack as a failed send', () => {
    expect(mapStatus(0)).toBe('failed');
  });

  it('collapses WhatsApp ticks into our four states', () => {
    expect(mapStatus(1)).toBe('sent');
    expect(mapStatus(2)).toBe('sent');
    expect(mapStatus(3)).toBe('delivered');
    expect(mapStatus(4)).toBe('read');
    expect(mapStatus(5)).toBe('read');
  });
  it('ignores codes it does not recognise instead of inventing a status', () => {
    expect(mapStatus(99)).toBeNull();
  });
});

describe('extractBody', () => {
  it('reads a plain text message', () => {
    expect(extractBody({ conversation: 'hello' })).toEqual({ body: 'hello', contentType: 'text' });
  });

  it('reads a reply, which WhatsApp nests differently from a plain message', () => {
    // Same user-visible thing, completely different shape on the wire. Missing this is how a
    // CRM silently drops every reply to a quoted message.
    expect(extractBody({ extendedTextMessage: { text: 'replying' } }))
      .toEqual({ body: 'replying', contentType: 'text' });
  });

  it('reads captions off media, and types them correctly', () => {
    expect(extractBody({ imageMessage: { caption: 'my cv' } })).toEqual({ body: 'my cv', contentType: 'image' });
    expect(extractBody({ videoMessage: { caption: 'clip' } })).toEqual({ body: 'clip', contentType: 'video' });
    expect(extractBody({ audioMessage: {} })).toEqual({ body: '', contentType: 'audio' });
  });

  it('falls back to a document filename when there is no caption', () => {
    expect(extractBody({ documentMessage: { fileName: 'resume.pdf' } }))
      .toEqual({ body: 'resume.pdf', contentType: 'document' });
  });

  it('handles media with no caption at all without throwing', () => {
    expect(extractBody({ imageMessage: {} })).toEqual({ body: '', contentType: 'image' });
  });

  it('returns other for a shape it does not understand', () => {
    // Stickers, reactions, polls, system notices. Must not crash the inbound pipeline —
    // one unhandled message type taking down the connection is exactly M26.
    expect(extractBody({ someFutureMessageType: {} })).toEqual({ body: '', contentType: 'other' });
    expect(extractBody({})).toEqual({ body: '', contentType: 'other' });
  });
});

describe('toDate', () => {
  it('converts WhatsApp seconds to a Date', () => {
    expect(toDate(1_700_000_000).toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });
  it('accepts the protobuf Long form Baileys sometimes uses', () => {
    expect(toDate({ toNumber: () => 1_700_000_000 }).toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });
  it('falls back to now when the timestamp is missing', () => {
    expect(Math.abs(toDate(undefined).getTime() - Date.now())).toBeLessThan(2000);
  });
});

describe('phoneFromJid', () => {
  it('reads the number from a phone address, with or without a device suffix', () => {
    expect(phoneFromJid('919876543210@s.whatsapp.net')).toBe('+919876543210');
    expect(phoneFromJid('919876543210:12@s.whatsapp.net')).toBe('+919876543210');
  });

  it('is null for anything that is not a phone address', () => {
    expect(phoneFromJid('44887374303340@lid')).toBeNull();
    expect(phoneFromJid('120363025@g.us')).toBeNull();
    expect(phoneFromJid(undefined)).toBeNull();
    expect(phoneFromJid('12@s.whatsapp.net')).toBeNull();          // too short to be a number
  });
});
