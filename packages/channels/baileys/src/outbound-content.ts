import type { OutboundContent } from '@crm/channels';

/**
 * Turns our provider-neutral content into the shape Baileys' `sendMessage` takes. Pure, so the
 * mapping is testable without a socket: a send that lands as the wrong kind of message (a PDF as a
 * photo, say) is a silent product bug, not a crash.
 *
 * Images, video and audio go as their own kinds so WhatsApp renders them natively; everything else
 * goes as a document, keeping its filename. The caption is the message body and is omitted when
 * empty (WhatsApp shows an empty caption as a blank line). Voice notes (`ptt`) are not used —
 * a CRM user attaching an audio file means a file, not a recording.
 */
export function toBaileysContent(content: Extract<OutboundContent, { kind: 'freeform' }>): Record<string, unknown> {
  const media = content.media;
  if (media === undefined) return { text: content.body };

  const buffer = Buffer.from(media.bytes);
  const caption = content.body === '' ? undefined : content.body;
  const type = media.contentType;

  // Only formats WhatsApp shows as a photo go as an image; others (HEIC, say) are sent as a file so they arrive.
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) {
    return { image: buffer, ...(caption ? { caption } : {}) };
  }
  if (media.gifPlayback === true && type.startsWith('video/')) {
    return { video: buffer, mimetype: type, gifPlayback: true, ...(caption ? { caption } : {}) };
  }
  if (type.startsWith('video/')) return { video: buffer, mimetype: type, ...(caption ? { caption } : {}) };
  if (type.startsWith('audio/')) return { audio: buffer, mimetype: type };
  return {
    document: buffer, mimetype: type, fileName: media.filename ?? 'file',
    ...(caption ? { caption } : {})
  };
}
