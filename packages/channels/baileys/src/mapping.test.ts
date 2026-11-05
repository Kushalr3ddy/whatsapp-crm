import { describe, expect, it } from 'vitest';
import {
  extractBody, extractCloseDetail, extractStatusCode, isNotAPerson, linkedPhoneFor, mapDisconnectReason, mapStatus, phoneFromJid, toDate
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

describe('extractCloseDetail', () => {
  it('reads why WhatsApp ended the stream: <conflict type="device_removed"/> is an unlink on the phone (R-017)', () => {
    // Baileys puts the stream error's child node on the Boom error's `data` (Socket/socket.ts, CB:stream:error).
    const removed = { error: { output: { statusCode: 401 }, data: { tag: 'conflict', attrs: { type: 'device_removed' } } } };
    expect(extractCloseDetail(removed)).toBe('device_removed');
    expect(extractCloseDetail({ error: { data: { tag: 'conflict', attrs: { type: 'replaced' } } } })).toBe('replaced');
  });
  it('returns null when there is no such detail', () => {
    expect(extractCloseDetail(undefined)).toBeNull();
    expect(extractCloseDetail({ error: { output: { statusCode: 401 } } })).toBeNull();
    expect(extractCloseDetail({ error: { data: { reason: '401' } } })).toBeNull();
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
  it('does not crash on a message whose location fields are null (a reaction or a system message)', () => {
    const m = { locationMessage: null, liveLocationMessage: null, reactionMessage: {} } as unknown as Parameters<typeof extractBody>[0];
    expect(extractBody(m)).toEqual({ body: '', contentType: 'other' });
  });
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

describe('extractBody: kinds that used to vanish', () => {
  it('treats a sticker as an image to download', () => {
    expect(extractBody({ stickerMessage: {} })).toEqual({ body: '', contentType: 'image' });
  });

  it('shows a shared contact and a location as text instead of dropping them', () => {
    expect(extractBody({ contactMessage: { displayName: 'Asha Rao' } }))
      .toEqual({ body: 'Contact card: Asha Rao', contentType: 'text' });
    expect(extractBody({ contactsArrayMessage: { contacts: [{ displayName: 'A' }, { displayName: 'B' }] } }).body)
      .toBe('Contact cards: A, B');
    expect(extractBody({ locationMessage: { degreesLatitude: 18.5, degreesLongitude: 73.8, name: 'Pune office' } }).body)
      .toBe('Location: Pune office (18.5, 73.8)');
    expect(extractBody({ liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2 } }).body)
      .toBe('Live location: 1, 2');
  });

  it('looks through disappearing-chat, view-once and caption wrappers', () => {
    expect(extractBody({ ephemeralMessage: { message: { conversation: 'hello' } } }))
      .toEqual({ body: 'hello', contentType: 'text' });
    expect(extractBody({ viewOnceMessageV2: { message: { imageMessage: { caption: 'cv' } } } }))
      .toEqual({ body: 'cv', contentType: 'image' });
    expect(extractBody({ documentWithCaptionMessage: { message: { documentMessage: { caption: 'resume', fileName: 'r.pdf' } } } }))
      .toEqual({ body: 'resume', contentType: 'document' });
  });
});

describe('isNotAPerson', () => {
  it('ignores groups, channels, broadcast lists and the status feed', () => {
    expect(isNotAPerson('120363025@g.us')).toBe(true);
    expect(isNotAPerson('120363402111@newsletter')).toBe(true);
    expect(isNotAPerson('status@broadcast')).toBe(true);
    expect(isNotAPerson('1700000000@broadcast')).toBe(true);
  });

  it('keeps people: a phone address, with or without a device suffix, and a privacy address', () => {
    expect(isNotAPerson('919876543210@s.whatsapp.net')).toBe(false);
    expect(isNotAPerson('919876543210:12@s.whatsapp.net')).toBe(false);
    expect(isNotAPerson('44887374303340@lid')).toBe(false);
  });
});

describe('linkedPhoneFor (which phone number a privacy address belongs to)', () => {
  const lid = '110762928373833@lid';
  it('reads Baileys 7\'s remoteJidAlt, then participantAlt, then the 6.x fields', () => {
    expect(linkedPhoneFor(lid, { remoteJidAlt: '919964122631@s.whatsapp.net' })).toBe('+919964122631');
    expect(linkedPhoneFor(lid, { participantAlt: '919964122631:12@s.whatsapp.net' })).toBe('+919964122631');
    expect(linkedPhoneFor(lid, { senderPn: '919964122631@s.whatsapp.net' })).toBe('+919964122631');
    expect(linkedPhoneFor(lid, { participantPn: '919964122631@s.whatsapp.net' })).toBe('+919964122631');
  });
  it('prefers the 7.x field when both are present', () => {
    expect(linkedPhoneFor(lid, { remoteJidAlt: '911111111111@s.whatsapp.net', senderPn: '922222222222@s.whatsapp.net' })).toBe('+911111111111');
  });
  it('is null for a phone-number address, for an alternative that is not a phone number, and when nothing was said', () => {
    expect(linkedPhoneFor('919964122631@s.whatsapp.net', { remoteJidAlt: '110762928373833@lid' })).toBeNull();
    expect(linkedPhoneFor(lid, { remoteJidAlt: '55555@lid' })).toBeNull();
    expect(linkedPhoneFor(lid, {})).toBeNull();
  });
});
