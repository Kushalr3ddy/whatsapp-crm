import { describe, expect, it } from 'vitest';
import { toBaileysContent } from './outbound-content.js';

const bytes = new Uint8Array([1, 2, 3]);

describe('what is sent for a picture, a GIF clip and plain text', () => {
  it('sends text as text', () => {
    expect(toBaileysContent({ kind: 'freeform', body: 'hi' })).toEqual({ text: 'hi' });
  });

  it('sends a JPEG, PNG or WebP as a photo with the message as its caption', () => {
    const out = toBaileysContent({ kind: 'freeform', body: 'Offer!', media: { bytes, contentType: 'image/jpeg', filename: 'a.jpg' } });
    expect(out).toMatchObject({ caption: 'Offer!' });
    expect(out).toHaveProperty('image');
    expect(out).not.toHaveProperty('gifPlayback');
  });

  it('sends a converted GIF as a video with GIF playback, so WhatsApp loops it silently', () => {
    const out = toBaileysContent({ kind: 'freeform', body: 'Welcome', media: { bytes, contentType: 'video/mp4', filename: 'w.gif', gifPlayback: true } });
    expect(out).toMatchObject({ mimetype: 'video/mp4', gifPlayback: true, caption: 'Welcome' });
    expect(out).toHaveProperty('video');
  });

  it('sends an ordinary video without GIF playback, and omits an empty caption', () => {
    const out = toBaileysContent({ kind: 'freeform', body: '', media: { bytes, contentType: 'video/mp4', filename: 'v.mp4' } });
    expect(out).not.toHaveProperty('gifPlayback');
    expect(out).not.toHaveProperty('caption');
  });
});
