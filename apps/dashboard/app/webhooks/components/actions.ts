'use server';

import { revalidatePath } from 'next/cache';
import {
  AegisApiError,
  AegisAuthMissingError,
  createWebhook,
  deleteWebhook,
} from '../../../lib/api-client';

export interface SubscribeResult {
  ok: true;
  id: string;
  /** Shown ONCE on creation. Caller must record it; AEGIS only stores the bcrypt hash. */
  secret: string;
}

export type SubscribeOutcome = SubscribeResult | { ok: false; error: string };

export async function subscribeWebhook(formData: FormData): Promise<SubscribeOutcome> {
  const url = formData.get('url');
  const eventsRaw = formData.get('events');
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, error: 'URL is required.' };
  }
  if (typeof eventsRaw !== 'string' || eventsRaw.trim().length === 0) {
    return { ok: false, error: 'At least one event type is required.' };
  }
  const events = eventsRaw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const result = await createWebhook({ url, events });
    revalidatePath('/webhooks');
    return { ok: true, id: result.id, secret: result.secret };
  } catch (err) {
    if (err instanceof AegisAuthMissingError) {
      return { ok: false, error: 'Dashboard not authorized — set AEGIS_DASHBOARD_API_KEY.' };
    }
    if (err instanceof AegisApiError) {
      return { ok: false, error: `${err.code}: ${err.message}` };
    }
    return { ok: false, error: (err as Error).message ?? 'Subscribe failed.' };
  }
}

export async function unsubscribeWebhook(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await deleteWebhook(id);
    revalidatePath('/webhooks');
    return { ok: true };
  } catch (err) {
    if (err instanceof AegisApiError) {
      return { ok: false, error: `${err.code}: ${err.message}` };
    }
    return { ok: false, error: (err as Error).message ?? 'Unsubscribe failed.' };
  }
}
