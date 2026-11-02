'use server';

import { getConversation, listMessages, CrmApiError } from '@/lib/crm';

/** One message as the side panel shows it. */
export interface PanelMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string;
  createdAt: string;
}

/** What the panel gets back: the chat, or a plain reason it could not be loaded. */
export type ChatResult =
  | { ok: true; title: string; phone: string | null; messages: PanelMessage[] }
  | { ok: false; error: string };

/** Loads one chat for the campaign page's side panel: the same two reads the inbox thread makes. */
export async function loadChat(conversationId: string): Promise<ChatResult> {
  try {
    const [conversation, messages] = await Promise.all([getConversation(conversationId), listMessages(conversationId)]);
    return {
      ok: true,
      title: conversation.contactName ?? conversation.contactPhone ?? 'Conversation',
      phone: conversation.contactPhone,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body ?? (m.undecryptable ? 'This message could not be read.' : `(${m.contentType})`),
        status: m.status,
        createdAt: m.createdAt
      }))
    };
  } catch (error) {
    return { ok: false, error: error instanceof CrmApiError ? error.message : 'Could not reach the API.' };
  }
}
